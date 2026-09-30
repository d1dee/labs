import { createPrivateKey } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { veyonConfig } from '../db/schema';

// Veyon WebAPI authentication method UUIDs. Key file authentication
// (AuthKeys) is the only method this backend supports: the WebAPI server
// receives the PEM private key plus key name, signs the Veyon Server's
// random challenge with it, and the server verifies the signature against
// the public key deployed under that key name.
export const VEYON_AUTH_KEYS_METHOD = '0c69b301-81b4-42d6-8fae-128cdd113314';

export const VEYON_FEATURES = {
    screenLock: 'ccb535a2-1d24-4cc1-a709-8b47d2b2ac79',
    inputDevicesLock: 'e4a77879-e544-4fec-bc18-e534f33b934c',
    userLogin: '7310707d-3918-460d-a949-65bd152cb958',
    userLogoff: '7311d43d-ab53-439e-a03a-8cb25f7ed526',
    reboot: '4f7d98f0-395a-4fff-b968-e49b8d0f748c',
    powerDown: '6f5a27a0-0e2f-496e-afcc-7aae62eede10',
    demoServer: 'e4b6e743-1f5b-491d-9364-e091086200f4',
    fullScreenDemoClient: '7b6231bd-eb89-45d3-af32-f70663b2f878',
    windowDemoClient: 'ae45c3db-dc2e-4204-ae8b-374cdab8c62c',
    startApp: 'da9ca56a-b2ad-4fff-8f8a-929b2927b442',
    openWebsite: '8a11a75d-b3db-48b6-b9cb-f8422ddd5b0c',
    textMessage: 'e75ae9c8-ac17-4d00-8f0d-019348346208',
} as const;

export type VeyonCredentials = {
    url: string;
    keyName: string;
    keyData: string;
    verifyTls: boolean;
};

export class VeyonApiError extends Error {
    constructor(
        message: string,
        public status = 502,
        public code = 'VEYON_ERROR',
    ) {
        super(message);
    }
}

// Fail before any network call when the stored credential set cannot drive
// key file authentication (missing key material or unparsable PEM).
export function assertValidPrivateKeyPem(pem: string) {
    if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(pem)) {
        throw new VeyonApiError(
            'Key data must be a PEM-encoded private key (-----BEGIN PRIVATE KEY-----)',
            400,
            'INVALID_KEY',
        );
    }
    try {
        createPrivateKey(pem);
    } catch {
        throw new VeyonApiError('PEM private key could not be parsed', 400, 'INVALID_KEY');
    }
}

export function assertKeyCredentials(config: VeyonCredentials) {
    if (!config.keyName?.trim() || !config.keyData) {
        throw new VeyonApiError(
            'Veyon key file authentication requires a key name and PEM private key',
            409,
            'CONFIG_MISSING',
        );
    }
    assertValidPrivateKeyPem(config.keyData);
}

type Connection = {
    uid: string;
    validUntil: number;
    lastUsed: number;
    organizationId: string;
    userId: string;
    host: string;
};

const connections = new Map<string, Connection>();
const pendingConnections = new Map<string, Promise<Connection>>();
const IDLE_RECONNECT_MS = 50_000;

type VeyonConfigRow = typeof veyonConfig.$inferSelect;
const configCache = new Map<
    string,
    { config: VeyonConfigRow | undefined; expiresAt: number }
>();
const CONFIG_CACHE_TTL_MS = 5_000;

export async function getVeyonConfigForOrg(organizationId: string) {
    // The framebuffer route polls this on every frame (~16×/s per wall);
    // a short TTL keeps the hot path off the database. Settings saves call
    // clearVeyonConnections, which drops this entry immediately.
    const cached = configCache.get(organizationId);
    if (cached && cached.expiresAt > Date.now()) return cached.config;
    const config = await db.query.veyonConfig.findFirst({
        where: eq(veyonConfig.organizationId, organizationId),
    });
    configCache.set(organizationId, {
        config,
        expiresAt: Date.now() + CONFIG_CACHE_TTL_MS,
    });
    return config;
}

export function clearVeyonConnections(organizationId: string) {
    configCache.delete(organizationId);
    for (const [key, connection] of connections) {
        if (connection.organizationId === organizationId) connections.delete(key);
    }
    for (const key of pendingConnections.keys()) {
        if (key.startsWith(`${organizationId}:`)) pendingConnections.delete(key);
    }
}

function connectionKey(organizationId: string, userId: string, host: string) {
    return `${organizationId}:${userId}:${host}`;
}

function requestOptions(config: VeyonCredentials, init: RequestInit): RequestInit {
    if (config.verifyTls) return init;
    return { ...init, tls: { rejectUnauthorized: false } } as RequestInit;
}

async function readError(response: Response) {
    try {
        const body = (await response.json()) as {
            error?: { code?: number; message?: string } | string;
            message?: string;
        };
        if (typeof body.error === 'string') return body.error;
        return body.error?.message || body.message || `HTTP ${response.status}`;
    } catch {
        return `HTTP ${response.status}`;
    }
}

// AuthKeys credentials per the Veyon WebAPI protocol: the WebAPI server
// loads the PEM private key and signs the target Veyon Server's challenge
// with it; the server verifies against the public key stored under keyname.
function credentialsBody(config: VeyonCredentials) {
    return { keyname: config.keyName, keydata: config.keyData };
}

export class VeyonClient {
    private readonly baseUrl: string;

    constructor(
        private readonly config: VeyonCredentials,
        private readonly organizationId: string,
        private readonly userId: string,
    ) {
        this.baseUrl = config.url.replace(/\/+$/, '');
    }

    private url(path: string) {
        return `${this.baseUrl}/api/v1${path}`;
    }

    // GET /api/v1/hoststate/<host> — unauthenticated reachability probe of
    // the Veyon Server behind the WebAPI proxy.
    async hostState(host: string) {
        const response = await fetch(
            this.url(`/hoststate/${encodeURIComponent(host)}`),
            requestOptions(this.config, { signal: AbortSignal.timeout(8_000) }),
        );
        if (!response.ok) {
            throw new VeyonApiError(await readError(response), response.status);
        }
        return response.json() as Promise<Record<string, unknown>>;
    }

    async authenticationMethods(host: string): Promise<string[]> {
        const response = await fetch(
            this.url(`/authentication/${encodeURIComponent(host)}`),
            requestOptions(this.config, { signal: AbortSignal.timeout(8_000) }),
        );
        if (!response.ok) {
            throw new VeyonApiError(await readError(response), response.status);
        }
        const body = (await response.json()) as { methods?: string[] };
        return body.methods ?? [];
    }

    // POST /api/v1/authentication/<host> — creates a connection and performs
    // key file authentication. Normally called lazily by getConnection.
    async authenticate(host: string): Promise<Connection> {
        assertKeyCredentials(this.config);
        const response = await fetch(
            this.url(`/authentication/${encodeURIComponent(host)}`),
            requestOptions(this.config, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    method: VEYON_AUTH_KEYS_METHOD,
                    credentials: credentialsBody(this.config),
                }),
                signal: AbortSignal.timeout(12_000),
            }),
        );
        if (!response.ok) {
            throw new VeyonApiError(
                await readError(response),
                response.status,
                response.status === 401 ? 'VEYON_AUTH_FAILED' : 'VEYON_CONNECT_FAILED',
            );
        }
        const body = (await response.json()) as {
            'connection-uid': string;
            validUntil: number | string;
        };
        const validUntil =
            typeof body.validUntil === 'number'
                ? body.validUntil * (body.validUntil < 10_000_000_000 ? 1000 : 1)
                : Date.parse(body.validUntil);
        const connection: Connection = {
            uid: body['connection-uid'],
            validUntil: Number.isFinite(validUntil) ? validUntil : Date.now() + 60_000,
            lastUsed: Date.now(),
            organizationId: this.organizationId,
            userId: this.userId,
            host,
        };
        connections.set(connectionKey(this.organizationId, this.userId, host), connection);
        return connection;
    }

    private async getConnection(host: string) {
        const key = connectionKey(this.organizationId, this.userId, host);
        const existing = connections.get(key);
        const now = Date.now();
        if (
            existing &&
            existing.validUntil > now + 5_000 &&
            now - existing.lastUsed < IDLE_RECONNECT_MS
        ) {
            existing.lastUsed = now;
            return existing;
        }
        connections.delete(key);
        const pending = pendingConnections.get(key);
        if (pending) return pending;

        const connecting = this.authenticate(host).finally(() => {
            pendingConnections.delete(key);
        });
        pendingConnections.set(key, connecting);
        return connecting;
    }

    private async authenticatedRequest(
        host: string,
        path: string,
        init: RequestInit = {},
        retry = true,
    ): Promise<Response> {
        const connection = await this.getConnection(host);
        const response = await fetch(
            this.url(path),
            requestOptions(this.config, {
                ...init,
                headers: {
                    ...Object.fromEntries(new Headers(init.headers).entries()),
                    'Connection-Uid': connection.uid,
                },
                signal: init.signal ?? AbortSignal.timeout(12_000),
            }),
        );
        if (response.status === 401 && retry) {
            connections.delete(connectionKey(this.organizationId, this.userId, host));
            return this.authenticatedRequest(host, path, init, false);
        }
        if (!response.ok) {
            throw new VeyonApiError(await readError(response), response.status);
        }
        return response;
    }

    async close(host: string) {
        const key = connectionKey(this.organizationId, this.userId, host);
        const connection = connections.get(key);
        connections.delete(key);
        if (!connection) return;
        await fetch(
            this.url(`/authentication/${encodeURIComponent(host)}`),
            requestOptions(this.config, {
                method: 'DELETE',
                headers: { 'Connection-Uid': connection.uid },
                signal: AbortSignal.timeout(5_000),
            }),
        ).catch(() => undefined);
    }

    async information(host: string) {
        const [userResponse, sessionResponse, featuresResponse] = await Promise.all([
            this.authenticatedRequest(host, '/user'),
            this.authenticatedRequest(host, '/session'),
            this.authenticatedRequest(host, '/feature'),
        ]);
        return {
            user: await userResponse.json(),
            session: await sessionResponse.json(),
            features: await featuresResponse.json(),
        };
    }

    // GET /api/v1/user — logged-on user information.
    async user(host: string) {
        return (await this.authenticatedRequest(host, '/user')).json();
    }

    // GET /api/v1/session — session information (id, uptime, client).
    async session(host: string) {
        return (await this.authenticatedRequest(host, '/session')).json();
    }

    async framebuffer(host: string, query: URLSearchParams, signal?: AbortSignal) {
        return this.authenticatedRequest(
            host,
            `/framebuffer?${query.toString()}`,
            signal ? { signal } : {},
        );
    }

    async features(host: string) {
        return (await this.authenticatedRequest(host, '/feature')).json();
    }

    async featureStatus(host: string, uid: string) {
        return (await this.authenticatedRequest(host, `/feature/${uid}`)).json();
    }

    async setFeature(
        host: string,
        uid: string,
        active: boolean,
        args: Record<string, unknown> = {},
    ) {
        await this.authenticatedRequest(host, `/feature/${uid}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active, arguments: args }),
        });
    }
}

export async function getVeyonClient(organizationId: string, userId: string) {
    const config = await getVeyonConfigForOrg(organizationId);
    if (!config) {
        throw new VeyonApiError('Veyon is not configured', 409, 'CONFIG_MISSING');
    }
    return new VeyonClient(config, organizationId, userId);
}

export function listOpenConnections(organizationId: string, userId: string) {
    return [...connections.values()]
        .filter(
            (connection) =>
                connection.organizationId === organizationId &&
                connection.userId === userId,
        )
        .map(({ uid: _uid, organizationId: _org, userId: _user, ...connection }) =>
            connection,
        );
}
