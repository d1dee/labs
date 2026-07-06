import console from 'console';
import { and, desc, eq, gte } from 'drizzle-orm';
import process from 'process';
import { setInterval } from 'timers';
import { db } from '../../db/database';
import {
    activationHistory,
    dataUsageHistory,
    firewallConfig,
} from '../../db/schema';
import {
    getDemoLabEnabled,
    getDemoLabHistory,
    isDemoUser,
    setDemoLabState,
} from '../demo';
import {
    getDHCPLeases,
    getLabDetailsByRuleId,
    getRuleStatus,
    toggleRuleDisabled,
} from '../mikrotik';
import { createApp } from './context';

export const labsRouter = createApp();

labsRouter.get('/labs', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    try {
        const storedConfig = await db
            .select()
            .from(firewallConfig)
            .where(eq(firewallConfig.organizationId, user.organizationId))
            .get();

        if (!storedConfig) {
            return c.json(
                {
                    error: 'Firewall configuration not found. Please configure firewall settings in Settings.',
                    code: 'CONFIG_MISSING',
                },
                404,
            );
        }

        const labs = JSON.parse(storedConfig.labs || '[]');
        return c.json({ labs });
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
        const storedConfig = await db
            .select()
            .from(firewallConfig)
            .where(eq(firewallConfig.organizationId, user.organizationId))
            .get();

        if (!storedConfig) {
            return c.json(
                {
                    error: 'Firewall configuration not found. Please configure firewall settings in Settings.',
                    code: 'CONFIG_MISSING',
                },
                404,
            );
        }

        const labs = JSON.parse(storedConfig.labs || '[]');
        const lab = labs.find((l: any) => l.id === labId);
        if (!lab) {
            return c.json({ error: 'Lab not found' }, 404);
        }

        // Get rule status
        const ruleResponse = await getRuleStatus(lab.ruleId);
        const ruleDisabled =
            ruleResponse.success && ruleResponse.data?.action === 'drop';

        // Get DHCP leases to estimate connected devices
        const leasesResponse = await getDHCPLeases(lab.dhcpServer);

        const stats = {
            lab: {
                id: lab.id,
                name: lab.name,
                subnet: lab.subnet,
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
                dhcpServer: lab.dhcpServer,
            },
            timestamp: new Date().toISOString(),
        };

        // Demo mode: apply lab state override
        if (isDemoUser(user)) {
            const demoEnabled = await getDemoLabEnabled(user.id, labId);
            if (demoEnabled !== null) {
                stats.firewall.disabled = !demoEnabled;
                stats.firewall.status = demoEnabled ? 'active' : 'blocked';
            }
        }

        return c.json(stats);
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

labsRouter.get('/labs/by-rule/:ruleId', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const ruleId = c.req.param('ruleId');

    try {
        const result = await getLabDetailsByRuleId(ruleId);
        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }
        return c.json(result.data);
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

        const storedConfig = await db
            .select()
            .from(firewallConfig)
            .where(eq(firewallConfig.organizationId, user.organizationId))
            .get();

        if (!storedConfig) {
            return c.json(
                {
                    error: 'Firewall configuration not found. Please configure firewall settings in Settings.',
                    code: 'CONFIG_MISSING',
                },
                404,
            );
        }

        const labs = JSON.parse(storedConfig.labs || '[]');
        const lab = labs.find((l: any) => l.id === labId);

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
        const result = await toggleRuleDisabled(lab.ruleId, enable, lab.subnet);

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
        // Demo mode: return demo history
        if (isDemoUser(user)) {
            const demoHistory = await getDemoLabHistory(user.id, labId);
            return c.json({ history: demoHistory });
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

        return c.json({
            history: history.map((entry) => ({
                id: entry.id,
                labId: entry.labId,
                enabled: entry.enabled,
                triggeredBy: entry.triggeredBy,
                createdAt: entry.createdAt.toISOString(),
            })),
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

async function saveDataUsageSnapshot() {
    try {
        const configs = await db.select().from(firewallConfig);

        for (const storedConfig of configs) {
            if (!storedConfig) {
                continue;
            }

            const labs = JSON.parse(storedConfig.labs || '[]');

            for (const lab of labs) {
                const ruleResponse = await getRuleStatus(lab.ruleId);
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
