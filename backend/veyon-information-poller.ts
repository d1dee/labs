import { getVeyonClient, getVeyonGeneration, VeyonApiError } from './veyon';

export type VeyonInformationMode = 'full' | 'status';
export type VeyonInformation = {
    user: unknown;
    session: unknown;
    features: unknown;
};
export interface VeyonInformationClient {
    information(host: string, signal: AbortSignal): Promise<VeyonInformation>;
    status(host: string, signal: AbortSignal): Promise<{ state: 'online' }>;
}
export type VeyonInformationEvent =
    | { type: 'information'; state: 'online'; information?: VeyonInformation }
    | { type: 'information'; state: 'offline'; error: string }
    | { type: 'unavailable'; error: string };
type Target = {
    organizationId: string;
    userId: string;
    host: string;
    mode: VeyonInformationMode;
};
type Listener = (event: VeyonInformationEvent) => void;
type Worker = {
    target: Target;
    controller: AbortController;
    listeners: Map<symbol, Listener>;
    cancelTimer: () => void;
    failures: number;
};

export function veyonInformationError(error: unknown): string {
    if (
        error instanceof VeyonApiError &&
        (error.status === 429 ||
            error.code === 'VEYON_BUSY' ||
            error.code === 'VEYON_CONNECTION_LIMIT')
    )
        return 'Live status checks are at capacity. Retrying automatically; displayed statuses may be out of date.';
    if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
    )
        return 'Veyon connection timed out';
    return 'Veyon request failed';
}

const defaults = {
    intervalMs: 10_000,
    maxBackoffMs: 60_000,
    requestTimeoutMs: 30_000,
    concurrency: 2,
    maxWorkers: 512,
    maxSubscribers: 8_192,
    maxSubscribersPerWorker: 256,
    maxResultBytes: 64 * 1_024,
    maxCacheBytes: 4 * 1_024 ** 2,
    cacheMaxAgeMs: 10_000,
};

// Only subscribed targets retain observations. Due hosts use a bounded FIFO,
// but each host schedules its own next cycle independently after settling.
export class VeyonInformationPoller {
    readonly config: typeof defaults;
    private readonly workers = new Map<string, Worker>();
    private readonly ready = new Map<string, Worker>();
    private active = 0;
    private readonly cache = new Map<
        string,
        {
            event: VeyonInformationEvent;
            at: number;
            bytes: number;
            generation: number;
        }
    >();
    private cacheBytes = 0;
    private subscribers = 0;

    constructor(
        private readonly getClient: (
            organizationId: string,
            userId: string,
        ) => Promise<VeyonInformationClient> = getVeyonClient,
        config: Partial<typeof defaults> = {},
        private readonly clock = {
            now: () => Date.now(),
            schedule: (callback: () => void, ms: number): (() => void) => {
                const timer = setTimeout(callback, ms);
                timer.unref?.();
                return () => clearTimeout(timer);
            },
        },
        private readonly generation: (
            organizationId: string,
        ) => number = getVeyonGeneration,
    ) {
        this.config = { ...defaults, ...config };
    }

    subscribe(target: Target, listener: Listener): () => void {
        const key = JSON.stringify([
            target.organizationId,
            target.userId,
            target.host,
            target.mode,
        ]);
        let worker = this.workers.get(key);
        if (
            this.subscribers >= this.config.maxSubscribers ||
            (worker &&
                worker.listeners.size >= this.config.maxSubscribersPerWorker) ||
            (!worker && this.workers.size >= this.config.maxWorkers)
        )
            throw new VeyonApiError(
                'Veyon information subscriptions are at capacity',
                503,
                'VEYON_BUSY',
            );
        const fresh = !worker;
        if (!worker) {
            worker = {
                target: { ...target },
                controller: new AbortController(),
                listeners: new Map(),
                cancelTimer: () => {},
                failures: 0,
            };
            this.workers.set(key, worker);
        }
        const entry = worker;
        const token = Symbol();
        entry.listeners.set(token, listener);
        this.subscribers += 1;
        const cached = this.cache.get(key);
        if (
            cached &&
            cached.generation === this.generation(target.organizationId) &&
            this.clock.now() - cached.at < this.config.cacheMaxAgeMs
        )
            this.deliver(listener, cached.event);
        else this.dropCache(key);
        if (fresh) this.enqueue(key, entry);
        return () => {
            if (!entry.listeners.delete(token)) return;
            this.subscribers -= 1;
            if (entry.listeners.size) return;
            this.workers.delete(key);
            this.ready.delete(key);
            this.dropCache(key);
            entry.cancelTimer();
            entry.controller.abort();
        };
    }

    private deliver(listener: Listener, event: VeyonInformationEvent) {
        try {
            listener(event);
        } catch {
            /* A disconnected viewer cannot stall other subscribers. */
        }
    }

    private dropCache(key: string) {
        const cached = this.cache.get(key);
        if (cached) this.cacheBytes -= cached.bytes;
        this.cache.delete(key);
    }

    private enqueue(key: string, worker: Worker) {
        if (worker.controller.signal.aborted) return;
        this.ready.set(key, worker);
        this.drain();
    }

    private drain() {
        while (this.active < this.config.concurrency && this.ready.size) {
            const [key, worker] = this.ready.entries().next().value!;
            this.ready.delete(key);
            this.active += 1;
            void this.poll(key, worker).finally(() => {
                this.active -= 1;
                this.drain();
            });
        }
    }

    private async poll(key: string, worker: Worker) {
        const generation = this.generation(worker.target.organizationId);
        const controller = new AbortController();
        const cancel = () => controller.abort(worker.controller.signal.reason);
        worker.controller.signal.addEventListener('abort', cancel, {
            once: true,
        });
        const cancelDeadline = this.clock.schedule(
            () =>
                controller.abort(
                    new DOMException(
                        'Veyon information timed out',
                        'TimeoutError',
                    ),
                ),
            this.config.requestTimeoutMs,
        );
        const { signal } = controller;
        const pending = <T>(operation: Promise<T>): Promise<T> =>
            new Promise((resolve, reject) => {
                const abort = () => reject(signal.reason);
                signal.addEventListener('abort', abort, { once: true });
                operation
                    .then(resolve, reject)
                    .finally(() => signal.removeEventListener('abort', abort));
                if (signal.aborted) abort();
            });
        let event: VeyonInformationEvent;
        let clientReady = false;
        try {
            // Never capture a client across cycles: settings saves invalidate it.
            const client = await pending(
                this.getClient(
                    worker.target.organizationId,
                    worker.target.userId,
                ),
            );
            signal.throwIfAborted();
            clientReady = true;
            if (worker.target.mode === 'status') {
                await pending(client.status(worker.target.host, signal));
                event = { type: 'information', state: 'online' };
            } else {
                const information = await pending(
                    client.information(worker.target.host, signal),
                );
                event = { type: 'information', state: 'online', information };
            }
            if (
                Buffer.byteLength(JSON.stringify(event)) >
                this.config.maxResultBytes
            )
                throw new VeyonApiError(
                    'Veyon information exceeds the result limit',
                    502,
                    'VEYON_INFORMATION_TOO_LARGE',
                );
            worker.failures = 0;
        } catch (error) {
            if (worker.controller.signal.aborted) return;
            worker.failures = Math.min(worker.failures + 1, 10);
            const unavailable =
                !clientReady ||
                (error instanceof VeyonApiError &&
                    (error.status === 429 ||
                        [
                            'VEYON_BUSY',
                            'VEYON_CONNECTION_LIMIT',
                            'VEYON_CONFIG_CHANGED',
                            'CONFIG_MISSING',
                            'INVALID_KEY',
                            'VEYON_INFORMATION_TOO_LARGE',
                        ].includes(error.code)));
            event = unavailable
                ? { type: 'unavailable', error: veyonInformationError(error) }
                : {
                      type: 'information',
                      state: 'offline',
                      error: veyonInformationError(error),
                  };
        } finally {
            cancelDeadline();
            worker.controller.signal.removeEventListener('abort', cancel);
        }
        if (
            worker.controller.signal.aborted ||
            this.workers.get(key) !== worker
        )
            return;
        this.dropCache(key);
        if (generation !== this.generation(worker.target.organizationId)) {
            worker.failures = 0;
            worker.cancelTimer = this.clock.schedule(
                () => this.enqueue(key, worker),
                0,
            );
            return;
        }
        if (event.type === 'information') {
            const bytes = Buffer.byteLength(JSON.stringify(event));
            if (bytes <= this.config.maxCacheBytes) {
                while (this.cacheBytes + bytes > this.config.maxCacheBytes)
                    this.dropCache(this.cache.keys().next().value!);
                this.cache.set(key, {
                    event,
                    at: this.clock.now(),
                    bytes,
                    generation,
                });
                this.cacheBytes += bytes;
            }
        }
        for (const listener of worker.listeners.values())
            this.deliver(listener, event);
        if (worker.controller.signal.aborted) return;
        const interval = Math.min(
            this.config.maxBackoffMs,
            this.config.intervalMs * 2 ** Math.max(0, worker.failures - 1),
        );
        worker.cancelTimer = this.clock.schedule(
            () => this.enqueue(key, worker),
            interval,
        );
    }
}

export const veyonInformationPoller = new VeyonInformationPoller();
