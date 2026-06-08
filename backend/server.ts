import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import path from 'path';
import config from '../config.json';
import { db } from '../db/database';
import { createAuthTables } from '../db/migrate';
import { activationHistory, dataUsageHistory } from '../db/schema';
import { auth } from './auth';
import { seedTestTeachers } from './database';
import {
    createFogHost,
    createFogSnapinTask,
    createFogTask,
    deleteFogHost,
    getFogHost,
    getFogSystemInfo,
    isFogConfigured,
    listActiveMulticastSessions,
    listActiveTasks,
    listFogHosts,
    listFogImages,
    listFogSnapins,
    listFogTaskTypes,
    updateFogHost,
} from './fog';
import { getDHCPLeases, getRuleStatus, toggleRuleDisabled } from './mikrotik';
import {
    addPiholeDomain,
    deletePiholeDomain,
    getPiholeBlocking,
    getPiholeDomains,
    getPiholeQueries,
    getPiholeRecentBlocked,
    getPiholeSummary,
    getPiholeTopDomains,
    isPiholeConfigured,
    setPiholeBlocking,
    updatePiholeDomain,
} from './pihole';

// Create Better Auth tables (drizzle-kit doesn't support bun:sqlite)
createAuthTables();

// Seed test teachers on startup
seedTestTeachers();

// Define Hono app with typed variables for auth
const app = new Hono<{
    Variables: {
        user: typeof auth.$Infer.Session.user | null;
        session: typeof auth.$Infer.Session.session | null;
    };
}>({});

// Logger middleware
app.use(logger());

app.use(
    '*',
    cors({
        origin: ['http://10.10.1.10:5173', 'http://localhost:5173'],
        allowHeaders: ['Content-Type', 'Authorization', 'Set-Cookie'],
        allowMethods: ['POST', 'GET', 'OPTIONS', 'PUT', 'DELETE', 'PATCH'],
        exposeHeaders: ['Content-Length', 'Set-Cookie'],
        maxAge: 600,
        credentials: true,
    }),
);

// Auth middleware - populate user/session in context
app.use('*', async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
        c.set('user', null);
        c.set('session', null);
    } else {
        c.set('user', session.user);
        c.set('session', session.session);
    }

    await next();
});

// Mount Better Auth handler at /api/auth/*
app.on(['POST', 'GET'], '/api/auth/*', (c) => {
    return auth.handler(c.req.raw);
});

// API Routes
app.get('/api/config', (c) => {
    return c.json({
        allowSignup: process.env.ALLOW_SIGNUP === 'true',
    });
});

app.get('/api/labs', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    try {
        const labs = config.labs.map((lab) => ({
            id: lab.id,
            name: lab.name,
            dhcpServer: lab.dhcpServer,
            subnet: lab.subnet,
            ruleId: lab.ruleId,
        }));

        return c.json({ labs });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

app.get('/api/labs/:labId/stats', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const labId = c.req.param('labId');

    try {
        const lab = config.labs.find((l) => l.id === labId);
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

        return c.json(stats);
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

app.post('/api/labs/:labId/toggle', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const labId = c.req.param('labId');

    try {
        const body = await c.req.json<{ enable: boolean }>();
        const { enable } = body;
        const lab = config.labs.find((l) => l.id === labId);

        if (!lab) {
            return c.json({ error: 'Lab not found' }, 404);
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

app.get('/api/labs/:labId/history', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const labId = c.req.param('labId');
    const { eq, desc, gte, and } = await import('drizzle-orm');
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    try {
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
        for (const lab of config.labs) {
            const ruleResponse = await getRuleStatus(lab.ruleId);
            if (ruleResponse.success && ruleResponse.data?.bytes) {
                const totalBytes = ruleResponse.data.bytes;
                const usageMB = Math.round(Number(totalBytes) / (1024 * 1024));

                await db.insert(dataUsageHistory).values({
                    id: crypto.randomUUID(),
                    labId: lab.id,
                    totalBytes,
                    usageMB,
                    createdAt: new Date(),
                });
            }
        }
        console.log('✓ Data usage snapshots saved');
    } catch (error) {
        console.error('Failed to save data usage snapshot:', error);
    }
}

const DATA_USAGE_SNAPSHOT_INTERVAL = parseInt(
    process.env.DATA_USAGE_SNAPSHOT_INTERVAL || '300000',
    10,
);
setInterval(saveDataUsageSnapshot, DATA_USAGE_SNAPSHOT_INTERVAL);
saveDataUsageSnapshot();

app.get('/api/labs/:labId/usage-history', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const labId = c.req.param('labId');
    const { eq, desc, gte, and } = await import('drizzle-orm');
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

// Pi-hole API routes
app.get('/api/pihole/status', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    return c.json({
        configured: isPiholeConfigured(),
        url: process.env.PIHOLE_URL || null,
    });
});

app.get('/api/pihole/summary', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const result = await getPiholeSummary();
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

app.get('/api/pihole/top-domains', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const count = parseInt(c.req.query('count') || '10', 10);
    const blocked = c.req.query('blocked') !== 'false';
    const result = await getPiholeTopDomains(blocked, count);
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

app.get('/api/pihole/recent-blocked', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const count = parseInt(c.req.query('count') || '20', 10);
    const result = await getPiholeRecentBlocked(count);
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

app.get('/api/pihole/queries', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const length = parseInt(c.req.query('length') || '100', 10);
    const result = await getPiholeQueries(length);
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

app.get('/api/pihole/domains', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const result = await getPiholeDomains();
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

app.post('/api/pihole/domains', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    try {
        const body = await c.req.json<{
            domain: string;
            type?: 'allow' | 'deny';
            kind?: 'exact' | 'regex';
            comment?: string;
            enabled?: boolean;
        }>();
        const result = await addPiholeDomain(
            body.domain,
            body.type || 'deny',
            body.kind || 'exact',
            body.comment || '',
            body.enabled !== false,
        );
        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }
        return c.json(result.data);
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

app.delete('/api/pihole/domains', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    try {
        const body = await c.req.json<{
            domain: string;
            type: 'allow' | 'deny';
            kind: 'exact' | 'regex';
        }>();
        const result = await deletePiholeDomain(
            body.type,
            body.kind,
            body.domain,
        );
        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }
        return c.json({ success: true });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

app.put('/api/pihole/domains', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    try {
        const body = await c.req.json<{
            domain: string;
            type: 'allow' | 'deny';
            kind: 'exact' | 'regex';
            enabled?: boolean;
            comment?: string;
            groups?: number[];
            newType?: 'allow' | 'deny';
            newKind?: 'exact' | 'regex';
        }>();
        const result = await updatePiholeDomain(
            body.type,
            body.kind,
            body.domain,
            {
                enabled: body.enabled,
                comment: body.comment,
                groups: body.groups,
                newType: body.newType,
                newKind: body.newKind,
            },
        );
        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }
        return c.json(result.data);
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

app.get('/api/pihole/blocking', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const result = await getPiholeBlocking();
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

app.post('/api/pihole/blocking', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    try {
        const body = await c.req.json<{
            blocking: boolean;
            timer?: number | null;
        }>();
        const result = await setPiholeBlocking(body.blocking, body.timer);
        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }
        return c.json(result.data);
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// FOG Project API routes
app.get('/api/fog/status', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    return c.json({
        configured: isFogConfigured(),
        url: process.env.FOG_URL || null,
    });
});

app.get('/api/fog/system-info', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const result = await getFogSystemInfo();
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

app.get('/api/fog/hosts', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const search = c.req.query('search');
    const result = await listFogHosts(search || undefined);
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

app.get('/api/fog/hosts/:id', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) {
        return c.json({ error: 'Invalid host ID' }, 400);
    }

    const result = await getFogHost(id);
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

app.post('/api/fog/hosts', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    try {
        const body = await c.req.json<Record<string, unknown>>();
        const result = await createFogHost(body);
        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }
        return c.json(result.data);
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

app.put('/api/fog/hosts/:id', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) {
        return c.json({ error: 'Invalid host ID' }, 400);
    }

    try {
        const body = await c.req.json<Record<string, unknown>>();
        const result = await updateFogHost(id, body);
        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }
        return c.json(result.data);
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

app.delete('/api/fog/hosts/:id', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) {
        return c.json({ error: 'Invalid host ID' }, 400);
    }

    const result = await deleteFogHost(id);
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json({ success: true });
});

app.get('/api/fog/images', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const result = await listFogImages();
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

app.get('/api/fog/tasktypes', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const result = await listFogTaskTypes();
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

app.get('/api/fog/snapins', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const result = await listFogSnapins();
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

app.get('/api/fog/tasks/active', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const result = await listActiveTasks();
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

app.get('/api/fog/multicastsessions/current', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const result = await listActiveMulticastSessions();
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

app.post('/api/fog/hosts/:id/task', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const hostId = parseInt(c.req.param('id'), 10);
    if (isNaN(hostId)) {
        return c.json({ error: 'Invalid host ID' }, 400);
    }

    try {
        const body = await c.req.json<{
            taskType: string;
            [key: string]: unknown;
        }>();
        const { taskType, ...options } = body;
        const result = await createFogTask(
            hostId,
            parseInt(body.taskType, 10),
            options,
        );
        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }
        return c.json(result.data);
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

app.post('/api/fog/hosts/:id/snapin-task', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const hostId = parseInt(c.req.param('id'), 10);
    if (isNaN(hostId)) {
        return c.json({ error: 'Invalid host ID' }, 400);
    }

    try {
        const body = await c.req.json<{
            snapinID: number;
            [key: string]: unknown;
        }>();
        const result = await createFogSnapinTask(hostId, body.snapinID, body);
        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }
        return c.json(result.data);
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// Start server
const port = config.server.port;

const frontendDist = path.resolve(__dirname, '../frontend/build');
app.use('/assets/*', serveStatic({ root: frontendDist }));
app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api/')) {
        await next();
        return;
    }
    return serveStatic({ path: path.join(frontendDist, 'index.html') })(
        c,
        next,
    );
});

serve({ fetch: app.fetch, port }, (info) => {
    console.log(
        `🚀 Teacher Dashboard running on http://localhost:${info.port}`,
    );
    console.log(`📝 Better Auth endpoints available at /api/auth/*`);
    console.log(`   Sign in with username: POST /api/auth/sign-in/username`);
    console.log(`   Session check: GET /api/auth/session`);
    console.log(`   Sign out: POST /api/auth/sign-out`);
});
