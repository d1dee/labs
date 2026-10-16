import {
    applyDemoFogHosts,
    applyDemoFogHost,
    createDemoFogHost,
    deleteDemoFogHost,
    generateDemoFogHostId,
    getDemoFogHostOverrides,
    isDemoUser,
    updateDemoFogHost,
} from '../demo';
import { credentialsComplete, getFogClient, getFogCredentials } from '../fog';
import { getComputerInventory, removeKnownFogHost } from '../computer-inventory';
import { createApp } from './context';
import { z } from 'zod';
import { errorProperty, getLogger } from '../logger';

export const fogRouter = createApp();
const fogLogger = getLogger(['labs', 'fog', 'routes']);

const positiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
fogRouter.use('/fog/*', async (c, next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Not authenticated' }, 401);
    if (!user.organizationId) return c.json({ error: 'You must join an organization first' }, 403);
    const path = c.req.path;
    const rawId = path.match(/\/fog\/(?:hosts|tasks)\/([^/]+)/)?.[1];
    if (rawId && rawId !== 'active' &&
        (!/^-?[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(Number(rawId)) ||
            (Number(rawId) < 0 && !isDemoUser(user)))) {
        return c.json({ error: 'Invalid resource ID' }, 400);
    }
    if (['POST', 'PUT'].includes(c.req.method) && !/\/tasks\/[^/]+\/(cancel|force)$/.test(path)) {
        try {
            const body = z.record(z.string(), z.unknown()).parse(await c.req.json());
            if (/\/hosts\/[^/]+\/task$/.test(path)) {
                z.union([positiveId, z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(positiveId)]).parse(body.taskType);
            } else if (/\/hosts\/[^/]+\/snapin-task$/.test(path)) {
                positiveId.parse(body.snapinID);
            } else if (/\/tasks\/[^/]+\/restart$/.test(path)) {
                z.object({ hostId: positiveId.optional(), taskTypeId: positiveId.optional() }).parse(body);
            }
        } catch (error) {
            fogLogger.warn('Invalid FOG request body', { method: c.req.method, path, error: errorProperty(error) });
            return c.json({ error: 'Invalid request body' }, 400);
        }
    }
    await next();
    if (c.req.method !== 'GET' && c.res.ok && !isDemoUser(user) && /\/fog\/hosts(?:\/[1-9]\d*)?$/.test(path)) {
        try {
            await getComputerInventory(user.organizationId, true);
        } catch (error) {
            fogLogger.warn('Inventory refresh failed after successful FOG mutation', { error: errorProperty(error) });
        }
        if (c.req.method === 'DELETE' && /\/fog\/hosts\/[1-9]\d*$/.test(path)) {
            try {
                await removeKnownFogHost(user.organizationId, Number(rawId));
            } catch (error) {
                fogLogger.warn('Could not persist known FOG host deletion', { error: errorProperty(error) });
            }
        }
    }
});

fogRouter.get('/fog/status', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const creds = await getFogCredentials(user.organizationId);
    return c.json({
        configured: credentialsComplete(creds),
        url: creds?.url || null,
    });
});

fogRouter.get('/fog/system-info', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const client = await getFogClient(user.organizationId);
    const result = await client.getSystemInfo();
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

fogRouter.get('/fog/hosts', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const search = c.req.query('search');
    const inventory = await getComputerInventory(user.organizationId);
    const hosts = inventory.hosts.filter((host) => !search || host.name.toLowerCase().includes(search.toLowerCase()));
    const result = { data: { count: hosts.length, hosts, inventoryWarning: inventory.warning } };

    // Demo mode: apply host overrides
    if (isDemoUser(user)) {
        const overrides = await getDemoFogHostOverrides(user.id);
        return c.json(applyDemoFogHosts(result.data!, overrides));
    }

    return c.json(result.data);
});

fogRouter.get('/fog/hosts/:id', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) {
        return c.json({ error: 'Invalid host ID' }, 400);
    }

    const client = await getFogClient(user.organizationId);

    // Demo mode: check for demo-created host first
    if (isDemoUser(user)) {
        const overrides = await getDemoFogHostOverrides(user.id);
        const demoCreation = overrides.creations.find((o) => o.id === id);
        if (demoCreation) {
            return c.json(demoCreation);
        }
    }

    const result = await client.getHost(id);
    if (!result.success) {
        if (!isDemoUser(user)) {
            const inventory = await getComputerInventory(user.organizationId);
            const cached = inventory.hosts.find((host) => host.id === id);
            if (cached) return c.json({ ...cached, inventoryWarning: inventory.warning ?? 'FOG host details unavailable. Showing the last complete snapshot.' });
        }
        return c.json({ error: result.error }, 500);
    }

    // Demo mode: apply update overrides
    if (isDemoUser(user)) {
        const overrides = await getDemoFogHostOverrides(user.id);
        const updatedHost = applyDemoFogHost(result.data!, overrides, id);
        return c.json(updatedHost);
    }

    return c.json(result.data);
});

fogRouter.post('/fog/hosts', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    try {
        const body = await c.req.json<Record<string, unknown>>();
        const client = await getFogClient(user.organizationId);

        // Demo mode: persist host creation in demo state
        if (isDemoUser(user)) {
            const demoId = generateDemoFogHostId();
            await createDemoFogHost(user.id, demoId, body);
            return c.json({
                name: (body.name as string) || 'Demo Host',
                description: (body.description as string) || '',
                macs: (body.macs as string[]) || [],
                ...body,
                id: demoId,
            });
        }

        const result = await client.createHost(body);
        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }
        return c.json(result.data);
    } catch (error) {
        fogLogger.error('FOG host creation failed', { error: errorProperty(error) });
        return c.json({ error: String(error) }, 500);
    }
});

fogRouter.put('/fog/hosts/:id', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) {
        return c.json({ error: 'Invalid host ID' }, 400);
    }

    try {
        const body = await c.req.json<Record<string, unknown>>();
        const client = await getFogClient(user.organizationId);

        // Demo mode: persist host update in demo state
        if (isDemoUser(user)) {
            await updateDemoFogHost(user.id, id, body);
            // Return updated host by merging with real data if available
            const result = await client.getHost(id);
            if (result.success && result.data) {
                const overrides = await getDemoFogHostOverrides(user.id);
                return c.json(applyDemoFogHost(result.data, overrides, id));
            }
            return c.json({ ...body, id });
        }

        const result = await client.updateHost(id, body);
        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }
        return c.json(result.data);
    } catch (error) {
        fogLogger.error('FOG host update failed', { hostId: id, error: errorProperty(error) });
        return c.json({ error: String(error) }, 500);
    }
});

fogRouter.delete('/fog/hosts/:id', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const id = parseInt(c.req.param('id'), 10);
    if (isNaN(id)) {
        return c.json({ error: 'Invalid host ID' }, 400);
    }

    const client = await getFogClient(user.organizationId);

    // Demo mode: persist host deletion in demo state
    if (isDemoUser(user)) {
        await deleteDemoFogHost(user.id, id);
        return c.json({ success: true });
    }

    const result = await client.deleteHost(id);
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json({ success: true });
});

fogRouter.get('/fog/images', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const client = await getFogClient(user.organizationId);
    const result = await client.listImages();
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

fogRouter.get('/fog/tasktypes', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const client = await getFogClient(user.organizationId);
    const result = await client.listTaskTypes();
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

fogRouter.get('/fog/snapins', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const client = await getFogClient(user.organizationId);
    const result = await client.listSnapins();
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

fogRouter.get('/fog/tasks/active', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const client = await getFogClient(user.organizationId);
    const result = await client.listActiveTasks();
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

fogRouter.get('/fog/multicastsessions/current', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const client = await getFogClient(user.organizationId);
    const result = await client.listActiveMulticastSessions();
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

fogRouter.post('/fog/hosts/:id/task', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const hostId = parseInt(c.req.param('id'), 10);
    if (isNaN(hostId)) {
        return c.json({ error: 'Invalid host ID' }, 400);
    }

    try {
        const body = await c.req.json<{
            taskType: string | number;
            [key: string]: unknown;
        }>();
        const client = await getFogClient(user.organizationId);

        // Demo mode: return success without creating real task
        if (isDemoUser(user)) {
            return c.json({ success: true, id: 0, name: 'Demo Task' });
        }

        const { taskType, ...options } = body;
        const result = await client.createTask(
            hostId,
            Number(taskType),
            options,
        );
        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }
        return c.json(result.data);
    } catch (error) {
        fogLogger.error('FOG task creation failed', { hostId, error: errorProperty(error) });
        return c.json({ error: String(error) }, 500);
    }
});

fogRouter.post('/fog/tasks/:id/cancel', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const taskId = parseInt(c.req.param('id'), 10);
    if (isNaN(taskId)) {
        return c.json({ error: 'Invalid task ID' }, 400);
    }

    if (isDemoUser(user)) {
        return c.json({ success: true });
    }

    const client = await getFogClient(user.organizationId);
    const result = await client.cancelTask(taskId);
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json({ success: true });
});

fogRouter.post('/fog/tasks/:id/force', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const taskId = parseInt(c.req.param('id'), 10);
    if (isNaN(taskId)) {
        return c.json({ error: 'Invalid task ID' }, 400);
    }

    if (isDemoUser(user)) {
        return c.json({ success: true });
    }

    const client = await getFogClient(user.organizationId);
    const result = await client.forceTask(taskId);
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json({ success: true });
});

fogRouter.post('/fog/tasks/:id/restart', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const taskId = parseInt(c.req.param('id'), 10);
    if (isNaN(taskId)) {
        return c.json({ error: 'Invalid task ID' }, 400);
    }

    if (isDemoUser(user)) {
        return c.json({ success: true });
    }

    try {
        const body = await c.req.json<{
            hostId?: number;
            taskTypeId?: number;
        }>();
        const client = await getFogClient(user.organizationId);
        const result = await client.restartTask(
            taskId,
            body.hostId,
            body.taskTypeId,
        );
        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }
        return c.json({ success: true });
    } catch (error) {
        fogLogger.error('FOG task restart failed', { taskId, error: errorProperty(error) });
        return c.json({ error: String(error) }, 500);
    }
});

fogRouter.post('/fog/hosts/:id/snapin-task', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
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
        const client = await getFogClient(user.organizationId);

        // Demo mode: return success without creating real snapin task
        if (isDemoUser(user)) {
            return c.json({ success: true, id: 0, name: 'Demo Snapin Task' });
        }

        const { snapinID, ...options } = body;
        const result = await client.createSnapinTask(hostId, snapinID, options);
        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }
        return c.json(result.data);
    } catch (error) {
        fogLogger.error('FOG snapin task creation failed', { hostId, error: errorProperty(error) });
        return c.json({ error: String(error) }, 500);
    }
});
