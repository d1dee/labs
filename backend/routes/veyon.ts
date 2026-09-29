import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/database';
import { veyonComputer, veyonConfig } from '../../db/schema';
import {
    getVeyonClient,
    listOpenConnections,
    VEYON_FEATURES,
    VeyonApiError,
} from '../veyon';
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
        const client = await getVeyonClient(auth.user.organizationId, auth.user.id);
        let response: Response;
        try {
            response = await client.framebuffer(computer.host, query);
        } catch (error) {
            // Veyon reports 503 while the VNC framebuffer initializes after a
            // fresh connection; a single delayed retry usually succeeds.
            if (!(error instanceof VeyonApiError) || error.status !== 503) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 700));
            response = await client.framebuffer(computer.host, query);
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

veyonRouter.post('/veyon/computers/:id/remote-access', async (c) => {
    const auth = requireUser(c);
    if (auth.response) return auth.response;
    try {
        const mode = z.enum(['view', 'control']).parse((await c.req.json()).mode);
        const computer = await ownedComputer(
            auth.user.organizationId,
            idSchema.parse(c.req.param('id')),
        );
        if (!computer) return c.json({ error: 'Computer not found' }, 404);
        const executable = Bun.which(process.env.VEYON_CLI_PATH || 'veyon-cli');
        if (!executable) {
            return c.json({ error: 'veyon-cli is not installed on the server', code: 'CLI_MISSING' }, 501);
        }
        Bun.spawn([executable, 'remoteaccess', mode, computer.host], {
            stdout: 'ignore',
            stderr: 'ignore',
        }).unref();
        return c.json({ success: true, mode, host: computer.host }, 202);
    } catch (error) {
        return apiError(c, error);
    }
});
