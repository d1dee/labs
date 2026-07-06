import process from 'process';
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
} from '../pihole';
import { createApp } from './context';

export const piholeRouter = createApp();

piholeRouter.get('/pihole/status', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    return c.json({
        configured: isPiholeConfigured(),
        url: process.env.PIHOLE_URL || null,
    });
});

piholeRouter.get('/pihole/summary', async (c) => {
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

piholeRouter.get('/pihole/top-domains', async (c) => {
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

piholeRouter.get('/pihole/recent-blocked', async (c) => {
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

piholeRouter.get('/pihole/queries', async (c) => {
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

piholeRouter.get('/pihole/domains', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const result = await getPiholeDomains();
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

    try {
        const body = await c.req.json<{
            domain: string;
            type?: 'allow' | 'deny';
            kind?: 'exact' | 'regex';
            comment?: string;
            enabled?: boolean;
        }>();

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
            const merged = await buildDemoPiholeDomainsResponse(
                user.id,
                getPiholeDomains,
            );
            return c.json(merged);
        }

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

piholeRouter.delete('/pihole/domains', async (c) => {
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

piholeRouter.put('/pihole/domains', async (c) => {
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
            const merged = await buildDemoPiholeDomainsResponse(
                user.id,
                getPiholeDomains,
            );
            return c.json(merged);
        }

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

piholeRouter.get('/pihole/blocking', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const result = await getPiholeBlocking();
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

    try {
        const body = await c.req.json<{
            blocking: boolean;
            timer?: number | null;
        }>();

        // Demo mode: persist blocking state in demo state
        if (isDemoUser(user)) {
            await setDemoPiholeBlocking(user.id, body.blocking, body.timer);
            return c.json({
                blocking: body.blocking ? 'enabled' : 'disabled',
                timer: body.timer ?? null,
                took: 0,
            });
        }

        const result = await setPiholeBlocking(body.blocking, body.timer);
        if (!result.success) {
            return c.json({ error: result.error }, 500);
        }
        return c.json(result.data);
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});
