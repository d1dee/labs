import type { MiddlewareHandler } from 'hono';
import { getOrganizationDevices, invalidateOrganizationDevices } from '../devices';
import { getFirewallConfigWithLabs } from '../firewall-config';
import { callMikrotik } from '../mikrotik';
import { normalizeDeviceMac } from '../../frontend/src/api/devices';
import { getLogger } from '../logger';
import { isDemoUser } from '../demo';
import { createApp, type AppEnv } from './context';

const logger = getLogger(['labs', 'devices']);
const dependencies = {
    getOrganizationDevices: (organizationId: string) => getOrganizationDevices(organizationId),
    getFirewallConfigWithLabs: (organizationId: string) => getFirewallConfigWithLabs(organizationId),
    callMikrotik: (...args: Parameters<typeof callMikrotik>) => callMikrotik(...args),
    now: () => Date.now(),
};

export const invalidateDeviceDirectoryAfterMutation: MiddlewareHandler<AppEnv> = async (c, next) => {
    await next();
    const organizationId = c.get('user')?.organizationId;
    if (!organizationId || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method) || c.res.status < 200 || c.res.status >= 300) return;
    if (/^\/api\/(?:settings\/(?:mikrotik|labs|fog|pihole|veyon)|fog\/hosts(?:\/[^/]+)?|veyon\/(?:computers(?:\/[^/]+)?|sync\/apply)|pihole\/dns\/(?:hosts|cnameRecords))$/.test(c.req.path)) {
        invalidateOrganizationDevices(organizationId);
    }
};

export function createDevicesRouter(overrides: Partial<typeof dependencies> = {}) {
    const deps = { ...dependencies, ...overrides };
    const router = createApp();
    const wakeRequests = new Map<string, number>();

    router.get('/devices', async (c) => {
        const user = c.get('user');
        if (!user) return c.json({ error: 'Not authenticated' }, 401);
        if (!user.organizationId) return c.json({ error: 'You must join an organization first' }, 403);
        c.header('Cache-Control', 'no-store');
        try {
            const directory = await deps.getOrganizationDevices(user.organizationId);
            if (directory.organizationId !== user.organizationId) {
                return c.json({ error: 'Unable to refresh device identities' }, 502);
            }
            return c.json(directory);
        } catch {
            return c.json({ error: 'Unable to refresh device identities' }, 502);
        }
    });

    router.post('/devices/:id/wake', async (c) => {
        const user = c.get('user');
        if (!user) return c.json({ error: 'Not authenticated' }, 401);
        if (!user.organizationId) return c.json({ error: 'You must join an organization first' }, 403);
        if (isDemoUser(user)) return c.json({ error: 'Wake is unavailable in demo mode', code: 'DEMO_READ_ONLY' }, 403);
        // Require JSON even for an empty body to prevent cross-site form submissions.
        if (c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
            return c.json({ error: 'Content-Type must be application/json' }, 415);
        }
        if (c.req.header('Sec-Fetch-Site') === 'cross-site') return c.json({ error: 'Cross-site requests are not allowed' }, 403);
        c.header('Cache-Control', 'no-store');
        const organizationId = user.organizationId;
        const deviceId = c.req.param('id');
        try {
            const [directory, config] = await Promise.all([
                deps.getOrganizationDevices(organizationId), deps.getFirewallConfigWithLabs(organizationId),
            ]);
            if (directory.organizationId !== organizationId) return c.json({ error: 'Unable to refresh device identities' }, 502);
            const device = directory.devices.find((entry) => entry.id === deviceId);
            if (!device) return c.json({ error: 'Device not found' }, 404);
            const macs = [...new Set(device.macAddresses.map(normalizeDeviceMac))];
            if (macs.length !== 1 || !macs[0] || macs[0] === '000000000000' || (parseInt(macs[0].slice(0, 2), 16) & 1)) {
                return c.json({ error: 'Wake requires one unambiguous unicast MAC address' }, 409);
            }
            const lab = config?.labs.find((entry) => entry.id === device.lab?.id);
            const networkInterface = lab?.interface?.trim();
            if (!networkInterface) return c.json({ error: 'Wake requires a detected lab with a configured MikroTik interface. Configure it in Settings > Labs.' }, 409);
            if (!config?.mikrotikBaseUrl || !config.mikrotikUsername || !config.mikrotikPassword) {
                return c.json({ error: 'Configure the MikroTik connection in Settings first' }, 409);
            }
            const now = deps.now();
            for (const [key, expiresAt] of wakeRequests) if (expiresAt <= now) wakeRequests.delete(key);
            const key = JSON.stringify([organizationId, macs[0]]);
            if (wakeRequests.has(key) || wakeRequests.size >= 1024) {
                c.header('Retry-After', '10');
                return c.json({ error: 'Please wait before sending another wake packet' }, 429);
            }
            // Reserve before awaiting the router so concurrent clicks cannot send duplicate packets.
            wakeRequests.set(key, now + 10_000);
            const result = await deps.callMikrotik(organizationId, '/tool/wol', 'POST', {
                mac: macs[0].match(/.{2}/g)!.join(':').toUpperCase(), interface: networkInterface,
            });
            logger.info('Wake packet requested', { organizationId, userId: user.id, deviceId, labId: lab!.id, success: result.success });
            if (!result.success) return c.json({ error: result.error || 'MikroTik could not send the wake packet' }, 502);
            return c.json({ success: true, message: 'Wake packet sent. The computer may take a moment to start.' });
        } catch {
            logger.warn('Wake request failed', { organizationId, userId: user.id, deviceId });
            return c.json({ error: 'Unable to send the wake packet through MikroTik' }, 502);
        }
    });
    return router;
}

export const devicesRouter = createDevicesRouter();
