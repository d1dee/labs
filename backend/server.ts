import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import console from 'console';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import * as path from 'path';
import { db } from '../db/database';
import { organization } from '../db/schema';
import { auth } from './auth';
import { configRouter } from './routes/config';
import type { AppEnv } from './routes/context';
import { fogRouter } from './routes/fog';
import { labsRouter, startDataUsageSnapshots } from './routes/labs';
import { organizationsRouter } from './routes/organizations';
import { piholeRouter } from './routes/pihole';
import { settingsRouter } from './routes/settings';

// Globally accept self-signed certificates for outbound fetch requests
// when MikroTik is configured with insecure TLS (self-signed routers).
if (process.env.MIKROTIK_INSECURE_FETCH === 'true') {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((
        input: string | URL | Request,
        init?: RequestInit & { tls?: Record<string, unknown> },
    ) => {
        const merged = {
            ...init,
            tls: {
                rejectUnauthorized: false,
                ...(init?.tls ?? {}),
            },
        };
        return originalFetch(input, merged);
    }) as typeof globalThis.fetch;
}

// Define Hono app with typed variables for auth
const app = new Hono<AppEnv>({});

// Logger middleware
app.use(logger());

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
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

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
app.route('/api', configRouter);
app.route('/api', organizationsRouter);
app.route('/api', labsRouter);
app.route('/api', piholeRouter);
app.route('/api', fogRouter);
app.route('/api', settingsRouter);

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
    console.log(
        `🚀 Teacher Dashboard running on http://localhost:${info.port}`,
    );
    console.log(`📝 Better Auth endpoints available at /api/auth/*`);
    console.log(`   Sign in with username: POST /api/auth/sign-in/username`);
    console.log(`   Session check: GET /api/auth/session`);
    console.log(`   Sign out: POST /api/auth/sign-out`);
});
