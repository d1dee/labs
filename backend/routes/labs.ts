import { and, desc, eq, gte, sql } from 'drizzle-orm';
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
import { errorProperty, getLogger } from '../logger';
import { reconcileLabActivation, withLabActivation } from '../lab-activation';
import {
    type ConfigLab,
    getFirewallConfigWithLabs,
    mapLabs,
} from '../firewall-config';
import {
    getInterfaceUsage,
    getOnlineDevices,
    parseByteCounter,
    getLabDetailsByRuleId,
    getRuleStatus,
    resolveSubnetAndDhcpServer,
    toggleRuleDisabled,
} from '../mikrotik';
import { type AppEnv, createApp } from './context';

export const labsRouter = createApp();

const snapshotLogger = getLogger(['labs', 'snapshots']);

type LabUser = NonNullable<AppEnv['Variables']['user']>;

/**
 * Build the full stats object for a single lab, including demo-mode overrides.
 * Shared by `/labs/:labId/stats` and the consolidated `/labs/overview` endpoint.
 */
async function buildLabStats(lab: ConfigLab, user: LabUser) {
    const organizationId = user.organizationId!;

    // Get rule status
    const ruleResponse = await withLabActivation(lab.id, async () => {
        const response = await getRuleStatus(organizationId, lab.ruleId);
        if (!isDemoUser(user)) {
            if (!response.success || !['accept', 'drop'].includes(response.data?.action) ||
                ![false, 'false'].includes(response.data?.disabled)) {
                throw new Error(`Cannot determine access state for lab ${lab.name}: firewall rule unavailable, disabled, or unsupported.`);
            }
            reconcileLabActivation(lab.id, response.data.action === 'accept');
        }
        return response;
    });
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

    // Prefer recent ARP reachability, with scoped bound leases as an estimate.
    const [devices, totalBytes] = await Promise.all([
        getOnlineDevices(organizationId, { interface: lab.interface, subnet, dhcpServer }),
        lab.interface ? getInterfaceUsage(organizationId, lab.interface)
            : Promise.resolve(ruleResponse.success ? parseByteCounter(ruleResponse.data?.bytes) : null),
    ]);

    const stats = {
        lab: {
            id: lab.id,
            name: lab.name,
            subnet,
            interface: lab.interface || '',
        },
        firewall: {
            ruleId: lab.ruleId,
            disabled: ruleDisabled,
            comment: ruleResponse.data?.comment,
            status: ruleDisabled ? 'blocked' : 'active',
            usageMB: totalBytes === null ? null : Number((totalBytes / (1024 * 1024)).toFixed(2)),
            usageSource: lab.interface ? 'interface' : 'firewall',
        },
        devices: {
            ...devices,
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
        .orderBy(desc(activationHistory.createdAt), sql`rowid desc`)
        .limit(100);

    return history.map((entry) => ({
        id: entry.id,
        labId: entry.labId,
        enabled: entry.enabled,
        triggeredBy: entry.triggeredBy,
        source: entry.source,
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

        // Reconcile each lab before reading its history for this response.
        const entries = await Promise.all(labs.map(async (lab) => {
            const stats = await buildLabStats(lab, user);
            const history = await fetchLabHistory(user, lab.id);
            return { labId: lab.id, stats, history };
        }));

        return c.json({
            labs,
            stats: Object.fromEntries(entries.map(({ labId, stats }) => [labId, stats])),
            history: Object.fromEntries(entries.map(({ labId, history }) => [labId, history])),
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

    let body: unknown;
    try {
        body = await c.req.json();
    } catch {
        return c.json({ error: 'Request body must be valid JSON' }, 400);
    }
    if (!body || typeof body !== 'object' || !('enable' in body) ||
        typeof body.enable !== 'boolean') {
        return c.json({ error: 'enable must be a boolean' }, 400);
    }
    const { enable } = body;

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

        // Demo mode: persist toggle in demo state instead of real systems
        if (isDemoUser(user)) {
            try {
                await setDemoLabState(user.id, labId, enable);
            } catch {
                return c.json({
                    success: false,
                    code: 'HISTORY_SAVE_FAILED',
                    error: 'Demo lab access change could not be saved.',
                }, 500);
            }
            return c.json({
                success: true,
                lab: labId,
                enabled: enable,
                message: `Lab ${labId} access has been ${enable ? 'enabled' : 'disabled'}`,
            });
        }

        const organizationId = user.organizationId;
        return await withLabActivation(labId, async () => {
            const result = await toggleRuleDisabled(
                organizationId,
                lab.ruleId,
                enable,
                lab.subnet,
            );

            if (!result.success) {
                return c.json({ success: false, error: result.error || 'The router could not apply the lab access change.' }, 500);
            }

            const verified = await getRuleStatus(organizationId, lab.ruleId);
            if (!verified.success || verified.data?.action !== (enable ? 'accept' : 'drop') ||
                ![false, 'false'].includes(verified.data?.disabled)) {
                return c.json({
                    success: false,
                    code: 'ROUTER_STATE_UNVERIFIED',
                    error: 'The router change could not be verified. Lab access may have changed; refresh its status before retrying.',
                }, 502);
            }

            try {
                await db.insert(activationHistory).values({
                    id: crypto.randomUUID(),
                    labId,
                    enabled: enable,
                    triggeredBy: user.id,
                    createdAt: new Date(),
                });
            } catch {
                return c.json({
                    success: false,
                    code: 'HISTORY_SAVE_FAILED',
                    routerApplied: true,
                    enabled: enable,
                    error: 'Lab access changed on the router, but its activation history could not be saved. Refresh its status before retrying.',
                }, 500);
            }

            return c.json({
                success: true,
                lab: labId,
                enabled: enable,
                message: `Lab ${labId} access has been ${enable ? 'enabled' : 'disabled'}`,
            });
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
        if (!user.organizationId) return c.json({ error: 'You must join an organization first' }, 403);
        const config = await getFirewallConfigWithLabs(user.organizationId);
        if (!config?.labs.some((lab) => lab.id === labId)) return c.json({ error: 'Lab not found' }, 404);
        return c.json({ history: await fetchLabHistory(user, labId) });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

let snapshotInFlight = false;
let snapshotTimer: ReturnType<typeof setInterval> | undefined;
async function saveDataUsageSnapshot() {
    if (snapshotInFlight) return;
    snapshotInFlight = true;
    try {
        const configs = await db.query.firewallConfig.findMany({
            with: { labs: true },
        });

        for (const storedConfig of configs) {
            const labs = mapLabs(storedConfig.labs);

            for (const lab of labs) {
                const ruleResponse = await withLabActivation(lab.id, async () => {
                    const response = await getRuleStatus(storedConfig.organizationId, lab.ruleId);
                    if (response.success && ['accept', 'drop'].includes(response.data?.action) &&
                        [false, 'false'].includes(response.data?.disabled)) {
                        reconcileLabActivation(lab.id, response.data.action === 'accept');
                    }
                    return response;
                });
                const totalBytes = lab.interface
                    ? await getInterfaceUsage(storedConfig.organizationId, lab.interface)
                    : ruleResponse?.success ? parseByteCounter(ruleResponse.data?.bytes) : null;
                if (totalBytes !== null) {
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
        snapshotLogger.info('Data usage snapshots saved');
    } catch (error) {
        snapshotLogger.error('Failed to save data usage snapshot: {error}', {
            error: errorProperty(error),
        });
    } finally {
        snapshotInFlight = false;
    }
}

export function startDataUsageSnapshots() {
    if (snapshotTimer) return;
    const configured = Number(process.env.DATA_USAGE_SNAPSHOT_INTERVAL ?? 300_000);
    const interval = Number.isSafeInteger(configured) && configured >= 1_000 && configured <= 2_147_483_647
        ? configured : 300_000;
    snapshotTimer = setInterval(saveDataUsageSnapshot, interval);
    void saveDataUsageSnapshot();
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
        if (!user.organizationId) return c.json({ error: 'You must join an organization first' }, 403);
        const config = await getFirewallConfigWithLabs(user.organizationId);
        if (!config?.labs.some((lab) => lab.id === labId)) return c.json({ error: 'Lab not found' }, 404);
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
