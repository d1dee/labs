import { and, eq } from 'drizzle-orm';
import { streamSSE, type SSEMessage } from 'hono/streaming';
import { isIP } from 'node:net';
import { z } from 'zod';
import { db } from '../../db/database';
import { veyonComputer, veyonConfig } from '../../db/index';
import type { VeyonSyncApplyResultItem } from '../../frontend/src/api/veyon';
import { auth } from '../auth';
import {
    getComputerInventory,
    resolveVeyonTargets,
} from '../computer-inventory';
import { isDemoUser } from '../demo';
import { isFogConfigured } from '../fog';
import { errorProperty, getLogger } from '../logger';
import {
    getVeyonClient,
    listOpenConnections,
    VEYON_FEATURES,
    VeyonApiError,
} from '../veyon';
import { resolveComputerLocations } from '../veyon-locations';
import { veyonPoller } from '../veyon-poller';
import { createVeyonStreamWriter } from '../veyon-stream';
import type { VeyonSyncPlan } from '../veyon-sync';
import { createApp } from './context';
import { streamIdentityMatches, type StreamIdentity } from './stream';

export const veyonRouter = createApp();

veyonRouter.use('/veyon/*', async (c, next) => {
    if (c.req.method !== 'GET' && isDemoUser(c.get('user'))) {
        return c.json(
            {
                error: 'Veyon changes are unavailable in demo mode',
                code: 'DEMO_READ_ONLY',
            },
            403,
        );
    }
    await next();
});

const veyonLogger = getLogger(['labs', 'veyon']);

function watchStreamIdentity(
    headers: Headers,
    expected: StreamIdentity,
    revoke: () => void,
) {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
        stopped = true;
        clearTimeout(timer);
        clearTimeout(deadline);
    };
    const check = async () => {
        if (stopped) return;
        try {
            const session = await Promise.race([
                auth.api.getSession({
                    headers,
                    query: { disableCookieCache: true },
                }),
                new Promise<never>((_, reject) => {
                    deadline = setTimeout(
                        () =>
                            reject(
                                new Error('Stream authentication timed out'),
                            ),
                        10_000,
                    );
                }),
            ]);
            if (stopped) return;
            const actual: StreamIdentity = session
                ? {
                      userId: session.user.id,
                      sessionId: session.session.id,
                      organizationId: session.user.organizationId ?? null,
                  }
                : null;
            if (!streamIdentityMatches(expected, actual)) {
                stop();
                revoke();
            }
        } catch {
            if (!stopped) {
                stop();
                revoke();
            }
        } finally {
            clearTimeout(deadline);
            // Schedule only after the previous lookup settles; never overlap checks.
            if (!stopped) timer = setTimeout(check, 10_000);
        }
    };
    timer = setTimeout(check, 10_000);
    return stop;
}

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
    const inventory = await getComputerInventory(organizationId, true);
    if (inventory.warning) return { error: inventory.warning };
    // Older clients can still read the sync contract, but there is no second
    // editable FOG directory to synchronize. Stale apply items cannot match.
    return {
        plan: {
            additions: [],
            renames: [],
            removals: [],
            links: [],
            unchanged: inventory.hosts.length,
            unmanaged: inventory.computers
                .filter((computer) => computer.fogHostId == null)
                .map((computer) => ({
                    computerId: computer.id,
                    name: computer.name,
                    host: computer.host,
                })),
            warnings: [
                'FOG inventory is managed automatically; manual synchronization is no longer required.',
            ],
        },
        computers: inventory.computers,
    };
}

function apiError(c: any, error: unknown) {
    if (error instanceof z.ZodError) {
        return c.json(
            {
                error: error.issues[0]?.message ?? 'Invalid request',
                code: 'INVALID_DATA',
            },
            400,
        );
    }
    if (error instanceof VeyonApiError) {
        const status =
            error.status >= 400 && error.status <= 599 ? error.status : 502;
        return c.json(
            { error: error.message, code: error.code },
            status as any,
        );
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
    veyonLogger.error('Veyon request failed: {error}', {
        error: errorProperty(error),
    });
    return c.json({ error: 'Veyon request failed', code: 'VEYON_ERROR' }, 502);
}

function requireUser(c: any) {
    const user = c.get('user');
    if (!user) return { response: c.json({ error: 'Not authenticated' }, 401) };
    if (!user.organizationId) {
        return {
            response: c.json(
                { error: 'You must join an organization first' },
                403,
            ),
        };
    }
    return { user };
}

async function ownedComputer(organizationId: string, id: string) {
    const computer = (await resolveVeyonTargets(organizationId, [id]))?.[0];
    return computer
        ? (await resolveComputerLocations(organizationId, [computer]))[0]
        : undefined;
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
                        .set({
                            fogHostId: link.fogHostId,
                            updatedAt: new Date(),
                        })
                        .where(
                            and(
                                eq(veyonComputer.id, link.computerId),
                                eq(
                                    veyonComputer.organizationId,
                                    organizationId,
                                ),
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
                match: (rename, requestedId) =>
                    rename.computerId === requestedId,
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
                                eq(
                                    veyonComputer.organizationId,
                                    organizationId,
                                ),
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
                match: (addition, requestedId) =>
                    addition.fogHostId === requestedId,
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
                    match: (removal, requestedId) =>
                        removal.computerId === requestedId,
                    idOf: (requestedId) => requestedId,
                    nameOf: (requestedId, removal) =>
                        removal?.name ?? nameOf(requestedId),
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
                        veyonPoller.forget(organizationId, removal.computerId);
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
    const inventory = await getComputerInventory(auth.user.organizationId);
    return c.json({
        computers: await resolveComputerLocations(
            auth.user.organizationId,
            inventory.computers,
        ),
        inventoryWarning: inventory.warning,
    });
});

veyonRouter.post('/veyon/computers', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    try {
        const body = computerBodySchema.parse(await c.req.json());
        const inventory = await getComputerInventory(auth.user.organizationId);
        if (
            inventory.computers.some(
                (computer) =>
                    computer.host.toLowerCase() === body.host.toLowerCase(),
            )
        )
            return c.json(
                { error: 'A computer with this address already exists' },
                409,
            );
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
        const owned = await ownedComputer(auth.user.organizationId, id);
        if (!owned) {
            return c.json({ error: 'Computer not found' }, 404);
        }
        if (owned.fogHostId != null)
            return c.json(
                {
                    error: 'FOG owns this computer identity. Edit the host in FOG, not the Veyon directory.',
                },
                409,
            );
        const body = computerBodySchema.parse(await c.req.json());
        const inventory = await getComputerInventory(auth.user.organizationId);
        if (
            inventory.computers.some(
                (computer) =>
                    computer.id !== id &&
                    computer.host.toLowerCase() === body.host.toLowerCase(),
            )
        )
            return c.json(
                { error: 'A computer with this address already exists' },
                409,
            );
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
        if (computer)
            veyonPoller.updateComputer(auth.user.organizationId, computer);
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
        if (computer.fogHostId != null)
            return c.json(
                {
                    error: 'This host is owned by FOG. Deleting FOG inventory is a separate deployment action; it cannot be removed as a manual Veyon target.',
                },
                409,
            );
        const client = await getVeyonClient(
            auth.user.organizationId,
            auth.user.id,
        ).catch(() => null);
        await client?.close(computer.host).catch(() => undefined);
        await db.delete(veyonComputer).where(eq(veyonComputer.id, id));
        // Drop cached screenshots and stop any polling worker for the
        // removed machine so nothing keeps polling a deleted computer.
        veyonPoller.forget(auth.user.organizationId, id);
        return c.json({ success: true });
    } catch (error) {
        return apiError(c, error);
    }
});

veyonRouter.get('/veyon/information/stream', (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    const session = c.get('session');
    if (!session) return c.json({ error: 'Not authenticated' }, 401);
    const response = streamSSE(c, async (stream) => {
        const controller = new AbortController();
        const { signal } = controller;
        let stopIdentityWatch = () => {};
        const abort = () => {
            stopIdentityWatch();
            controller.abort();
            c.req.raw.signal.removeEventListener('abort', abort);
            stream.abort();
        };
        stream.onAbort(abort);
        c.req.raw.signal.addEventListener('abort', abort, { once: true });
        if (c.req.raw.signal.aborted || stream.aborted) abort();

        // Race even non-cancellable setup against disconnect, without leaving
        // listeners behind or allowing late results to start more work.
        const pending = <T>(operation: Promise<T>): Promise<T> =>
            new Promise((resolve, reject) => {
                const cancel = () => reject(signal.reason);
                signal.addEventListener('abort', cancel, { once: true });
                operation
                    .then(resolve, reject)
                    .finally(() => signal.removeEventListener('abort', cancel));
                if (signal.aborted) cancel();
            });
        const sleep = (ms: number) =>
            new Promise<void>((resolve) => {
                const finish = () => {
                    clearTimeout(timer);
                    signal.removeEventListener('abort', finish);
                    resolve();
                };
                const timer = setTimeout(finish, ms);
                signal.addEventListener('abort', finish, { once: true });
                if (signal.aborted) finish();
            });
        let writes = Promise.resolve();
        const write = (event: string, data: unknown) => {
            writes = writes.then(async () => {
                if (!signal.aborted)
                    await pending(
                        stream.writeSSE({ event, data: JSON.stringify(data) }),
                    );
            });
            return writes;
        };
        const sanitizedError = (error: unknown) =>
            error instanceof VeyonApiError && error.status === 429
                ? 'Live status checks are unavailable because the connection limit was reached. Retrying automatically; displayed statuses may be out of date.'
                : error instanceof VeyonApiError &&
                    (error.code === 'VEYON_BUSY' ||
                        error.code === 'VEYON_CONNECTION_LIMIT')
                  ? 'Live status checks are queued at capacity. Retrying automatically; displayed statuses may be out of date.'
                  : error instanceof Error &&
                      (error.name === 'TimeoutError' ||
                          error.name === 'AbortError')
                    ? 'Veyon connection timed out'
                    : 'Veyon request failed';
        const heartbeat = (async () => {
            while (!signal.aborted) {
                await sleep(15_000);
                if (!signal.aborted) await write('heartbeat', {});
            }
        })().catch(abort);
        if (!signal.aborted)
            stopIdentityWatch = watchStreamIdentity(
                c.req.raw.headers,
                {
                    userId: auth.user.id,
                    sessionId: session.id,
                    organizationId: auth.user.organizationId,
                },
                abort,
            );
        let directorySignature = '';
        let resolvedDirectory: (typeof veyonComputer.$inferSelect)[] = [];
        try {
            while (!signal.aborted) {
                try {
                    const inventory = await pending(
                        getComputerInventory(auth.user.organizationId),
                    );
                    const computers = inventory.computers;
                    const signature = JSON.stringify(computers);
                    const displayedComputers =
                        signature === directorySignature
                            ? resolvedDirectory
                            : computers;
                    await write('directory', {
                        computers: displayedComputers,
                        inventoryWarning: inventory.warning,
                    });
                    signal.throwIfAborted();
                    // Send the directory immediately; only FOG-linked targets need DNS enrichment before connecting.
                    const locations = pending(
                        resolveComputerLocations(
                            auth.user.organizationId,
                            computers,
                        ),
                    )
                        .then(async (resolved) => {
                            if (signal.aborted) return;
                            directorySignature = signature;
                            resolvedDirectory = resolved;
                            if (
                                resolved.some(
                                    (computer, index) =>
                                        computer.location !==
                                            displayedComputers[index]
                                                ?.location ||
                                        computer.host !==
                                            displayedComputers[index]?.host,
                                )
                            ) {
                                await write('directory', {
                                    computers: resolved,
                                    inventoryWarning: inventory.warning,
                                });
                            }
                            return resolved;
                        })
                        .catch(abort);
                    try {
                        const targets = computers.some(
                            (computer) => computer.fogHostId != null,
                        )
                            ? ((await locations) ?? computers)
                            : computers;
                        const client = await pending(
                            getVeyonClient(
                                auth.user.organizationId,
                                auth.user.id,
                            ),
                        );
                        const ipTargets: typeof targets = [];
                        const hostnameTargets: typeof targets = [];
                        for (const computer of targets) {
                            const bracketed = computer.host.match(
                                /^\[([^\]]+)\](?::\d+)?$/,
                            );
                            const ipv4WithPort =
                                computer.host.match(/^([^:]+):\d+$/);
                            const literal =
                                isIP(computer.host) ||
                                (bracketed && isIP(bracketed[1]!) === 6) ||
                                (ipv4WithPort && isIP(ipv4WithPort[1]!) === 4);
                            (literal ? ipTargets : hostnameTargets).push(
                                computer,
                            );
                        }
                        // Drain every IP check before starting any hostname check.
                        for (const phase of [ipTargets, hostnameTargets]) {
                            let next = 0;
                            let phaseError: unknown;
                            await Promise.all(
                                Array.from(
                                    { length: Math.min(6, phase.length) },
                                    async () => {
                                        while (!signal.aborted && !phaseError) {
                                            const computer = phase[next++];
                                            if (!computer) return;
                                            let data;
                                            try {
                                                const information =
                                                    await pending(
                                                        client.information(
                                                            computer.host,
                                                            signal,
                                                        ),
                                                    );
                                                data = {
                                                    computerId: computer.id,
                                                    state: 'online',
                                                    information,
                                                };
                                            } catch (error) {
                                                if (signal.aborted) return;
                                                // Proxy saturation says nothing about this computer's status.
                                                // Keep prior observations and report the service error instead.
                                                if (
                                                    error instanceof
                                                        VeyonApiError &&
                                                    (error.status === 429 ||
                                                        error.code ===
                                                            'VEYON_BUSY' ||
                                                        error.code ===
                                                            'VEYON_CONNECTION_LIMIT')
                                                ) {
                                                    phaseError = error;
                                                    return;
                                                }
                                                data = {
                                                    computerId: computer.id,
                                                    state: 'offline',
                                                    error: sanitizedError(
                                                        error,
                                                    ),
                                                };
                                            }
                                            await write('information', data);
                                        }
                                    },
                                ),
                            );
                            if (phaseError) throw phaseError;
                        }
                    } finally {
                        await locations;
                    }
                } catch (error) {
                    if (signal.aborted) break;
                    await write('unavailable', {
                        error: sanitizedError(error),
                    });
                }
                if (signal.aborted) break;
                await write('complete', {});
                await sleep(10_000);
            }
        } catch {
            abort();
        } finally {
            abort();
            await heartbeat;
        }
    });
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('X-Accel-Buffering', 'no');
    return response;
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
        const client = await getVeyonClient(
            auth.user.organizationId,
            auth.user.id,
        );
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
        if (c.req.query('compression'))
            query.set('compression', c.req.query('compression')!);
        const signal = AbortSignal.any([
            c.req.raw.signal,
            AbortSignal.timeout(12_000),
        ]);
        const withinDeadline = <T>(operation: Promise<T>): Promise<T> =>
            new Promise((resolve, reject) => {
                const abort = () => reject(signal.reason);
                signal.addEventListener('abort', abort, { once: true });
                operation
                    .then(resolve, reject)
                    .finally(() => signal.removeEventListener('abort', abort));
                if (signal.aborted) abort();
            });
        const client = await withinDeadline(
            getVeyonClient(auth.user.organizationId, auth.user.id),
        );
        signal.throwIfAborted();
        let response: Response;
        try {
            response = await withinDeadline(
                client.framebuffer(
                    computer.host,
                    query,
                    signal,
                    veyonPoller.config.maxFrameBytes,
                ),
            );
        } catch (error) {
            // Only FramebufferNotAvailable (10) is transient initialization;
            // UnsupportedImageFormat (9) is also HTTP 503 but must not retry.
            if (
                !(error instanceof VeyonApiError) ||
                error.upstreamCode !== 10 ||
                signal.aborted
            ) {
                throw error;
            }
            await new Promise<void>((resolve, reject) => {
                const finish = () => {
                    signal.removeEventListener('abort', abort);
                    resolve();
                };
                const timer = setTimeout(finish, 700);
                const abort = () => {
                    clearTimeout(timer);
                    reject(signal.reason);
                };
                signal.addEventListener('abort', abort, { once: true });
                if (signal.aborted) abort();
            });
            response = await withinDeadline(
                client.framebuffer(
                    computer.host,
                    query,
                    signal,
                    veyonPoller.config.maxFrameBytes,
                ),
            );
        }
        const image = await withinDeadline(response.arrayBuffer());
        signal.throwIfAborted();
        if (!image.byteLength)
            throw new VeyonApiError(
                'Veyon returned an empty screenshot',
                502,
                'VEYON_EMPTY_FRAME',
            );
        return new Response(image, {
            status: 200,
            headers: {
                'Content-Type':
                    response.headers.get('Content-Type') || 'image/jpeg',
                'Cache-Control': 'no-store, private',
                'Content-Disposition':
                    c.req.query('download') === 'true'
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
        const client = await getVeyonClient(
            auth.user.organizationId,
            auth.user.id,
        );
        return c.json(await client.features(computer.host));
    } catch (error) {
        return apiError(c, error);
    }
});

// GET /api/veyon/screenshots/stream?ids=a,b,c — server-sent event stream of
// live screenshots. One backend polling worker per managed machine feeds
// every connected viewer, so N administrators watching M computers still
// produce a single Veyon request stream per computer. Browsers connect with
// a plain EventSource (same-origin cookie auth); polling starts when the
// first viewer subscribes and stops shortly after the last one leaves.
const MAX_STREAM_COMPUTERS = 64;
const SSE_HEARTBEAT_MS = 15_000;
const streamProfileSchema = z.object({
    priority: z.enum(['grid', 'viewer']).default('grid'),
    intervalMs: z
        .string()
        .regex(/^\d+$/)
        .transform(Number)
        .pipe(z.number().int().min(250).max(60_000))
        .optional(),
    width: z
        .string()
        .regex(/^\d+$/)
        .transform(Number)
        .pipe(z.number().int().min(160).max(1_920))
        .optional(),
    quality: z
        .string()
        .regex(/^\d+$/)
        .transform(Number)
        .pipe(z.number().int().min(1).max(100))
        .optional(),
});

veyonRouter.get('/veyon/screenshots/stream', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    const session = c.get('session');
    if (!session) return c.json({ error: 'Not authenticated' }, 401);
    try {
        const organizationId = auth.user.organizationId;
        const profile = streamProfileSchema.parse(c.req.query());
        const intervalMs =
            profile.intervalMs ??
            (profile.priority === 'viewer'
                ? veyonPoller.config.viewerIntervalMs
                : veyonPoller.config.pollIntervalMs);
        const refresh = c.req.query('refresh') === 'true';
        const ids = [
            ...new Set(
                (c.req.query('ids') ?? '')
                    .split(',')
                    .map((id) => id.trim())
                    .filter(Boolean),
            ),
        ];
        if (ids.length === 0) {
            return c.json(
                { error: 'At least one computer id is required' },
                400,
            );
        }
        if (ids.length > MAX_STREAM_COMPUTERS) {
            return c.json(
                {
                    error: `At most ${MAX_STREAM_COMPUTERS} computers can be streamed`,
                },
                400,
            );
        }
        if (ids.some((id) => !idSchema.safeParse(id).success)) {
            return c.json({ error: 'Invalid computer id' }, 400);
        }
        const resolved = await resolveVeyonTargets(organizationId, ids);
        if (!resolved) {
            return c.json(
                { error: 'One or more computers were not found' },
                404,
            );
        }
        const computers = await resolveComputerLocations(
            organizationId,
            resolved,
        );
        const requestedIds = new Set(computers.map((computer) => computer.id));

        return streamSSE(c, async (stream) => {
            let closed = false;
            let cleaned = false;
            let stopIdentityWatch = () => {};
            const subscribedIds = new Map<string, symbol>();
            const resets = new Set<string>();
            const lastFrameSent = new Map<string, number>();
            const freshNeeded = new Set(refresh ? requestedIds : []);
            const writer = createVeyonStreamWriter<SSEMessage[]>(
                async (messages) => {
                    for (const message of messages)
                        await stream.writeSSE(message);
                },
                (error) => {
                    veyonLogger.warn(
                        'Screenshot stream write failed: {error}',
                        {
                            error: errorProperty(error),
                        },
                    );
                    stream.abort();
                    cleanup();
                },
                30_000,
                Math.max(
                    veyonPoller.config.streamMaxPendingBytes,
                    veyonPoller.config.maxFrameBytes,
                ),
            );
            const write = (
                key: string,
                message: () => SSEMessage,
                bytes = 0,
            ) => {
                if (!closed && !stream.aborted)
                    writer.enqueue(
                        key,
                        () => {
                            const event = message();
                            // A replacement state may coalesce a reset, but cannot
                            // erase the required cache invalidation before delivery.
                            if (!resets.delete(key) || event.event === 'reset')
                                return [event];
                            return [
                                {
                                    event: 'reset',
                                    data: JSON.stringify({ computerId: key }),
                                },
                                event,
                            ];
                        },
                        bytes,
                    );
            };
            const frameData = (
                computerId: string,
                state: {
                    image: ArrayBuffer;
                    mimeType: string;
                    lastUpdated: number;
                    stale: boolean;
                    consecutiveFailures: number;
                    initial?: boolean;
                },
            ) => {
                lastFrameSent.set(computerId, Date.now());
                if (state.stale) freshNeeded.add(computerId);
                else if (!state.initial) freshNeeded.delete(computerId);
                return JSON.stringify({
                    computerId,
                    image: Buffer.from(state.image).toString('base64'),
                    mimeType: state.mimeType,
                    lastUpdated: state.lastUpdated,
                    stale: state.stale,
                    consecutiveFailures: state.consecutiveFailures,
                    initial: state.initial ?? false,
                });
            };

            const cleanup = () => {
                if (cleaned) return;
                cleaned = true;
                stopIdentityWatch();
                closed = true;
                writer.close();
                removeListener();
                c.req.raw.signal.removeEventListener('abort', abort);
                for (const [id, token] of subscribedIds) {
                    veyonPoller.unsubscribe(organizationId, id, token);
                }
            };
            const abort = () => {
                stream.abort();
                cleanup();
            };
            let removeListener: () => void = () => undefined;
            stream.onAbort(cleanup);
            c.req.raw.signal.addEventListener('abort', abort, { once: true });
            if (c.req.raw.signal.aborted || stream.aborted) {
                abort();
                return;
            }
            stopIdentityWatch = watchStreamIdentity(
                c.req.raw.headers,
                {
                    userId: auth.user.id,
                    sessionId: session.id,
                    organizationId,
                },
                abort,
            );

            // Attach the listener before subscribing so no frame event can
            // slip past the initial snapshot below.
            removeListener = veyonPoller.addListener((event) => {
                if (
                    event.organizationId !== organizationId ||
                    !requestedIds.has(event.computerId)
                ) {
                    return;
                }
                if (event.type === 'reset') {
                    lastFrameSent.delete(event.computerId);
                    freshNeeded.add(event.computerId);
                    resets.add(event.computerId);
                    write(event.computerId, () => ({
                        event: 'reset',
                        data: JSON.stringify({ computerId: event.computerId }),
                    }));
                } else if (event.type === 'frame') {
                    if (
                        !freshNeeded.has(event.computerId) &&
                        Date.now() -
                            (lastFrameSent.get(event.computerId) ?? -Infinity) <
                            intervalMs
                    )
                        return;
                    write(
                        event.computerId,
                        () => ({
                            event: 'frame',
                            data: frameData(event.computerId, {
                                ...event,
                                stale: false,
                                consecutiveFailures: 0,
                            }),
                        }),
                        event.image.byteLength,
                    );
                } else {
                    freshNeeded.add(event.computerId);
                    write(event.computerId, () => ({
                        event: 'state',
                        data: JSON.stringify({
                            computerId: event.computerId,
                            stale: event.stale,
                            lastUpdated: event.lastUpdated,
                            consecutiveFailures: event.consecutiveFailures,
                            lastError: event.lastError,
                        }),
                    }));
                }
            });

            // Hint browsers to reconnect quickly after dropped streams.
            try {
                write('hello', () => ({
                    event: 'hello',
                    data: 'connected',
                    retry: 3000,
                }));
                for (const computer of computers) {
                    if (closed || stream.aborted) break;
                    const token = Symbol();
                    const state = veyonPoller.subscribe(
                        organizationId,
                        computer,
                        { ...profile, intervalMs, token, refresh },
                    );
                    subscribedIds.set(computer.id, token);
                    const image = state.image;
                    if (image) {
                        write(
                            computer.id,
                            () => ({
                                event: 'frame',
                                data: frameData(computer.id, {
                                    image,
                                    mimeType: state.mimeType,
                                    lastUpdated: state.lastUpdated ?? 0,
                                    stale: state.stale,
                                    consecutiveFailures:
                                        state.consecutiveFailures,
                                    initial: true,
                                }),
                            }),
                            image.byteLength,
                        );
                    } else {
                        write(computer.id, () => ({
                            event: 'state',
                            data: JSON.stringify({
                                computerId: computer.id,
                                stale: state.stale,
                                lastUpdated: state.lastUpdated,
                                consecutiveFailures: state.consecutiveFailures,
                                lastError: state.lastError,
                                initial: true,
                            }),
                        }));
                    }
                }

                // Heartbeats keep proxies from idling out the stream.
                while (!closed && !stream.aborted) {
                    await stream.sleep(SSE_HEARTBEAT_MS);
                    if (closed || stream.aborted) break;
                    const current = await resolveVeyonTargets(
                        organizationId,
                        ids,
                    );
                    if (closed || stream.aborted) break;
                    if (!current) {
                        abort();
                        break;
                    }
                    const resolved = await resolveComputerLocations(
                        organizationId,
                        current,
                    );
                    if (closed || stream.aborted) break;
                    for (const computer of resolved)
                        veyonPoller.updateComputer(organizationId, computer);
                    write('heartbeat', () => ({
                        event: 'heartbeat',
                        data: '',
                    }));
                }
            } finally {
                cleanup();
            }
        });
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
        const client = await getVeyonClient(
            auth.user.organizationId,
            auth.user.id,
        );
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
        const client = await getVeyonClient(
            auth.user.organizationId,
            auth.user.id,
        );
        return c.json({
            methods: await client.authenticationMethods(computer.host),
        });
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
        const client = await getVeyonClient(
            auth.user.organizationId,
            auth.user.id,
        );
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
        const client = await getVeyonClient(
            auth.user.organizationId,
            auth.user.id,
        );
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
        const client = await getVeyonClient(
            auth.user.organizationId,
            auth.user.id,
        );
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
        const client = await getVeyonClient(
            auth.user.organizationId,
            auth.user.id,
        );
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
        const client = await getVeyonClient(
            auth.user.organizationId,
            auth.user.id,
        );
        await client.setFeature(
            computer.host,
            uid,
            body.active,
            body.arguments,
        );
        return c.json({ success: true });
    } catch (error) {
        return apiError(c, error);
    }
});

veyonRouter.get('/veyon/connections', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    return c.json({
        connections: listOpenConnections(
            auth.user.organizationId,
            auth.user.id,
        ),
        pollers: veyonPoller.stats(auth.user.organizationId),
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
        const client = await getVeyonClient(
            auth.user.organizationId,
            auth.user.id,
        );
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
        const requestedIds = new Set(body.computerIds);
        const resolved = await resolveVeyonTargets(auth.user.organizationId, [
            ...requestedIds,
        ]);
        if (!resolved) {
            return c.json(
                { error: 'One or more computers were not found' },
                404,
            );
        }
        const targets = await resolveComputerLocations(
            auth.user.organizationId,
            resolved,
        );
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
        if (!featureUid)
            return c.json({ error: 'Feature UID is required' }, 400);
        const client = await getVeyonClient(
            auth.user.organizationId,
            auth.user.id,
        );
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
