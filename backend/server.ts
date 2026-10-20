import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import * as path from 'path';
import { db } from '../db/database';
import { organization } from '../db/index';
import { auth } from './auth';
import { logHttpError, logHttpRequest } from './http-logging';
import { configureLogger, getLogger } from './logger';
import { configRouter } from './routes/config';
import type { AppEnv } from './routes/context';
import {
    devicesRouter,
    invalidateDeviceDirectoryAfterMutation,
} from './routes/devices';
import { fogRouter } from './routes/fog';
import { labsRouter, startDataUsageSnapshots } from './routes/labs';
import { organizationsRouter } from './routes/organizations';
import { piholeRouter } from './routes/pihole';
import { settingsRouter } from './routes/settings';
import {
    createStreamRouter,
    streamIdentityMatches,
    type StreamIdentity,
} from './routes/stream';
import { veyonRouter } from './routes/veyon';

// Configure LogTape before handling any request so every logger in the
// backend routes to the console and the rotating log file from the start.
await configureLogger();

const serverLogger = getLogger(['labs', 'server']);

// Define Hono app with typed variables for auth
const app = new Hono<AppEnv>({});

app.onError(logHttpError);
app.use('*', logHttpRequest);

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

// Auth middleware - populate user/session/organization in context
app.use('*', async (c, next) => {
    const authSession = await auth.api.getSession({
        headers: c.req.raw.headers,
        query: { disableCookieCache: true },
    });
    // Unverified sessions may use auth endpoints, but never protected app APIs.
    const session = authSession?.user.emailVerified ? authSession : null;

    // This binding is injected only by the in-process stream dispatcher, never
    // parsed from an HTTP header. A session or membership change ends the stream.
    if (c.env && 'streamIdentity' in c.env) {
        const actual: StreamIdentity = session
            ? {
                  userId: session.user.id,
                  sessionId: session.session.id,
                  organizationId: session.user.organizationId ?? null,
              }
            : null;
        if (!streamIdentityMatches(c.env.streamIdentity ?? null, actual)) {
            return c.json(
                {
                    error: 'Session or organization changed',
                    code: 'STREAM_IDENTITY_CHANGED',
                },
                session ? 403 : 401,
            );
        }
    }

    if (!session) {
        c.set('user', null);
        c.set('session', null);
        c.set('organization', null);
    } else {
        c.set('user', session.user);
        c.set('session', session.session);

        const orgId = session.user.organizationId;
        if (orgId) {
            const [org] = await db
                .select()
                .from(organization)
                .where(eq(organization.id, orgId))
                .limit(1);
            c.set('organization', org ?? null);
        } else {
            c.set('organization', null);
        }
    }

    await next();
});

// Mount Better Auth handler at /api/auth/*
app.on(['POST', 'GET'], '/api/auth/*', (c) => {
    return auth.handler(c.req.raw);
});

// Mount API route groups
app.use('/api/*', invalidateDeviceDirectoryAfterMutation);
app.route('/api', configRouter);
app.route('/api', organizationsRouter);
app.route('/api', labsRouter);
app.route('/api', devicesRouter);
app.route('/api', piholeRouter);
app.route('/api', fogRouter);
app.route('/api', settingsRouter);
app.route('/api', veyonRouter);
app.route(
    '/api',
    createStreamRouter(
        (request, streamIdentity) =>
            app.request(request, undefined, { streamIdentity }),
        ['http://10.10.1.10:5173', 'http://localhost:5173'],
    ),
);

// Start background data usage snapshots
startDataUsageSnapshots();

const port = Number(process.env.PORT || 3000);

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
    serverLogger.info('Teacher Dashboard running on http://localhost:{port}', {
        port: info.port,
    });
    serverLogger.info('Better Auth endpoints available at /api/auth/*');
    serverLogger.debug(
        'Sign in with username: POST /api/auth/sign-in/username',
    );
    serverLogger.debug('Session check: GET /api/auth/session');
    serverLogger.debug('Sign out: POST /api/auth/sign-out');
});
