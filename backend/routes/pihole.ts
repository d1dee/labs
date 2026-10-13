import {
    addDemoPiholeDomain,
    applyDemoPiholeDomains,
    buildDemoPiholeDomainsResponse,
    deleteDemoPiholeDomain,
    getDemoPiholeBlocking,
    getDemoPiholeDomainOverrides,
    isDemoUser,
    setDemoPiholeBlocking,
    updateDemoPiholeDomain,
} from '../demo';
import {
    getPiholeClient,
    getPiholeCredentials,
    type PiholeDnsElement,
} from '../pihole';
import { createApp } from './context';
import { z } from 'zod';

export const piholeRouter = createApp();

const domainIdentity = {
    domain: z.string().trim().min(1).max(1_024),
    type: z.enum(['allow', 'deny']),
    kind: z.enum(['exact', 'regex']),
};
const domainUpdates = {
    enabled: z.boolean().optional(),
    comment: z.string().max(4_096).optional(),
    groups: z.array(z.number().int().nonnegative()).max(100).optional(),
    newType: z.enum(['allow', 'deny']).optional(),
    newKind: z.enum(['exact', 'regex']).optional(),
};

piholeRouter.use('/pihole/*', async (c, next) => {
    // Authenticate before parsing bodies and reject invalid data before any upstream call.
    const user = c.get('user');
    if (!user) return c.json({ error: 'Not authenticated' }, 401);
    if (!user.organizationId) return c.json({ error: 'You must join an organization first' }, 403);
    if (['POST', 'PUT', 'DELETE'].includes(c.req.method)) {
        const path = c.req.path;
        const schema = path.endsWith('/pihole/domains')
            ? c.req.method === 'POST'
                ? z.object({ ...domainIdentity, type: domainIdentity.type.optional(), kind: domainIdentity.kind.optional(), ...domainUpdates })
                : z.object({ ...domainIdentity, ...domainUpdates })
            : path.endsWith('/pihole/blocking')
                ? z.object({ blocking: z.boolean(), timer: z.number().finite().nonnegative().nullable().optional() })
                : /\/pihole\/dns\/[^/]+$/.test(path)
                    ? z.object({ value: z.string().trim().min(1).max(4_096) }) : null;
        if (schema) {
            try { schema.parse(await c.req.json()); }
            catch { return c.json({ error: 'Invalid request body' }, 400); }
        }
    }
    await next();
});

const DNS_ELEMENTS: readonly PiholeDnsElement[] = [
    'upstreams',
    'hosts',
    'cnameRecords',
] as const;

function parseDnsElement(value: string): PiholeDnsElement | null {
    return DNS_ELEMENTS.includes(value as PiholeDnsElement)
        ? (value as PiholeDnsElement)
        : null;
}

piholeRouter.get('/pihole/status', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const creds = await getPiholeCredentials(user.organizationId);
    return c.json({
        configured: Boolean(creds?.url && creds?.password),
        url: creds?.url || null,
    });
});

piholeRouter.get('/pihole/summary', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const client = await getPiholeClient(user.organizationId);
    const result = await client.getSummary();
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

piholeRouter.get('/pihole/top-domains', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const countValue = c.req.query('count') ?? '10';
    const count = Number(countValue);
    const blockedValue = c.req.query('blocked') ?? 'true';
    if (
        !/^\d+$/.test(countValue) || !Number.isSafeInteger(count) || count < 1 || count > 100 ||
        !['true', 'false'].includes(blockedValue)
    ) {
        return c.json({ error: 'count must be an integer from 1 to 100 and blocked must be true or false' }, 400);
    }
    const fromValue = c.req.query('from');
    const untilValue = c.req.query('until');
    let range: { from: number; until: number } | undefined;
    if (fromValue !== undefined || untilValue !== undefined) {
        const from = Number(fromValue);
        const until = Number(untilValue);
        if (
            fromValue === undefined || untilValue === undefined ||
            !/^\d+$/.test(fromValue) || !/^\d+$/.test(untilValue) ||
            !Number.isSafeInteger(from) || !Number.isSafeInteger(until) || from > until
        ) {
            return c.json({ error: 'from and until must be non-negative Unix timestamps with from <= until' }, 400);
        }
        range = { from, until };
    }
    const blocked = blockedValue === 'true';
    const client = await getPiholeClient(user.organizationId);
    const result = await client.getTopDomains(blocked, count, range);
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

piholeRouter.get('/pihole/recent-blocked', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const countValue = c.req.query('count') ?? '20';
    const count = Number(countValue);
    if (!/^\d+$/.test(countValue) || !Number.isSafeInteger(count) || count < 1 || count > 100) {
        return c.json({ error: 'count must be an integer from 1 to 100' }, 400);
    }
    const client = await getPiholeClient(user.organizationId);
    const result = await client.getRecentBlocked(count);
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

piholeRouter.get('/pihole/queries', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const lengthValue = c.req.query('length') ?? '100';
    const length = Number(lengthValue);
    if (!/^\d+$/.test(lengthValue) || !Number.isSafeInteger(length) || length < 1 || length > 1_000) {
        return c.json({ error: 'length must be an integer from 1 to 1000' }, 400);
    }
    const client = await getPiholeClient(user.organizationId);
    const result = await client.getQueries(length);
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

piholeRouter.get('/pihole/domains', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const client = await getPiholeClient(user.organizationId);
    const result = await client.getDomains();
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }

    // Demo mode: apply domain overrides
    if (isDemoUser(user)) {
        const overrides = await getDemoPiholeDomainOverrides(user.id);
        return c.json(applyDemoPiholeDomains(result.data!, overrides));
    }

    return c.json(result.data);
});

piholeRouter.post('/pihole/domains', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    try {
        const body = await c.req.json<{
            domain: string;
            type?: 'allow' | 'deny';
            kind?: 'exact' | 'regex';
            comment?: string;
            enabled?: boolean;
        }>();

        const client = await getPiholeClient(user.organizationId);

        // Demo mode: persist domain addition in demo state
        if (isDemoUser(user)) {
            await addDemoPiholeDomain(
                user.id,
                body.domain,
                body.type || 'deny',
                body.kind || 'exact',
                body.comment || '',
                body.enabled !== false,
            );
            // Return merged domain list
            const merged = await buildDemoPiholeDomainsResponse(user.id, () =>
                client.getDomains(),
            );
            return c.json(merged);
        }

        const result = await client.addDomain(
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

piholeRouter.delete('/pihole/domains', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    try {
        const body = await c.req.json<{
            domain: string;
            type: 'allow' | 'deny';
            kind: 'exact' | 'regex';
        }>();

        const client = await getPiholeClient(user.organizationId);

        // Demo mode: persist domain deletion in demo state
        if (isDemoUser(user)) {
            await deleteDemoPiholeDomain(
                user.id,
                body.domain,
                body.type,
                body.kind,
            );
            return c.json({ success: true });
        }

        const result = await client.deleteDomain(body.type, body.kind, body.domain);
        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }
        return c.json({ success: true });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

piholeRouter.put('/pihole/domains', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
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

        const client = await getPiholeClient(user.organizationId);

        // Demo mode: persist domain update in demo state
        if (isDemoUser(user)) {
            await updateDemoPiholeDomain(user.id, body.domain, {
                enabled: body.enabled,
                comment: body.comment,
                groups: body.groups,
                newType: body.newType,
                newKind: body.newKind,
            });
            // Return merged domain list
            const merged = await buildDemoPiholeDomainsResponse(user.id, () =>
                client.getDomains(),
            );
            return c.json(merged);
        }

        const result = await client.updateDomain(
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

piholeRouter.get('/pihole/blocking', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const client = await getPiholeClient(user.organizationId);
    const result = await client.getBlocking();
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }

    // Demo mode: apply blocking state override
    if (isDemoUser(user)) {
        const demoBlocking = await getDemoPiholeBlocking(user.id);
        if (demoBlocking) {
            return c.json(demoBlocking);
        }
    }

    return c.json(result.data);
});

piholeRouter.post('/pihole/blocking', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    try {
        const body = await c.req.json<{
            blocking: boolean;
            timer?: number | null;
        }>();

        const client = await getPiholeClient(user.organizationId);

        // Demo mode: persist blocking state in demo state
        if (isDemoUser(user)) {
            await setDemoPiholeBlocking(user.id, body.blocking, body.timer);
            return c.json({
                blocking: body.blocking ? 'enabled' : 'disabled',
                timer: body.timer ?? null,
                took: 0,
            });
        }

        const result = await client.setBlocking(body.blocking, body.timer);
        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }
        return c.json(result.data);
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// ===================== DNS settings (config) =====================
// Manages Pi-hole's DNS configuration arrays:
//   - upstreams    : upstream DNS servers (e.g. "8.8.8.8", "127.0.0.1#5353")
//   - hosts        : local A/AAAA DNS records (e.g. "192.168.1.10 myhost")
//   - cnameRecords : CNAME records (e.g. "alias.local,target.local,3600")

piholeRouter.get('/pihole/dns/:element', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const element = parseDnsElement(c.req.param('element'));
    if (!element) {
        return c.json({ error: 'Invalid DNS element' }, 400);
    }

    // Demo mode: return an empty list so the settings UI is usable
    if (isDemoUser(user)) {
        return c.json({ element, items: [] });
    }

    const client = await getPiholeClient(user.organizationId);
    const result = await client.getDnsList(element);
    if (!result.success) {
        return c.json({ error: result.error }, 500);
    }
    return c.json(result.data);
});

piholeRouter.post('/pihole/dns/:element', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const element = parseDnsElement(c.req.param('element'));
    if (!element) {
        return c.json({ error: 'Invalid DNS element' }, 400);
    }

    try {
        const body = await c.req.json<{ value: string }>();
        if (!body.value || !body.value.trim()) {
            return c.json({ error: 'A "value" string is required' }, 400);
        }

        // Demo mode: no-op success
        if (isDemoUser(user)) {
            return c.json({ success: true });
        }

        const client = await getPiholeClient(user.organizationId);
        const result = await client.addDnsItem(element, body.value.trim());
        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }
        return c.json(result.data);
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

piholeRouter.delete('/pihole/dns/:element', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const element = parseDnsElement(c.req.param('element'));
    if (!element) {
        return c.json({ error: 'Invalid DNS element' }, 400);
    }

    try {
        const body = await c.req.json<{ value: string }>();
        if (!body.value || !body.value.trim()) {
            return c.json({ error: 'A "value" string is required' }, 400);
        }

        // Demo mode: no-op success
        if (isDemoUser(user)) {
            return c.json({ success: true });
        }

        const client = await getPiholeClient(user.organizationId);
        const result = await client.deleteDnsItem(element, body.value.trim());
        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }
        return c.json(result.data);
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});
