import type { MiddlewareHandler } from 'hono';
import { getOrganizationDevices, invalidateOrganizationDevices } from '../devices';
import { createApp, type AppEnv } from './context';

export const devicesRouter = createApp();

export const invalidateDeviceDirectoryAfterMutation: MiddlewareHandler<AppEnv> = async (c, next) => {
    await next();
    const organizationId = c.get('user')?.organizationId;
    if (!organizationId || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method) || c.res.status < 200 || c.res.status >= 300) return;
    if (/^\/api\/(?:settings\/(?:mikrotik|labs|fog|pihole|veyon)|fog\/hosts(?:\/[^/]+)?|veyon\/(?:computers(?:\/[^/]+)?|sync\/apply)|pihole\/dns\/(?:hosts|cnameRecords))$/.test(c.req.path)) {
        invalidateOrganizationDevices(organizationId);
    }
};

devicesRouter.get('/devices', async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Not authenticated' }, 401);
    if (!user.organizationId) return c.json({ error: 'You must join an organization first' }, 403);
    c.header('Cache-Control', 'no-store');
    try {
        const directory = await getOrganizationDevices(user.organizationId);
        if (directory.organizationId !== user.organizationId) {
            return c.json({ error: 'Unable to refresh device identities' }, 502);
        }
        return c.json(directory);
    } catch {
        return c.json({ error: 'Unable to refresh device identities' }, 502);
    }
});
