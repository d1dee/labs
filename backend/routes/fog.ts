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
import { createApp } from './context';

export const fogRouter = createApp();

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
    const client = await getFogClient(user.organizationId);
    const result = await client.listHosts(search || undefined);
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }

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
                id: demoId,
                name: (body.name as string) || 'Demo Host',
                description: (body.description as string) || '',
                macs: (body.macs as string[]) || [],
                ...body,
            });
        }

        const result = await client.createHost(body);
        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }
        return c.json(result.data);
    } catch (error) {
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
            return c.json({ id, ...body });
        }

        const result = await client.updateHost(id, body);
        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }
        return c.json(result.data);
    } catch (error) {
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
            taskType: string;
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
        return c.json({ error: String(error) }, 500);
    }
});
