import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { VeyonSyncApplyResultItem } from '../../frontend/src/api/veyon';
import { db } from '../../db/database';
import { veyonComputer, veyonConfig } from '../../db/schema';
import { getFogClient, isFogConfigured } from '../fog';
import {
    getVeyonClient,
    listOpenConnections,
    VEYON_FEATURES,
    VeyonApiError,
} from '../veyon';
import { buildVeyonSyncPlan, type VeyonSyncPlan } from '../veyon-sync';
import { createApp } from './context';

export const veyonRouter = createApp();

const hostSchema = z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[a-zA-Z0-9._:[\]-]+$/, 'Invalid host address');
const idSchema = z.string().length(12);
const computerBodySchema = z.object({
    name: z.string().trim().min(1).max(100),
    host: hostSchema,
    macAddress: z
        .string()
        .trim()
        .regex(/^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/)
        .optional()
        .or(z.literal('')),
    location: z.string().trim().max(100).optional(),
});

const commandSchema = z.object({
    computerIds: z.array(idSchema).min(1).max(100),
    action: z.enum([
        'screen-lock',
        'input-lock',
        'user-login',
        'user-logoff',
        'reboot',
        'power-down',
        'start-app',
        'open-website',
        'text-message',
        'custom-feature',
    ]),
    active: z.boolean().default(true),
    arguments: z.record(z.string(), z.unknown()).default({}),
    featureUid: z.uuid().optional(),
});
const demoSchema = z.object({
    sourceComputerId: idSchema,
    computerIds: z.array(idSchema).min(1).max(100),
    windowed: z.boolean().default(false),
    active: z.boolean().default(true),
});
const syncApplySchema = z.object({
    additions: z.array(z.number().int()).optional(),
    renames: z.array(idSchema).optional(),
    removals: z.array(idSchema).optional(),
    links: z
        .array(z.object({ computerId: idSchema, fogHostId: z.number().int() }))
        .optional(),
    confirmRemovals: z.boolean().optional(),
});

function syncError(error: unknown): string {
    return error instanceof Error ? error.message : 'Sync operation failed';
}

// Shared per-item executor for /veyon/sync/apply: resolves each requested
// item against the fresh server-side plan, records stale misses, and pushes
// uniform success/failure results.
async function runSyncItems<TReq, TItem>(options: {
    requested: TReq[];
    planItems: TItem[];
    type: VeyonSyncApplyResultItem['type'];
    match: (item: TItem, requested: TReq) => boolean;
    idOf: (requested: TReq) => string | number;
    nameOf: (requested: TReq, item: TItem | null, success: boolean) => string;
    run: (item: TItem) => Promise<void>;
}): Promise<VeyonSyncApplyResultItem[]> {
    const results: VeyonSyncApplyResultItem[] = [];
    for (const requestedItem of options.requested) {
        const item =
            options.planItems.find((candidate) =>
                options.match(candidate, requestedItem),
            ) ?? null;
        if (!item) {
            results.push({
                type: options.type,
                id: options.idOf(requestedItem),
                name: options.nameOf(requestedItem, null, false),
                success: false,
                error: 'Stale plan — refresh the preview',
            });
            continue;
        }
        try {
            await options.run(item);
            results.push({
                type: options.type,
                id: options.idOf(requestedItem),
                name: options.nameOf(requestedItem, item, true),
                success: true,
            });
        } catch (error) {
            results.push({
                type: options.type,
                id: options.idOf(requestedItem),
                name: options.nameOf(requestedItem, item, false),
                success: false,
                error: syncError(error),
            });
        }
    }
    return results;
}

// Fetches FOG hosts and org computers, then builds a fresh sync plan.
// Returns { error } when the FOG request fails.
async function fetchSyncPlan(organizationId: string): Promise<
    | { error: string; plan?: undefined; computers?: undefined }
    | {
          error?: undefined;
          plan: VeyonSyncPlan;
          computers: Array<typeof veyonComputer.$inferSelect>;
      }
> {
    const fog = await getFogClient(organizationId);
    const hostsResult = await fog.listHosts();
    if (!hostsResult.success || !hostsResult.data) {
        return { error: hostsResult.error ?? 'Failed to list FOG hosts' };
    }
    // Deterministic ordering: tier matching in buildVeyonSyncPlan is
    // first-wins, so the preview must not depend on row order luck.
    const computers = await db.query.veyonComputer.findMany({
        where: eq(veyonComputer.organizationId, organizationId),
        orderBy: [asc(veyonComputer.createdAt), asc(veyonComputer.id)],
    });
    return {
        plan: buildVeyonSyncPlan(hostsResult.data.hosts, computers),
        computers,
    };
}

function apiError(c: any, error: unknown) {
    if (error instanceof z.ZodError) {
        return c.json(
            { error: error.issues[0]?.message ?? 'Invalid request', code: 'INVALID_DATA' },
            400,
        );
    }
    if (error instanceof VeyonApiError) {
        const status = error.status >= 400 && error.status <= 599 ? error.status : 502;
        return c.json({ error: error.message, code: error.code }, status as any);
    }
    if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
    ) {
        return c.json(
            { error: 'Veyon connection timed out', code: 'VEYON_TIMEOUT' },
            504,
        );
    }
    console.error('Veyon request failed:', error);
    return c.json({ error: 'Veyon request failed', code: 'VEYON_ERROR' }, 502);
}

function requireUser(c: any) {
    const user = c.get('user');
    if (!user) return { response: c.json({ error: 'Not authenticated' }, 401) };
    if (!user.organizationId) {
        return { response: c.json({ error: 'You must join an organization first' }, 403) };
    }
    return { user };
}

async function ownedComputer(organizationId: string, id: string) {
    return db.query.veyonComputer.findFirst({
        where: and(
            eq(veyonComputer.id, id),
            eq(veyonComputer.organizationId, organizationId),
        ),
    });
}

veyonRouter.get('/veyon/status', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    const config = await db.query.veyonConfig.findFirst({
        where: eq(veyonConfig.organizationId, auth.user.organizationId),
    });
    return c.json({ configured: Boolean(config), url: config?.url ?? null });
});

veyonRouter.get('/veyon/sync/preview', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    try {
        if (!(await isFogConfigured(auth.user.organizationId))) {
            return c.json({ fogConfigured: false, plan: null });
        }
        const fetched = await fetchSyncPlan(auth.user.organizationId);
        if (fetched.error) return c.json({ error: fetched.error }, 502);
        return c.json({ fogConfigured: true, plan: fetched.plan });
    } catch (error) {
        return apiError(c, error);
    }
});

veyonRouter.post('/veyon/sync/apply', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    try {
        const body = syncApplySchema.parse(await c.req.json());
        const requestedLinks = body.links ?? [];
        const requestedRenames = body.renames ?? [];
        const requestedAdditions = body.additions ?? [];
        const requestedRemovals = body.removals ?? [];
        if (
            requestedLinks.length +
                requestedRenames.length +
                requestedAdditions.length +
                requestedRemovals.length ===
            0
        ) {
            return c.json({ error: 'No sync operations requested' }, 400);
        }
        if (requestedRemovals.length > 0 && body.confirmRemovals !== true) {
            return c.json(
                { error: 'Removals require confirmRemovals to be true' },
                400,
            );
        }
        if (!(await isFogConfigured(auth.user.organizationId))) {
            return c.json({ error: 'FOG is not configured' }, 400);
        }
        const fetched = await fetchSyncPlan(auth.user.organizationId);
        if (fetched.error) return c.json({ error: fetched.error }, 502);
        const { plan, computers } = fetched as {
            plan: VeyonSyncPlan;
            computers: Array<typeof veyonComputer.$inferSelect>;
        };
        const organizationId = auth.user.organizationId;
        const nameOf = (id: string) =>
            computers.find((computer) => computer.id === id)?.name ?? id;
        const results: VeyonSyncApplyResultItem[] = [];

        // Requested ids are resolved against the fresh server-side plan;
        // client-supplied names/hosts are never trusted.
        results.push(
            ...(await runSyncItems({
                requested: requestedLinks,
                planItems: plan.links,
                type: 'link',
                match: (link, requested) =>
                    link.computerId === requested.computerId &&
                    link.fogHostId === requested.fogHostId,
                idOf: (requested) => requested.computerId,
                nameOf: (requested) => nameOf(requested.computerId),
                run: async (link) => {
                    await db
                        .update(veyonComputer)
                        .set({ fogHostId: link.fogHostId, updatedAt: new Date() })
                        .where(
                            and(
                                eq(veyonComputer.id, link.computerId),
                                eq(veyonComputer.organizationId, organizationId),
                            ),
                        );
                },
            })),
        );

        results.push(
            ...(await runSyncItems({
                requested: requestedRenames,
                planItems: plan.renames,
                type: 'rename',
                match: (rename, requestedId) => rename.computerId === requestedId,
                idOf: (requestedId) => requestedId,
                nameOf: (requestedId, rename, success) =>
                    rename
                        ? success
                            ? rename.newName
                            : rename.currentName
                        : nameOf(requestedId),
                run: async (rename) => {
                    await db
                        .update(veyonComputer)
                        .set({
                            name: rename.newName,
                            fogHostId: rename.fogHostId,
                            updatedAt: new Date(),
                        })
                        .where(
                            and(
                                eq(veyonComputer.id, rename.computerId),
                                eq(veyonComputer.organizationId, organizationId),
                            ),
                        );
                },
            })),
        );

        results.push(
            ...(await runSyncItems({
                requested: requestedAdditions,
                planItems: plan.additions,
                type: 'addition',
                match: (addition, requestedId) => addition.fogHostId === requestedId,
                idOf: (requestedId) => requestedId,
                nameOf: (requestedId, addition) =>
                    addition?.name ?? `FOG host ${requestedId}`,
                run: async (addition) => {
                    await db.insert(veyonComputer).values({
                        organizationId,
                        name: addition.name,
                        host: addition.host,
                        macAddress: addition.macAddress,
                        location: addition.location,
                        fogHostId: addition.fogHostId,
                    });
                },
            })),
        );

        if (requestedRemovals.length > 0) {
            // Mirror DELETE /veyon/computers/:id — an unreachable Veyon host
            // must not block the row deletion. Close every validated target
            // concurrently first (failures are swallowed), then delete rows
            // sequentially with per-item results.
            const client = await getVeyonClient(
                organizationId,
                auth.user.id,
            ).catch(() => null);
            const closeTargets = requestedRemovals.flatMap((requestedId) => {
                const removal = plan.removals.find(
                    (item) => item.computerId === requestedId,
                );
                return removal ? [removal.host] : [];
            });
            await Promise.allSettled(
                closeTargets.map((host) => client?.close(host)),
            );
            results.push(
                ...(await runSyncItems({
                    requested: requestedRemovals,
                    planItems: plan.removals,
                    type: 'removal',
                    match: (removal, requestedId) => removal.computerId === requestedId,
                    idOf: (requestedId) => requestedId,
                    nameOf: (requestedId, removal) => removal?.name ?? nameOf(requestedId),
                    run: async (removal) => {
                        await db
                            .delete(veyonComputer)
                            .where(
                                and(
                                    eq(veyonComputer.id, removal.computerId),
                                    eq(
                                        veyonComputer.organizationId,
                                        organizationId,
                                    ),
                                ),
                            );
                    },
                })),
            );
        }

        return c.json({
            success: results.every((result) => result.success),
            results,
        });
    } catch (error) {
        return apiError(c, error);
    }
});

veyonRouter.get('/veyon/computers', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    const computers = await db.query.veyonComputer.findMany({
        where: eq(veyonComputer.organizationId, auth.user.organizationId),
        orderBy: (computer, { asc }) => [asc(computer.location), asc(computer.name)],
    });
    return c.json({ computers });
});

veyonRouter.post('/veyon/computers', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    try {
        const body = computerBodySchema.parse(await c.req.json());
        const [computer] = await db
            .insert(veyonComputer)
            .values({
                organizationId: auth.user.organizationId,
                ...body,
                macAddress: body.macAddress || null,
                location: body.location || null,
            })
            .returning();
        return c.json(computer, 201);
    } catch (error) {
        return apiError(c, error);
    }
});

veyonRouter.put('/veyon/computers/:id', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    try {
        const id = idSchema.parse(c.req.param('id'));
        if (!(await ownedComputer(auth.user.organizationId, id))) {
            return c.json({ error: 'Computer not found' }, 404);
        }
        const body = computerBodySchema.parse(await c.req.json());
        const [computer] = await db
            .update(veyonComputer)
            .set({
                ...body,
                macAddress: body.macAddress || null,
                location: body.location || null,
                updatedAt: new Date(),
            })
            .where(eq(veyonComputer.id, id))
            .returning();
        return c.json(computer);
    } catch (error) {
        return apiError(c, error);
    }
});

veyonRouter.delete('/veyon/computers/:id', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    try {
        const id = idSchema.parse(c.req.param('id'));
        const computer = await ownedComputer(auth.user.organizationId, id);
        if (!computer) return c.json({ error: 'Computer not found' }, 404);
        const client = await getVeyonClient(auth.user.organizationId, auth.user.id).catch(
            () => null,
        );
        await client?.close(computer.host);
        await db.delete(veyonComputer).where(eq(veyonComputer.id, id));
        return c.json({ success: true });
    } catch (error) {
        return apiError(c, error);
    }
});

veyonRouter.get('/veyon/computers/:id/information', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    try {
        const computer = await ownedComputer(
            auth.user.organizationId,
            idSchema.parse(c.req.param('id')),
        );
        if (!computer) return c.json({ error: 'Computer not found' }, 404);
        const client = await getVeyonClient(auth.user.organizationId, auth.user.id);
        return c.json(await client.information(computer.host));
    } catch (error) {
        return apiError(c, error);
    }
});

veyonRouter.get('/veyon/computers/:id/framebuffer', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    try {
        const computer = await ownedComputer(
            auth.user.organizationId,
            idSchema.parse(c.req.param('id')),
        );
        if (!computer) return c.json({ error: 'Computer not found' }, 404);
        const query = new URLSearchParams({
            format: c.req.query('format') === 'png' ? 'png' : 'jpeg',
            quality: c.req.query('quality') ?? '72',
        });
        if (c.req.query('width')) query.set('width', c.req.query('width')!);
        if (c.req.query('height')) query.set('height', c.req.query('height')!);
        if (c.req.query('compression')) query.set('compression', c.req.query('compression')!);
        const client = await getVeyonClient(auth.user.organizationId, auth.user.id);
        // Observe client disconnects: the wall polls this route ~16×/s and
        // abandoned requests must not keep an upstream fetch (or its 503
        // retry) alive for the full timeout.
        const upstreamSignal = () =>
            AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(12_000)]);
        let response: Response;
        try {
            response = await client.framebuffer(computer.host, query, upstreamSignal());
        } catch (error) {
            // Veyon reports 503 while the VNC framebuffer initializes after a
            // fresh connection; a single delayed retry usually succeeds —
            // but never for a client that already went away.
            if (
                !(error instanceof VeyonApiError) ||
                error.status !== 503 ||
                c.req.raw.signal.aborted
            ) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 700));
            response = await client.framebuffer(computer.host, query, upstreamSignal());
        }
        return new Response(response.body, {
            status: 200,
            headers: {
                'Content-Type': response.headers.get('Content-Type') || 'image/jpeg',
                'Cache-Control': 'no-store, private',
                'Content-Disposition': c.req.query('download') === 'true'
                    ? `attachment; filename="${computer.name.replace(/[^a-z0-9_-]/gi, '_')}-${Date.now()}.${query.get('format')}"`
                    : 'inline',
            },
        });
    } catch (error) {
        return apiError(c, error);
    }
});

veyonRouter.get('/veyon/computers/:id/features', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    try {
        const computer = await ownedComputer(
            auth.user.organizationId,
            idSchema.parse(c.req.param('id')),
        );
        if (!computer) return c.json({ error: 'Computer not found' }, 404);
        const client = await getVeyonClient(auth.user.organizationId, auth.user.id);
        return c.json(await client.features(computer.host));
    } catch (error) {
        return apiError(c, error);
    }
});

// GET /api/v1/hoststate/<host> — reachability of the Veyon Server without
// performing key authentication (useful for diagnostics).
veyonRouter.get('/veyon/computers/:id/hoststate', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    try {
        const computer = await ownedComputer(
            auth.user.organizationId,
            idSchema.parse(c.req.param('id')),
        );
        if (!computer) return c.json({ error: 'Computer not found' }, 404);
        const client = await getVeyonClient(auth.user.organizationId, auth.user.id);
        return c.json(await client.hostState(computer.host));
    } catch (error) {
        return apiError(c, error);
    }
});

// GET /api/v1/authentication/<host> — lists the authentication method
// UUIDs the target supports; key file authentication must be among them.
veyonRouter.get('/veyon/computers/:id/authentication-methods', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    try {
        const computer = await ownedComputer(
            auth.user.organizationId,
            idSchema.parse(c.req.param('id')),
        );
        if (!computer) return c.json({ error: 'Computer not found' }, 404);
        const client = await getVeyonClient(auth.user.organizationId, auth.user.id);
        return c.json({ methods: await client.authenticationMethods(computer.host) });
    } catch (error) {
        return apiError(c, error);
    }
});

// POST /api/v1/authentication/<host> — eagerly establish and cache a
// key-authenticated connection (normally created lazily on first use).
veyonRouter.post('/veyon/computers/:id/connect', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    try {
        const computer = await ownedComputer(
            auth.user.organizationId,
            idSchema.parse(c.req.param('id')),
        );
        if (!computer) return c.json({ error: 'Computer not found' }, 404);
        const client = await getVeyonClient(auth.user.organizationId, auth.user.id);
        const connection = await client.authenticate(computer.host);
        return c.json({
            success: true,
            host: connection.host,
            validUntil: connection.validUntil,
        });
    } catch (error) {
        return apiError(c, error);
    }
});

// GET /api/v1/user — logged-on user of the target computer.
veyonRouter.get('/veyon/computers/:id/user', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    try {
        const computer = await ownedComputer(
            auth.user.organizationId,
            idSchema.parse(c.req.param('id')),
        );
        if (!computer) return c.json({ error: 'Computer not found' }, 404);
        const client = await getVeyonClient(auth.user.organizationId, auth.user.id);
        return c.json(await client.user(computer.host));
    } catch (error) {
        return apiError(c, error);
    }
});

// GET /api/v1/session — session id/uptime/client information.
veyonRouter.get('/veyon/computers/:id/session', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    try {
        const computer = await ownedComputer(
            auth.user.organizationId,
            idSchema.parse(c.req.param('id')),
        );
        if (!computer) return c.json({ error: 'Computer not found' }, 404);
        const client = await getVeyonClient(auth.user.organizationId, auth.user.id);
        return c.json(await client.session(computer.host));
    } catch (error) {
        return apiError(c, error);
    }
});

const featureUidSchema = z.uuid();

// GET /api/v1/feature/<uid> — status of a mode-style feature (e.g. ScreenLock).
veyonRouter.get('/veyon/computers/:id/feature/:uid', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    try {
        const computer = await ownedComputer(
            auth.user.organizationId,
            idSchema.parse(c.req.param('id')),
        );
        if (!computer) return c.json({ error: 'Computer not found' }, 404);
        const uid = featureUidSchema.parse(c.req.param('uid'));
        const client = await getVeyonClient(auth.user.organizationId, auth.user.id);
        return c.json(await client.featureStatus(computer.host, uid));
    } catch (error) {
        return apiError(c, error);
    }
});

const featureStateSchema = z.object({
    active: z.boolean(),
    arguments: z.record(z.string(), z.unknown()).default({}),
});

// PUT /api/v1/feature/<uid> — start or stop a single feature directly.
veyonRouter.put('/veyon/computers/:id/feature/:uid', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    try {
        const computer = await ownedComputer(
            auth.user.organizationId,
            idSchema.parse(c.req.param('id')),
        );
        if (!computer) return c.json({ error: 'Computer not found' }, 404);
        const uid = featureUidSchema.parse(c.req.param('uid'));
        const body = featureStateSchema.parse(await c.req.json());
        const client = await getVeyonClient(auth.user.organizationId, auth.user.id);
        await client.setFeature(computer.host, uid, body.active, body.arguments);
        return c.json({ success: true });
    } catch (error) {
        return apiError(c, error);
    }
});

veyonRouter.get('/veyon/connections', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    return c.json({
        connections: listOpenConnections(auth.user.organizationId, auth.user.id),
    });
});

veyonRouter.delete('/veyon/connections/:computerId', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    try {
        const computer = await ownedComputer(
            auth.user.organizationId,
            idSchema.parse(c.req.param('computerId')),
        );
        if (!computer) return c.json({ error: 'Computer not found' }, 404);
        const client = await getVeyonClient(auth.user.organizationId, auth.user.id);
        await client.close(computer.host);
        return c.json({ success: true });
    } catch (error) {
        return apiError(c, error);
    }
});

veyonRouter.post('/veyon/commands', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    try {
        const body = commandSchema.parse(await c.req.json());
        const computers = await db.query.veyonComputer.findMany({
            where: eq(veyonComputer.organizationId, auth.user.organizationId),
        });
        const requestedIds = new Set(body.computerIds);
        const targets = computers.filter((computer) => requestedIds.has(computer.id));
        if (targets.length !== requestedIds.size) {
            return c.json({ error: 'One or more computers were not found' }, 404);
        }
        const featureByAction = {
            'screen-lock': VEYON_FEATURES.screenLock,
            'input-lock': VEYON_FEATURES.inputDevicesLock,
            'user-login': VEYON_FEATURES.userLogin,
            'user-logoff': VEYON_FEATURES.userLogoff,
            reboot: VEYON_FEATURES.reboot,
            'power-down': VEYON_FEATURES.powerDown,
            'start-app': VEYON_FEATURES.startApp,
            'open-website': VEYON_FEATURES.openWebsite,
            'text-message': VEYON_FEATURES.textMessage,
            'custom-feature': body.featureUid!,
        } as const;
        const featureUid = featureByAction[body.action];
        if (!featureUid) return c.json({ error: 'Feature UID is required' }, 400);
        const client = await getVeyonClient(auth.user.organizationId, auth.user.id);
        const settled = await Promise.allSettled(
            targets.map(async (computer) => {
                await client.setFeature(
                    computer.host,
                    featureUid,
                    body.active,
                    body.arguments,
                );
                return { id: computer.id, name: computer.name };
            }),
        );
        const results = settled.map((result, index) => {
            if (result.status === 'fulfilled') {
                return { ...result.value, success: true };
            }
            const target = targets[index]!;
            return {
                id: target.id,
                name: target.name,
                success: false,
                error:
                    result.reason instanceof Error
                        ? result.reason.message
                        : 'Command failed',
            };
        });
        return c.json({
            success: results.every((result) => result.success),
            results,
        });
    } catch (error) {
        return apiError(c, error);
    }
});

veyonRouter.post('/veyon/demo', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    try {
        const body = demoSchema.parse(await c.req.json());
        const computers = await db.query.veyonComputer.findMany({
            where: eq(veyonComputer.organizationId, auth.user.organizationId),
        });
        const source = computers.find(
            (computer) => computer.id === body.sourceComputerId,
        );
        const requestedIds = new Set(body.computerIds);
        const targets = computers.filter(
            (computer) =>
                requestedIds.has(computer.id) && computer.id !== source?.id,
        );
        if (
            !source ||
            targets.length !==
                [...requestedIds].filter((id) => id !== source.id).length
        ) {
            return c.json(
                { error: 'One or more demo computers were not found' },
                404,
            );
        }
        const client = await getVeyonClient(
            auth.user.organizationId,
            auth.user.id,
        );
        const token = crypto.randomUUID().replace(/-/g, '');
        const clientFeature = body.windowed
            ? VEYON_FEATURES.windowDemoClient
            : VEYON_FEATURES.fullScreenDemoClient;

        if (body.active) {
            await client.setFeature(source.host, VEYON_FEATURES.demoServer, true, {
                demoAccessToken: token,
            });
        }
        const settled = await Promise.allSettled(
            targets.map((target) =>
                client.setFeature(target.host, clientFeature, body.active, {
                    demoAccessToken: token,
                    demoServerHost: source.host,
                }),
            ),
        );
        if (!body.active) {
            await Promise.allSettled([
                client.setFeature(source.host, VEYON_FEATURES.demoServer, false),
                ...targets.flatMap((target) => [
                    client.setFeature(
                        target.host,
                        VEYON_FEATURES.fullScreenDemoClient,
                        false,
                    ),
                    client.setFeature(
                        target.host,
                        VEYON_FEATURES.windowDemoClient,
                        false,
                    ),
                ]),
            ]);
        }
        const failed = settled.filter(
            (result) => result.status === 'rejected',
        ).length;
        return c.json({ success: failed === 0, targets: targets.length, failed });
    } catch (error) {
        return apiError(c, error);
    }
});

veyonRouter.post('/veyon/computers/:id/power-on', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    try {
        const computer = await ownedComputer(
            auth.user.organizationId,
            idSchema.parse(c.req.param('id')),
        );
        if (!computer) return c.json({ error: 'Computer not found' }, 404);
        if (!computer.macAddress) return c.json({ error: 'MAC address is required' }, 400);
        // A leading dash would be parsed as a flag by veyon-cli (argument
        // injection into Bun.spawn); refuse to spawn.
        if (computer.macAddress.startsWith('-')) {
            return c.json(
                {
                    error: 'Stored MAC address is invalid: it must not start with "-"',
                    code: 'INVALID_MAC',
                },
                400,
            );
        }
        const executable = Bun.which(process.env.VEYON_CLI_PATH || 'veyon-cli');
        if (!executable) {
            return c.json({ error: 'veyon-cli is not installed on the server', code: 'CLI_MISSING' }, 501);
        }
        const processResult = Bun.spawn([executable, 'power', 'on', computer.macAddress], {
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const exitCode = await processResult.exited;
        if (exitCode !== 0) {
            return c.json({ error: await new Response(processResult.stderr).text() }, 502);
        }
        return c.json({ success: true });
    } catch (error) {
        return apiError(c, error);
    }
});

