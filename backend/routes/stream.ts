import { streamSSE } from 'hono/streaming';
import { createApp } from './context';

export type StreamIdentity = {
    userId: string;
    sessionId: string;
    organizationId: string | null;
} | null;

export function streamIdentityMatches(expected: StreamIdentity, actual: StreamIdentity) {
    return expected === null ? actual === null : actual !== null &&
        expected.userId === actual.userId && expected.sessionId === actual.sessionId &&
        expected.organizationId === actual.organizationId;
}

const LOCAL_ORIGIN = 'http://stream.internal';
const INTERVAL_MS = 10_000;
const MAX_PATHS = 64;
const MAX_ACTIVE = 6;
const MAX_JSON_BYTES = 2 * 1_024 ** 2;
const fixedPaths = new Set([
    '/api/config', '/api/organizations', '/api/labs', '/api/labs/overview', '/api/devices',
    '/api/pihole/status', '/api/pihole/summary', '/api/pihole/top-domains',
    '/api/pihole/recent-blocked', '/api/pihole/queries', '/api/pihole/domains', '/api/pihole/blocking',
    '/api/fog/status', '/api/fog/system-info', '/api/fog/hosts', '/api/fog/images',
    '/api/fog/tasktypes', '/api/fog/snapins', '/api/fog/tasks/active', '/api/fog/multicastsessions/current',
    '/api/settings/firewall', '/api/settings/pihole', '/api/settings/fog', '/api/settings/veyon',
    '/api/veyon/status', '/api/veyon/computers', '/api/veyon/sync/preview', '/api/veyon/connections',
]);

/** Explicitly opt in reads, not every GET: auth, images and streams can have side effects. */
export function isStreamPath(path: string): boolean {
    if (path.length > 2_048 || !path.startsWith('/api/') || /[\\\s#]/.test(path)) return false;
    let url: URL;
    try { url = new URL(path, LOCAL_ORIGIN); } catch { return false; }
    if (url.origin !== LOCAL_ORIGIN || url.pathname + url.search !== path) return false;
    const pathname = url.pathname;
    if (!fixedPaths.has(pathname) &&
        !/^\/api\/labs\/[a-zA-Z0-9_-]{12}\/(stats|history|usage-history)$/.test(pathname) &&
        !/^\/api\/labs\/by-rule\/(?:\*|%2[Aa])[a-zA-Z0-9]+$/.test(pathname) &&
        !/^\/api\/fog\/hosts\/-?[1-9][0-9]{0,14}$/.test(pathname) &&
        !/^\/api\/pihole\/dns\/(upstreams|hosts|cnameRecords)$/.test(pathname) &&
        !/^\/api\/veyon\/computers\/[a-zA-Z0-9_-]{12}\/(information|features|hoststate|authentication-methods|user|session)$/.test(pathname) &&
        !/^\/api\/veyon\/computers\/[a-zA-Z0-9_-]{12}\/feature\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(pathname)) return false;

    const allowed = pathname === '/api/fog/hosts' ? ['search'] :
        pathname === '/api/pihole/top-domains' ? ['count', 'blocked', 'from', 'until', 'windowSeconds'] :
        pathname === '/api/pihole/recent-blocked' ? ['count'] :
        pathname === '/api/pihole/queries' ? ['length'] : [];
    const seen = new Set<string>();
    for (const [key, value] of url.searchParams) {
        if (!allowed.includes(key) || seen.has(key)) return false;
        seen.add(key);
        if (key === 'search' && (value.length > 200 || /[\x00-\x1f\x7f]/.test(value))) return false;
        if (key === 'blocked' && !['true', 'false'].includes(value)) return false;
        if (key === 'count' || key === 'length') {
            const max = key === 'length' ? 1_000 : 100;
            if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max) return false;
        }
        if ((key === 'from' || key === 'until') && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) return false;
        if (key === 'windowSeconds' && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 2_678_400)) return false;
    }
    if (seen.has('from') || seen.has('until')) {
        if (seen.has('windowSeconds')) return false;
        if (!seen.has('from') || !seen.has('until') || Number(url.searchParams.get('from')) > Number(url.searchParams.get('until'))) return false;
    }
    return true;
}

class ReadError extends Error {
    constructor(message: string, readonly status = 502) { super(message); }
}

type StreamMessage = { event: string; data: string; terminal?: boolean };

function createSnapshotWriter(send: (message: StreamMessage) => Promise<void>, onError: () => void) {
    const pending = new Map<string, { message: StreamMessage; bytes: number }>();
    let bytes = 0;
    let writing = false;
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const close = () => {
        closed = true;
        pending.clear();
        bytes = 0;
        clearTimeout(timer);
        finish();
    };
    const drain = async () => {
        writing = true;
        try {
            while (!closed && pending.size) {
                const [key, entry] = pending.entries().next().value!;
                pending.delete(key);
                bytes -= entry.bytes;
                try {
                    await Promise.race([send(entry.message), finished, new Promise<never>((_, reject) => {
                        timer = setTimeout(() => reject(new Error('Stream write timed out')), 30_000);
                    })]);
                } finally { clearTimeout(timer); }
            }
        } catch { close(); onError(); }
        finally { writing = false; }
    };
    return {
        close,
        enqueue(key: string, message: StreamMessage) {
            if (closed) return;
            bytes -= pending.get(key)?.bytes ?? 0;
            const size = Buffer.byteLength(message.data);
            pending.set(key, { message, bytes: size });
            bytes += size;
            // Keep newest snapshots, not an unbounded history for slow readers.
            for (const [oldKey, entry] of pending) {
                if (bytes <= 8 * 1_024 ** 2) break;
                if (entry.message.terminal) continue;
                pending.delete(oldKey);
                bytes -= entry.bytes;
            }
            if (!writing) void drain();
        },
    };
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
    if (response.status >= 300 && response.status < 400 || response.headers.has('Location') || response.headers.has('Content-Disposition')) {
        await response.body?.cancel().catch(() => undefined);
        throw new ReadError('Resource returned an unsupported response');
    }
    const mime = response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase();
    if (mime !== 'application/json' && !/^application\/[a-z0-9.+-]+\+json$/.test(mime ?? '')) {
        await response.body?.cancel().catch(() => undefined);
        throw new ReadError('Resource did not return JSON');
    }
    if (Number(response.headers.get('Content-Length')) > MAX_JSON_BYTES) {
        await response.body?.cancel().catch(() => undefined);
        throw new ReadError('Resource response exceeds the JSON size limit');
    }
    if (!response.body) throw new ReadError('Resource returned an empty body');
    const reader = response.body.getReader();
    const controller = new AbortController();
    const deadline = AbortSignal.any([signal, controller.signal]);
    const timer = setTimeout(() => controller.abort(), 30_000);
    const abort = () => { clearTimeout(timer); void reader.cancel().catch(() => undefined); };
    deadline.addEventListener('abort', abort, { once: true });
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    try {
        while (true) {
            deadline.throwIfAborted();
            const result = await reader.read();
            deadline.throwIfAborted();
            if (result.done) break;
            bytes += result.value.byteLength;
            if (bytes > MAX_JSON_BYTES) throw new ReadError('Resource response exceeds the JSON size limit');
            text += decoder.decode(result.value, { stream: true });
        }
        text += decoder.decode();
        try { return JSON.parse(text); } catch { throw new ReadError('Resource returned invalid JSON'); }
    } finally {
        clearTimeout(timer);
        deadline.removeEventListener('abort', abort);
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}

export function createStreamRouter(
    dispatch: (request: Request, identity: StreamIdentity) => Response | Promise<Response>,
    allowedOrigins: readonly string[] = [],
) {
    const router = createApp();
    router.get('/stream', (c) => {
        const origin = c.req.header('Origin');
        if (origin && origin !== new URL(c.req.url).origin && !allowedOrigins.includes(origin)) {
            return c.json({ error: 'Origin is not allowed' }, 403);
        }
        const encoded = c.req.query('paths');
        let paths: unknown;
        try { paths = encoded && encoded.length <= 32_768 ? JSON.parse(encoded) : null; } catch { paths = null; }
        if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_PATHS ||
            paths.some((path) => typeof path !== 'string' || !isStreamPath(path))) {
            return c.json({ error: 'paths must contain 1 to 64 allowlisted local JSON GET resources' }, 400);
        }
        const resources = [...new Set(paths as string[])].map((path) => ({ path, active: false, due: 0 }));
        const user = c.get('user');
        const session = c.get('session');
        const identity: StreamIdentity = user && session ? {
            userId: user.id, sessionId: session.id, organizationId: user.organizationId ?? null,
        } : null;
        const headers = new Headers({ Accept: 'application/json' });
        for (const name of ['Cookie', 'Authorization']) {
            const value = c.req.raw.headers.get(name);
            if (value) headers.set(name, value);
        }
        const response = streamSSE(c, async (stream) => {
            const controller = new AbortController();
            const { signal } = controller;
            let timer: ReturnType<typeof setTimeout> | undefined;
            let heartbeat: ReturnType<typeof setInterval> | undefined;
            let active = 0;
            let revoked = false;
            let finish!: () => void;
            const finished = new Promise<void>((resolve) => { finish = resolve; });
            const close = () => {
                if (signal.aborted) return;
                controller.abort();
                clearTimeout(timer);
                clearInterval(heartbeat);
                writer.close();
                c.req.raw.signal.removeEventListener('abort', close);
                stream.abort();
                finish();
            };
            const writer = createSnapshotWriter(
                async (message) => {
                    if (signal.aborted || revoked && !message.terminal) return;
                    await stream.writeSSE({ event: message.event, data: message.data });
                    if (message.terminal) close();
                }, close,
            );
            const snapshot = (path: string, status: number, data: unknown, terminal = false) => {
                const serialized = JSON.stringify({ path, status, data });
                writer.enqueue(path, { event: 'snapshot', data: serialized, terminal });
            };
            const sample = async (resource: typeof resources[number]) => {
                const started = Date.now();
                try {
                    // Do not race dispatch against a timer and abandon its slot: a handler
                    // that ignores cancellation must settle before another read can start.
                    const url = new URL(resource.path, LOCAL_ORIGIN);
                    const window = url.searchParams.get('windowSeconds');
                    if (window) {
                        const until = Math.floor(Date.now() / 1_000);
                        url.searchParams.delete('windowSeconds');
                        url.searchParams.set('from', String(Math.max(0, until - Number(window))));
                        url.searchParams.set('until', String(until));
                    }
                    const result = await dispatch(new Request(url.toString(), {
                        method: 'GET', headers, signal, redirect: 'manual',
                    }), identity);
                    if (signal.aborted || revoked) {
                        void result.body?.cancel().catch(() => undefined);
                        return;
                    }
                    const data = await readJson(result, signal);
                    if (signal.aborted || revoked) return;
                    const changed = typeof data === 'object' && data !== null &&
                        'code' in data && data.code === 'STREAM_IDENTITY_CHANGED';
                    if (changed || identity !== null && result.status === 401) {
                        revoked = true;
                        snapshot(resource.path, result.status, data, true);
                    } else snapshot(resource.path, result.status, data);
                } catch (error) {
                    if (!signal.aborted && !revoked) snapshot(resource.path,
                        error instanceof ReadError ? error.status : 502,
                        { error: error instanceof ReadError ? error.message : 'Unable to refresh resource' });
                } finally {
                    active--;
                    resource.active = false;
                    resource.due = started + (Math.floor((Date.now() - started) / INTERVAL_MS) + 1) * INTERVAL_MS;
                    if (!signal.aborted && !revoked) pump();
                }
            };
            const pump = () => {
                clearTimeout(timer);
                if (signal.aborted || revoked) return;
                const now = Date.now();
                for (const resource of resources) {
                    if (active === MAX_ACTIVE) break;
                    if (!resource.active && resource.due <= now) {
                        resource.active = true;
                        active++;
                        void sample(resource);
                    }
                }
                const future = resources.filter((resource) => !resource.active && resource.due > now);
                if (future.length) timer = setTimeout(pump, Math.max(1, Math.min(...future.map((resource) => resource.due)) - Date.now()));
            };
            stream.onAbort(close);
            c.req.raw.signal.addEventListener('abort', close, { once: true });
            if (c.req.raw.signal.aborted || stream.aborted) close();
            else {
                heartbeat = setInterval(() => writer.enqueue('heartbeat', { event: 'heartbeat', data: '{}' }), INTERVAL_MS);
                pump();
            }
            await finished;
        });
        response.headers.set('Cache-Control', 'no-store, private');
        response.headers.set('X-Accel-Buffering', 'no');
        return response;
    });
    return router;
}
