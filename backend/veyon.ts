import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { veyonConfig } from '../db/schema';

export const VEYON_AUTH_METHODS = {
    authKeys: '0c69b301-81b4-42d6-8fae-128cdd113314',
    ldap: '6f0a491e-c1c6-4338-8244-f823b0bf8670',
    logon: '63611f7c-b457-42c7-832e-67d0f9281085',
    simple: '73430b14-ef69-4c75-a145-ba635d1cc676',
} as const;

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
    authMethod: string;
    username: string | null;
    password: string | null;
    keyName: string | null;
    keyData: string | null;
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

export async function getVeyonConfigForOrg(organizationId: string) {
    return db.query.veyonConfig.findFirst({
        where: eq(veyonConfig.organizationId, organizationId),
    });
}

export function clearVeyonConnections(organizationId: string) {
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

function credentialsBody(config: VeyonCredentials) {
    if (config.authMethod === VEYON_AUTH_METHODS.authKeys) {
        return { keyname: config.keyName, keydata: config.keyData };
    }
    if (config.authMethod === VEYON_AUTH_METHODS.simple) {
        return { password: config.password };
    }
    return { username: config.username, password: config.password };
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

    private async connect(host: string): Promise<Connection> {
        const response = await fetch(
            this.url(`/authentication/${encodeURIComponent(host)}`),
            requestOptions(this.config, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    method: this.config.authMethod,
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

        const connecting = this.connect(host).finally(() => {
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

    async framebuffer(host: string, query: URLSearchParams) {
        return this.authenticatedRequest(host, `/framebuffer?${query.toString()}`);
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
