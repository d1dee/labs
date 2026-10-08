import { createPrivateKey } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { veyonConfig } from '../db/schema';
import { getLogger } from './logger';

const veyonLogger = getLogger(['labs', 'veyon']);

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
        public upstreamCode?: number,
    ) {
        super(message);
    }
}

// HTTP 401 is ambiguous: both InvalidConnection and AuthenticationFailed use it.
export function isInvalidSessionError(error: unknown): boolean {
    return (
        error instanceof VeyonApiError &&
        (error.upstreamCode === 2 ||
            (error.upstreamCode === undefined && error.status === 401 &&
                error.code !== 'VEYON_AUTH_FAILED'))
    );
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
    dispose: (signal?: AbortSignal) => Promise<void>;
};

const connections = new Map<string, Connection>();
type PendingConnection = {
    organizationId: string;
    controller: AbortController;
    promise: Promise<Connection>;
    waiters: number;
};
const pendingConnections = new Map<string, PendingConnection>();
const generations = new Map<string, number>();
function generation(organizationId: string) {
    return generations.get(organizationId) ?? 0;
}
const IDLE_RECONNECT_MS = 50_000;

type VeyonConfigRow = typeof veyonConfig.$inferSelect;
const configCache = new Map<
    string,
    { config: VeyonConfigRow | undefined; expiresAt: number }
>();
const CONFIG_CACHE_TTL_MS = 5_000;

export async function getVeyonConfigForOrg(organizationId: string): Promise<VeyonConfigRow | undefined> {
    // The framebuffer route polls this on every frame (~16×/s per wall);
    // a short TTL keeps the hot path off the database. Settings saves call
    // clearVeyonConnections, which drops this entry immediately.
    const cached = configCache.get(organizationId);
    if (cached && cached.expiresAt > Date.now()) return cached.config;
    const startedGeneration = generation(organizationId);
    const config = await db.query.veyonConfig.findFirst({
        where: eq(veyonConfig.organizationId, organizationId),
    });
    if (generation(organizationId) !== startedGeneration) {
        return getVeyonConfigForOrg(organizationId);
    }
    configCache.set(organizationId, { config, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
    return config;
}

export function clearVeyonConnections(organizationId: string) {
    generations.set(organizationId, generation(organizationId) + 1);
    configCache.delete(organizationId);
    for (const [key, connection] of connections) {
        if (connection.organizationId === organizationId) {
            connections.delete(key);
            void connection.dispose();
        }
    }
    for (const [key, pending] of pendingConnections) {
        if (pending.organizationId === organizationId) {
            pendingConnections.delete(key);
            pending.controller.abort(new VeyonApiError('Veyon configuration changed', 409, 'VEYON_CONFIG_CHANGED'));
        }
    }
}

function connectionKey(organizationId: string, userId: string, host: string) {
    return JSON.stringify([organizationId, userId, host]);
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
        return {
            message: typeof body.error === 'string' ? body.error :
                body.error?.message || body.message || `HTTP ${response.status}`,
            upstreamCode: typeof body.error === 'object' && body.error !== null &&
                typeof body.error.code === 'number' ? body.error.code : undefined,
        };
    } catch {
        return { message: `HTTP ${response.status}`, upstreamCode: undefined };
    }
}

// Also races mocked/non-cooperative fetches and body readers against cancellation.
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
        void promise.catch(() => undefined);
        return Promise.reject(signal.reason);
    }
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
}

async function withDeadline<T>(signal: AbortSignal | null | undefined, timeout: number,
    operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException('Veyon request timed out', 'TimeoutError')), timeout);
    try {
        controller.signal.throwIfAborted();
        return await operation(controller.signal);
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
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
    private readonly generation: number;

    constructor(
        private readonly config: VeyonCredentials,
        private readonly organizationId: string,
        private readonly userId: string,
    ) {
        this.baseUrl = config.url.replace(/\/+$/, '');
        this.generation = generation(organizationId);
    }

    private url(path: string) {
        return `${this.baseUrl}/api/v1${path}`;
    }

    private assertCurrent() {
        if (this.generation !== generation(this.organizationId)) {
            throw new VeyonApiError('Veyon configuration changed', 409, 'VEYON_CONFIG_CHANGED');
        }
    }

    // Buffer the body within the deadline, including framebuffer bytes. Returning
    // a live fetch Response would let body reads escape the operation's timeout.
    private async request(path: string, init: RequestInit, signal: AbortSignal, maxBytes?: number) {
        signal.throwIfAborted();
        const result = (async () => {
            const response = await fetch(this.url(path), requestOptions(this.config, { ...init, signal }));
            let body: ArrayBuffer;
            if (maxBytes !== undefined && response.body) {
                const reader = response.body.getReader();
                const chunks: Uint8Array[] = [];
                let receivedBytes = 0;
                const abort = () => {
                    if (typeof signal.reason === 'object' && signal.reason !== null && Object.isExtensible(signal.reason)) {
                        Object.assign(signal.reason, { receivedBytes });
                    }
                    void reader.cancel(signal.reason).catch(() => undefined);
                };
                signal.addEventListener('abort', abort, { once: true });
                try {
                    for (;;) {
                        signal.throwIfAborted();
                        const chunk = await abortable(reader.read(), signal);
                        if (chunk.done) break;
                        receivedBytes += chunk.value.byteLength;
                        if (receivedBytes > maxBytes) throw Object.assign(new VeyonApiError('Screenshot exceeds the frame byte limit', 502, 'VEYON_FRAME_TOO_LARGE'), { receivedBytes });
                        chunks.push(chunk.value);
                    }
                    const bytes = new Uint8Array(receivedBytes);
                    let offset = 0;
                    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
                    body = bytes.buffer;
                } catch (error) {
                    if (typeof error === 'object' && error !== null && Object.isExtensible(error)) Object.assign(error, { receivedBytes });
                    throw error;
                } finally {
                    signal.removeEventListener('abort', abort);
                    void reader.cancel().catch(() => undefined);
                    try { reader.releaseLock(); } catch { /* An aborted transport may still own a pending read. */ }
                }
            } else body = await response.arrayBuffer();
            if (signal.aborted && init.method === 'POST' && path.startsWith('/authentication/') && response.ok) {
                // A non-cooperative transport may finish after the last waiter left.
                // Dispose its remote connection, but never publish it locally.
                try {
                    const uid = JSON.parse(new TextDecoder().decode(body))?.['connection-uid'];
                    if (typeof uid === 'string' && uid.trim() && !/[\r\n]/.test(uid)) {
                        void this.dispose(decodeURIComponent(path.slice('/authentication/'.length)), uid);
                    }
                } catch { /* Malformed responses cannot identify a remote connection. */ }
            }
            signal.throwIfAborted();
            const buffered = new Response(response.status === 204 || response.status === 205 || response.status === 304 ? null : body, {
                status: response.status, statusText: response.statusText, headers: response.headers,
            });
            if (maxBytes !== undefined) Object.assign(buffered, { receivedBytes: body.byteLength });
            return buffered;
        })();
        return abortable(result, signal);
    }

    private async responseError(response: Response, authentication = false) {
        const { message, upstreamCode } = await readError(response);
        const invalid = upstreamCode === 2 || (upstreamCode === undefined && response.status === 401 && !authentication);
        return new VeyonApiError(message, response.status,
            authentication ? (upstreamCode === 6 || response.status === 401 ? 'VEYON_AUTH_FAILED' : 'VEYON_CONNECT_FAILED') :
                invalid ? 'VEYON_SESSION_EXPIRED' : upstreamCode === 6 ? 'VEYON_AUTH_FAILED' : 'VEYON_ERROR', upstreamCode);
    }

    async hostState(host: string, signal?: AbortSignal) {
        return withDeadline(signal, 8_000, async (deadline) => {
            const response = await this.request(`/hoststate/${encodeURIComponent(host)}`, {}, deadline);
            if (!response.ok) throw await this.responseError(response);
            return response.json() as Promise<Record<string, unknown>>;
        });
    }

    async authenticationMethods(host: string, signal?: AbortSignal): Promise<string[]> {
        return withDeadline(signal, 8_000, async (deadline) => {
            const response = await this.request(`/authentication/${encodeURIComponent(host)}`, {}, deadline);
            if (!response.ok) throw await this.responseError(response);
            const body = await response.json() as { methods?: string[] };
            return body.methods ?? [];
        });
    }

    private async dispose(host: string, uid: string, callerSignal?: AbortSignal) {
        await withDeadline(callerSignal, 5_000, async (signal) => {
            await this.request(`/authentication/${encodeURIComponent(host)}`, {
                method: 'DELETE', headers: { 'Connection-Uid': uid },
            }, signal);
        }).catch(() => undefined);
    }

    private async createConnection(host: string, signal: AbortSignal): Promise<Connection> {
        this.assertCurrent();
        assertKeyCredentials(this.config);
        const response = await this.request(`/authentication/${encodeURIComponent(host)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: VEYON_AUTH_KEYS_METHOD, credentials: credentialsBody(this.config) }),
        }, signal);
        if (!response.ok) throw await this.responseError(response, true);
        let body: { 'connection-uid'?: unknown; validUntil?: unknown };
        try {
            body = await response.json() as typeof body;
        } catch {
            throw new VeyonApiError('Malformed Veyon authentication response', 502, 'VEYON_INVALID_RESPONSE');
        }
        const uid = body?.['connection-uid'];
        const rawExpiry = body?.validUntil;
        const validUntil = typeof rawExpiry === 'number' ? rawExpiry * (rawExpiry < 10_000_000_000 ? 1000 : 1) :
            typeof rawExpiry === 'string' && rawExpiry.trim() ? Date.parse(rawExpiry) : NaN;
        try {
            if (typeof uid !== 'string' || !uid.trim() || /[\r\n]/.test(uid) ||
                !Number.isFinite(validUntil) || validUntil <= Date.now()) {
                throw new VeyonApiError('Malformed Veyon authentication response', 502, 'VEYON_INVALID_RESPONSE');
            }
            signal.throwIfAborted();
            this.assertCurrent();
        } catch (error) {
            if (typeof uid === 'string' && uid.trim() && !/[\r\n]/.test(uid)) void this.dispose(host, uid);
            throw error;
        }
        const connection: Connection = {
            uid, validUntil, lastUsed: Date.now(), organizationId: this.organizationId,
            userId: this.userId, host, dispose: (callerSignal) => this.dispose(host, uid, callerSignal),
        };
        connections.set(connectionKey(this.organizationId, this.userId, host), connection);
        veyonLogger.info('Veyon connection authenticated for {host}', { host, organizationId: this.organizationId });
        return connection;
    }

    async authenticate(host: string, signal?: AbortSignal): Promise<Connection> {
        return withDeadline(signal, 12_000, (deadline) => this.getConnection(host, deadline));
    }

    private async getConnection(host: string, signal: AbortSignal): Promise<Connection> {
        signal.throwIfAborted();
        this.assertCurrent();
        const key = connectionKey(this.organizationId, this.userId, host);
        const existing = connections.get(key);
        const now = Date.now();
        if (existing && existing.validUntil > now + 5_000 && now - existing.lastUsed < IDLE_RECONNECT_MS) {
            existing.lastUsed = now;
            return existing;
        }
        if (existing) {
            connections.delete(key);
            void existing.dispose();
        }
        let pending = pendingConnections.get(key);
        if (!pending) {
            const controller = new AbortController();
            pending = { organizationId: this.organizationId, controller, waiters: 0, promise: undefined! };
            const entry = pending;
            // Each waiter keeps its own original deadline. Authentication remains
            // alive only while at least one caller still needs the shared result.
            entry.promise = this.createConnection(host, controller.signal).finally(() => {
                if (pendingConnections.get(key) === entry) pendingConnections.delete(key);
            });
            pendingConnections.set(key, entry);
        }
        const entry = pending;
        entry.waiters += 1;
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            entry.waiters -= 1;
            if (entry.waiters === 0 && pendingConnections.get(key) === entry) {
                pendingConnections.delete(key);
                entry.controller.abort(signal.reason ?? new DOMException('Authentication cancelled', 'AbortError'));
            }
        };
        signal.addEventListener('abort', release, { once: true });
        try {
            const connection = await abortable(entry.promise, signal);
            signal.throwIfAborted();
            this.assertCurrent();
            return connection;
        } finally {
            signal.removeEventListener('abort', release);
            release();
        }
    }

    private async authenticatedRequest(host: string, path: string, init: RequestInit = {}, maxBytes?: number): Promise<Response> {
        let receivedBytes = 0;
        return withDeadline(init.signal, 12_000, async (signal) => {
            for (let attempt = 0; ; attempt += 1) {
                const connection = await this.getConnection(host, signal);
                signal.throwIfAborted();
                this.assertCurrent();
                const headers = new Headers(init.headers);
                headers.set('Connection-Uid', connection.uid);
                if (maxBytes !== undefined && receivedBytes >= maxBytes) {
                    throw Object.assign(new VeyonApiError('Screenshot exceeds the frame byte limit', 502, 'VEYON_FRAME_TOO_LARGE'), { receivedBytes });
                }
                let response: Response;
                try {
                    response = await this.request(path, { ...init, headers }, signal, maxBytes === undefined ? undefined : maxBytes - receivedBytes);
                } catch (error) {
                    if (maxBytes !== undefined && typeof error === 'object' && error !== null && Object.isExtensible(error)) {
                        const partial = 'receivedBytes' in error && typeof error.receivedBytes === 'number' ? error.receivedBytes : 0;
                        Object.assign(error, { receivedBytes: receivedBytes + partial });
                    }
                    throw error;
                }
                if (maxBytes !== undefined) receivedBytes += (response as Response & { receivedBytes: number }).receivedBytes;
                if (response.ok) {
                    if (maxBytes !== undefined) Object.assign(response, { receivedBytes });
                    return response;
                }
                const error = await this.responseError(response);
                if (maxBytes !== undefined) Object.assign(error, { receivedBytes });
                if (!isInvalidSessionError(error)) throw error;
                const key = connectionKey(this.organizationId, this.userId, host);
                if (connections.get(key) === connection) {
                    connections.delete(key);
                    void connection.dispose();
                }
                if (attempt !== 0) throw error;
                veyonLogger.info('Veyon connection invalid for {host}, reauthenticating', { host, organizationId: this.organizationId });
            }
        }).catch((error) => {
            if (maxBytes !== undefined && receivedBytes > 0 && typeof error === 'object' && error !== null && Object.isExtensible(error)) {
                const reported = 'receivedBytes' in error && typeof error.receivedBytes === 'number' ? error.receivedBytes : 0;
                Object.assign(error, { receivedBytes: Math.max(receivedBytes, reported) });
            }
            throw error;
        });
    }

    async close(host: string, signal?: AbortSignal) {
        this.assertCurrent();
        const key = connectionKey(this.organizationId, this.userId, host);
        const pending = pendingConnections.get(key);
        if (pending) {
            pendingConnections.delete(key);
            pending.controller.abort(new DOMException('Connection closed', 'AbortError'));
        }
        const connection = connections.get(key);
        connections.delete(key);
        await connection?.dispose(signal);
    }

    async information(host: string, signal?: AbortSignal) {
        const [userResponse, sessionResponse, featuresResponse] = await Promise.all([
            this.authenticatedRequest(host, '/user', { signal }),
            this.authenticatedRequest(host, '/session', { signal }),
            this.authenticatedRequest(host, '/feature', { signal }),
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

    async framebuffer(host: string, query: URLSearchParams, signal?: AbortSignal, maxBytes?: number) {
        if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 1)) throw new VeyonApiError('Invalid framebuffer byte limit', 400, 'INVALID_DATA');
        return this.authenticatedRequest(
            host,
            `/framebuffer?${query.toString()}`,
            signal ? { signal } : {},
            maxBytes,
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

export async function getVeyonClient(organizationId: string, userId: string): Promise<VeyonClient> {
    const startedGeneration = generation(organizationId);
    const config = await getVeyonConfigForOrg(organizationId);
    if (generation(organizationId) !== startedGeneration) return getVeyonClient(organizationId, userId);
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
        .map(({ uid: _uid, organizationId: _org, userId: _user, dispose: _dispose, ...connection }) =>
            connection,
        );
}
