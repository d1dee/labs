import console from 'console';
import { and, desc, eq, gte } from 'drizzle-orm';
import process from 'process';
import { setInterval } from 'timers';
import { db } from '../../db/database';
import { activationHistory, dataUsageHistory } from '../../db/schema';
import {
    getDemoLabEnabled,
    getDemoLabHistory,
    isDemoUser,
    setDemoLabState,
} from '../demo';
import {
    type ConfigLab,
    getFirewallConfigWithLabs,
    mapLabs,
} from '../firewall-config';
import {
    getDHCPLeases,
    getLabDetailsByRuleId,
    getRuleStatus,
    resolveSubnetAndDhcpServer,
    toggleRuleDisabled,
} from '../mikrotik';
import { type AppEnv, createApp } from './context';

export const labsRouter = createApp();

type LabUser = NonNullable<AppEnv['Variables']['user']>;

/**
 * Build the full stats object for a single lab, including demo-mode overrides.
 * Shared by `/labs/:labId/stats` and the consolidated `/labs/overview` endpoint.
 */
async function buildLabStats(lab: ConfigLab, user: LabUser) {
    const organizationId = user.organizationId!;

    // Get rule status
    const ruleResponse = await getRuleStatus(
        organizationId,
        lab.ruleId,
    );
    const ruleDisabled =
        ruleResponse.success && ruleResponse.data?.action === 'drop';

    // Resolve the DHCP server live from the rule so address-list
    // references are resolved to a concrete subnet, falling back to the
    // stored config when resolution yields nothing.
    let { dhcpServer, subnet } = lab;
    if (ruleResponse.success && ruleResponse.data) {
        const resolved = await resolveSubnetAndDhcpServer(
            organizationId,
            ruleResponse.data,
        );
        if (resolved.dhcpServer) {
            dhcpServer = resolved.dhcpServer;
        }
        if (resolved.subnet) {
            subnet = resolved.subnet;
        }
    }

    // Get DHCP leases to estimate connected devices
    const leasesResponse = await getDHCPLeases(
        organizationId,
        dhcpServer,
    );

    const stats = {
        lab: {
            id: lab.id,
            name: lab.name,
            subnet,
        },
        firewall: {
            ruleId: lab.ruleId,
            disabled: ruleDisabled,
            comment: ruleResponse.data?.comment,
            status: ruleDisabled ? 'blocked' : 'active',
            usageMB: parseFloat(
                (
                    parseInt(ruleResponse.data?.bytes || '0', 10) /
                    (1024 * 1024)
                ).toFixed(2),
            ),
        },
        devices: {
            connected: leasesResponse.data?.length,
            dhcpServer,
        },
        timestamp: new Date().toISOString(),
    };

    // Demo mode: apply lab state override
    if (isDemoUser(user)) {
        const demoEnabled = await getDemoLabEnabled(user.id, lab.id);
        if (demoEnabled !== null) {
            stats.firewall.disabled = !demoEnabled;
            stats.firewall.status = demoEnabled ? 'active' : 'blocked';
        }
    }

    return stats;
}

/**
 * Fetch the activation history for a single lab (last 7 days, newest first).
 * Shared by `/labs/:labId/history` and the consolidated `/labs/overview` endpoint.
 */
async function fetchLabHistory(user: LabUser, labId: string) {
    // Demo mode: return demo history
    if (isDemoUser(user)) {
        return getDemoLabHistory(user.id, labId);
    }

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const history = await db
        .select()
        .from(activationHistory)
        .where(
            and(
                eq(activationHistory.labId, labId),
                gte(activationHistory.createdAt, oneWeekAgo),
            ),
        )
        .orderBy(desc(activationHistory.createdAt))
        .limit(100);

    return history.map((entry) => ({
        id: entry.id,
        labId: entry.labId,
        enabled: entry.enabled,
        triggeredBy: entry.triggeredBy,
        createdAt: entry.createdAt.toISOString(),
    }));
}

labsRouter.get('/labs', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    try {
        const storedConfig = await getFirewallConfigWithLabs(
            user.organizationId,
        );

        if (!storedConfig) {
            return c.json(
                {
                    error: 'Firewall configuration not found. Please configure firewall settings in Settings.',
                    code: 'CONFIG_MISSING',
                },
                404,
            );
        }

        return c.json({ labs: mapLabs(storedConfig.labs) });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

/**
 * Consolidated endpoint returning labs, per-lab stats and per-lab activation
 * history in a single response. This avoids the frontend firing N stats +
 * N history requests (one per lab) on every load and poll cycle.
 */
labsRouter.get('/labs/overview', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    try {
        const storedConfig = await getFirewallConfigWithLabs(
            user.organizationId,
        );

        if (!storedConfig) {
            return c.json(
                {
                    error: 'Firewall configuration not found. Please configure firewall settings in Settings.',
                    code: 'CONFIG_MISSING',
                },
                404,
            );
        }

        const labs = mapLabs(storedConfig.labs);

        // Build stats and history for every lab concurrently. This is a single
        // HTTP response for the client, even though it fans out into MikroTik /
        // DB calls here on the server.
        const [statsEntries, historyEntries] = await Promise.all([
            Promise.all(
                labs.map(
                    async (lab) =>
                        [
                            lab.id,
                            await buildLabStats(lab, user),
                        ] as const,
                ),
            ),
            Promise.all(
                labs.map(
                    async (lab) =>
                        [
                            lab.id,
                            await fetchLabHistory(user, lab.id),
                        ] as const,
                ),
            ),
        ]);

        return c.json({
            labs,
            stats: Object.fromEntries(statsEntries),
            history: Object.fromEntries(historyEntries),
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

labsRouter.get('/labs/:labId/stats', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const labId = c.req.param('labId');

    try {
        const storedConfig = await getFirewallConfigWithLabs(
            user.organizationId,
        );

        if (!storedConfig) {
            return c.json(
                {
                    error: 'Firewall configuration not found. Please configure firewall settings in Settings.',
                    code: 'CONFIG_MISSING',
                },
                404,
            );
        }

        const labs = mapLabs(storedConfig.labs);
        const lab = labs.find((l) => l.id === labId);
        if (!lab) {
            return c.json({ error: 'Lab not found' }, 404);
        }

        return c.json(await buildLabStats(lab, user));
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

labsRouter.get('/labs/by-rule/:ruleId', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const ruleId = c.req.param('ruleId');

    try {
        const result = await getLabDetailsByRuleId(user.organizationId, ruleId);
        if (!result.success) {
            return c.json({ success: false, error: result.error }, 500);
        }
        return c.json({ success: true, data: result.data });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

labsRouter.post('/labs/:labId/toggle', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const labId = c.req.param('labId');

    try {
        const body = await c.req.json<{ enable: boolean }>();
        const { enable } = body;

        const storedConfig = await getFirewallConfigWithLabs(
            user.organizationId,
        );

        if (!storedConfig) {
            return c.json(
                {
                    error: 'Firewall configuration not found. Please configure firewall settings in Settings.',
                    code: 'CONFIG_MISSING',
                },
                404,
            );
        }

        const labs = mapLabs(storedConfig.labs);
        const lab = labs.find((l) => l.id === labId);

        if (!lab) {
            return c.json({ error: 'Lab not found' }, 404);
        }

        // Demo mode: persist toggle in demo state instead of real systems
        if (isDemoUser(user)) {
            await setDemoLabState(user.id, labId, enable);
            return c.json({
                success: true,
                lab: labId,
                enabled: enable,
                message: `Lab ${labId} access has been ${enable ? 'enabled' : 'disabled'}`,
            });
        }

        // Toggle the rule (if enable=true, set disabled=false)
        const result = await toggleRuleDisabled(
            user.organizationId,
            lab.ruleId,
            enable,
            lab.subnet,
        );

        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }

        // Save activation history
        await db.insert(activationHistory).values({
            id: crypto.randomUUID(),
            labId,
            enabled: enable,
            triggeredBy: user.id,
            createdAt: new Date(),
        });

        return c.json({
            success: true,
            lab: labId,
            enabled: enable,
            message: `Lab ${labId} access has been ${enable ? 'enabled' : 'disabled'}`,
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

labsRouter.get('/labs/:labId/history', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const labId = c.req.param('labId');

    try {
        return c.json({ history: await fetchLabHistory(user, labId) });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

async function saveDataUsageSnapshot() {
    try {
        const configs = await db.query.firewallConfig.findMany({
            with: { labs: true },
        });

        for (const storedConfig of configs) {
            const labs = mapLabs(storedConfig.labs);

            for (const lab of labs) {
                const ruleResponse = await getRuleStatus(
                    storedConfig.organizationId,
                    lab.ruleId,
                );
                if (ruleResponse.success && ruleResponse.data?.bytes) {
                    const totalBytes = ruleResponse.data.bytes;
                    const usageMB = Math.round(
                        Number(totalBytes) / (1024 * 1024),
                    );

                    await db.insert(dataUsageHistory).values({
                        id: crypto.randomUUID(),
                        labId: lab.id,
                        totalBytes,
                        usageMB,
                        createdAt: new Date(),
                    });
                }
            }
        }
        console.log('✓ Data usage snapshots saved');
    } catch (error) {
        console.error('Failed to save data usage snapshot:', error);
    }
}

export function startDataUsageSnapshots() {
    const interval = parseInt(
        process.env.DATA_USAGE_SNAPSHOT_INTERVAL || '300000',
        10,
    );
    setInterval(saveDataUsageSnapshot, interval);
    saveDataUsageSnapshot();
}

labsRouter.get('/labs/:labId/usage-history', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const labId = c.req.param('labId');
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    try {
        const usageHistory = await db
            .select()
            .from(dataUsageHistory)
            .where(
                and(
                    eq(dataUsageHistory.labId, labId),
                    gte(dataUsageHistory.createdAt, oneWeekAgo),
                ),
            )
            .orderBy(desc(dataUsageHistory.createdAt))
            .limit(200);

        const data = usageHistory
            .slice()
            .reverse()
            .map((entry, index, arr) => {
                const prevEntry = index > 0 ? arr[index - 1] : null;
                const usageDiff = prevEntry
                    ? Number(entry.totalBytes - prevEntry.totalBytes) /
                      (1024 * 1024)
                    : 0;

                return {
                    id: entry.id,
                    labId: entry.labId,
                    totalBytes: Number(entry.totalBytes),
                    usageMB: Number(entry.usageMB),
                    usageDiffMB: Math.max(0, usageDiff),
                    createdAt: entry.createdAt.toISOString(),
                };
            });

        return c.json({ history: data });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});
