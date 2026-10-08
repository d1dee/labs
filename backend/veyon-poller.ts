import { errorProperty, getLogger } from './logger';
import { getVeyonClient, isInvalidSessionError, VeyonApiError } from './veyon';

const pollerLogger = getLogger(['labs', 'veyon', 'poller']);

// The poller authenticates with a service identity so its Veyon connections
// are shared across every dashboard user of an organization (one polling
// stream per managed machine) and never appear in per-user connection lists.
export const VEYON_POLLER_USER_ID = 'veyon-poller-service';

// Bounded FIFO of retained screenshot states so a re-subscribing viewer sees
// the last known frame immediately after the poller was idle-stopped.
export type VeyonScreenshotProfile = {
    intervalMs: number;
    width: number;
    quality: number;
    priority: 'grid' | 'viewer';
};

export type VeyonPollerConfig = {
    /** Normal polling interval between successful screenshot requests. */
    pollIntervalMs: number;
    /** One deadline covering queueing, authentication, framebuffer and body. */
    requestTimeoutMs: number;
    /** Upper bound for the exponential failure backoff. */
    maxBackoffMs: number;
    /** Random 0..jitterMs added to every scheduled delay to desynchronize machines. */
    jitterMs: number;
    /** Maximum simultaneous screenshot requests across all workers. */
    globalConcurrency: number;
    /** Idle connection linger; no polling occurs without subscribers. */
    idleLingerMs: number;
    /** Screenshot width requested from the Veyon framebuffer endpoint. */
    frameWidth: number;
    frameQuality: number;
    viewerIntervalMs: number;
    viewerWidth: number;
    viewerQuality: number;
    organizationRequestsPerSecond: number;
    organizationBytesPerSecond: number;
    organizationConcurrency: number;
    requestBurst: number;
    byteBurst: number;
    maxPendingRequests: number;
    maxPendingPerOrganization: number;
    estimatedFrameBytes: number;
    maxFrameBytes: number;
    maxRetainedBytes: number;
    retainedMaxAgeMs: number;
    maxRetainedStates: number;
    streamMaxPendingBytes: number;
};

// All polling behavior is derived from this configuration (env-overridable)
// instead of scattered magic constants. Values are clamped so a typo cannot
// produce a busy loop or a zero timeout.
export function resolveVeyonPollerConfig(
    env: Record<string, string | undefined> = process.env,
): VeyonPollerConfig {
    const int = (name: string, fallback: number, min: number, max: number) => {
        const parsed = Number.parseInt(env[name] ?? '', 10);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(max, Math.max(min, parsed));
    };
    return {
        pollIntervalMs: int('VEYON_POLL_INTERVAL_MS', 5_000, 250, 60_000),
        requestTimeoutMs: int('VEYON_POLL_TIMEOUT_MS', 5_000, 500, 120_000),
        maxBackoffMs: int('VEYON_POLL_MAX_BACKOFF_MS', 10_000, 1_000, 300_000),
        jitterMs: int('VEYON_POLL_JITTER_MS', 300, 0, 5_000),
        globalConcurrency: int('VEYON_POLL_GLOBAL_CONCURRENCY', 8, 1, 64),
        idleLingerMs: int('VEYON_POLL_IDLE_LINGER_MS', 5_000, 0, 300_000),
        frameWidth: int('VEYON_POLL_FRAME_WIDTH', 320, 160, 1_920),
        frameQuality: int('VEYON_POLL_FRAME_QUALITY', 50, 1, 100),
        viewerIntervalMs: int('VEYON_VIEWER_INTERVAL_MS', 1_000, 250, 60_000),
        viewerWidth: int('VEYON_VIEWER_FRAME_WIDTH', 1_280, 160, 1_920),
        viewerQuality: int('VEYON_VIEWER_FRAME_QUALITY', 75, 1, 100),
        organizationRequestsPerSecond: int('VEYON_ORG_REQUESTS_PER_SECOND', 12, 1, 1_000),
        organizationBytesPerSecond: int('VEYON_ORG_BYTES_PER_SECOND', 512 * 1_024, 1_024, 1_024 ** 3),
        organizationConcurrency: int('VEYON_ORG_CONCURRENCY', 4, 1, 64),
        requestBurst: int('VEYON_ORG_REQUEST_BURST', 4, 1, 1_000),
        byteBurst: int('VEYON_ORG_BYTE_BURST', 512 * 1_024, 1_024, 1_024 ** 3),
        maxPendingRequests: int('VEYON_MAX_PENDING_REQUESTS', 512, 1, 10_000),
        maxPendingPerOrganization: int('VEYON_MAX_PENDING_PER_ORG', 256, 1, 10_000),
        estimatedFrameBytes: int('VEYON_ESTIMATED_FRAME_BYTES', 32 * 1_024, 1, 2 * 1_024 ** 2),
        maxFrameBytes: int('VEYON_MAX_FRAME_BYTES', 2 * 1_024 ** 2, 1_024, 16 * 1_024 ** 2),
        maxRetainedBytes: int('VEYON_MAX_RETAINED_BYTES', 32 * 1_024 ** 2, 1_024, 1_024 ** 3),
        retainedMaxAgeMs: int('VEYON_RETAINED_MAX_AGE_MS', 60_000, 1_000, 300_000),
        maxRetainedStates: int('VEYON_MAX_RETAINED_STATES', 128, 1, 10_000),
        streamMaxPendingBytes: int('VEYON_STREAM_MAX_PENDING_BYTES', 8 * 1_024 ** 2, 1_024, 1_024 ** 3),
    };
}

export type VeyonPollerComputer = {
    id: string;
    host: string;
    name: string;
};

export type VeyonScreenshotState = {
    /** Last successful screenshot bytes (kept across failures). */
    image: ArrayBuffer | null;
    mimeType: string;
    /** True when the image predates the most recent failed poll. */
    stale: boolean;
    lastUpdated: number | null;
    consecutiveFailures: number;
    lastError: string | null;
};

export type VeyonFrameEvent = {
    type: 'frame';
    organizationId: string;
    computerId: string;
    image: ArrayBuffer;
    mimeType: string;
    lastUpdated: number;
};

export type VeyonPollerStateEvent = {
    type: 'state';
    organizationId: string;
    computerId: string;
    stale: boolean;
    lastUpdated: number | null;
    consecutiveFailures: number;
    lastError: string | null;
};

export type VeyonPollerEvent = VeyonFrameEvent | VeyonPollerStateEvent | {
    type: 'reset';
    organizationId: string;
    computerId: string;
};

export type VeyonPollerListener = (event: VeyonPollerEvent) => void;

export type VeyonFramebufferClient = {
    close?(host: string, signal?: AbortSignal): Promise<unknown>;
    framebuffer(
        host: string,
        query: URLSearchParams,
        signal?: AbortSignal,
        maxBytes?: number,
    ): Promise<Response>;
};

export type VeyonPollerDependencies = {
    /** Injectable for tests; defaults to the org-wide poller VeyonClient. */
    getClient?: (organizationId: string, signal?: AbortSignal) => Promise<VeyonFramebufferClient>;
};

// Minimal counting semaphore. A slot is transferred directly to the woken
// waiter on release (the count only decreases when nobody is queued), which
// keeps the holder count correct even when new acquires interleave.
export class Semaphore {
    private activeCount = 0;
    private readonly waiters: Array<() => void> = [];

    constructor(public readonly limit: number) {}

    async acquire(signal?: AbortSignal): Promise<void> {
        signal?.throwIfAborted();
        if (this.activeCount < this.limit) {
            this.activeCount += 1;
            return;
        }
        await new Promise<void>((resolve, reject) => {
            const waiter = () => {
                signal?.removeEventListener('abort', abort);
                resolve();
            };
            const abort = () => {
                const index = this.waiters.indexOf(waiter);
                if (index !== -1) this.waiters.splice(index, 1);
                reject(signal!.reason);
            };
            this.waiters.push(waiter);
            signal?.addEventListener('abort', abort, { once: true });
        });
    }

    release(): void {
        const next = this.waiters.shift();
        if (next) {
            next();
            return;
        }
        this.activeCount = Math.max(0, this.activeCount - 1);
    }

    get active() {
        return this.activeCount;
    }

    get queued() {
        return this.waiters.length;
    }
}

type BudgetLease = { start(): void; finish(receivedBytes?: number): void };
type BudgetWaiter = {
    estimate: number;
    priority: () => VeyonScreenshotProfile['priority'];
    grant: (lease: BudgetLease) => void;
    cancel: (error: unknown) => void;
};
type OrganizationBudget = {
    organizationId: string;
    requests: number;
    bytes: number;
    updatedAt: number;
    lastUsedAt: number;
    active: number;
    viewerStreak: number;
    queue: BudgetWaiter[];
    requestsStarted: number;
    receivedBytes: number;
    chargedBytes: number;
    reservedRequests: number;
    reservedBytes: number;
};

// Admission precedes the network semaphore. An organization can reserve only
// a few slots, and round-robin organizations get weighted FIFO (3 viewers, 1
// grid). Actual bytes create debt, never a fresh allowance on the next poll.
export class VeyonPollBudget {
    private readonly organizations = new Map<string, OrganizationBudget>();
    private timer: ReturnType<typeof setTimeout> | undefined;
    private cursor = 0;
    private pending = 0;
    private active = 0;
    private closed = false;

    constructor(private readonly config: VeyonPollerConfig) {}

    acquire(organizationId: string, estimate: number, priority: () => VeyonScreenshotProfile['priority'], signal: AbortSignal): Promise<BudgetLease> {
        signal.throwIfAborted();
        if (this.closed) return Promise.reject(new DOMException('Budget closed', 'AbortError'));
        if (this.pending >= this.config.maxPendingRequests) {
            return Promise.reject(new VeyonApiError('Screenshot admission queue is full', 429, 'VEYON_BUDGET_QUEUE_FULL'));
        }
        let budget = this.organizations.get(organizationId);
        if (!budget) {
            this.pruneOrganizations();
            if (this.organizations.size >= this.config.maxPendingRequests + this.config.globalConcurrency + this.config.organizationConcurrency) {
                return Promise.reject(new VeyonApiError('Screenshot organization budget capacity is full', 429, 'VEYON_BUDGET_QUEUE_FULL'));
            }
            budget = {
                organizationId, requests: this.config.requestBurst, bytes: this.config.byteBurst,
                updatedAt: Date.now(), lastUsedAt: Date.now(), active: 0, viewerStreak: 0, queue: [],
                requestsStarted: 0, receivedBytes: 0, chargedBytes: 0,
                reservedRequests: 0, reservedBytes: 0,
            };
            this.organizations.set(organizationId, budget);
        }
        if (budget.queue.length >= this.config.maxPendingPerOrganization) {
            return Promise.reject(new VeyonApiError('Organization screenshot admission queue is full', 429, 'VEYON_BUDGET_QUEUE_FULL'));
        }
        const organization = budget;
        organization.lastUsedAt = Date.now();
        return new Promise((resolve, reject) => {
            const abort = () => {
                const index = organization.queue.indexOf(waiter);
                if (index !== -1) {
                    organization.queue.splice(index, 1);
                    this.pending -= 1;
                }
                signal.removeEventListener('abort', abort);
                reject(signal.reason);
                this.pump();
            };
            const waiter: BudgetWaiter = {
                estimate: Math.min(this.config.byteBurst, Math.max(1, estimate)), priority,
                grant: (lease) => { signal.removeEventListener('abort', abort); resolve(lease); },
                cancel: (error) => { signal.removeEventListener('abort', abort); reject(error); },
            };
            organization.queue.push(waiter);
            this.pending += 1;
            signal.addEventListener('abort', abort, { once: true });
            this.pump();
        });
    }

    private refill(budget: OrganizationBudget) {
        const now = Date.now();
        const seconds = Math.max(0, now - budget.updatedAt) / 1_000;
        budget.updatedAt = now;
        budget.requests = Math.min(this.config.requestBurst - budget.reservedRequests, budget.requests + seconds * this.config.organizationRequestsPerSecond);
        budget.bytes = Math.min(this.config.byteBurst - budget.reservedBytes, budget.bytes + seconds * this.config.organizationBytesPerSecond);
    }

    private next(budget: OrganizationBudget) {
        const grid = budget.queue.findIndex((waiter) => waiter.priority() === 'grid');
        const viewer = budget.queue.findIndex((waiter) => waiter.priority() === 'viewer');
        return viewer !== -1 && (grid === -1 || budget.viewerStreak < 3) ? viewer : grid;
    }

    private pruneOrganizations() {
        for (const [id, budget] of this.organizations) {
            if (budget.active || budget.queue.length) continue;
            this.refill(budget);
            if (Date.now() - budget.lastUsedAt >= this.config.retainedMaxAgeMs && budget.requests >= this.config.requestBurst && budget.bytes >= this.config.byteBurst) this.organizations.delete(id);
        }
    }

    private pump() {
        clearTimeout(this.timer);
        this.timer = undefined;
        if (this.closed) return;
        const organizations = [...this.organizations.values()];
        let progress: boolean;
        do {
            progress = false;
            for (let offset = 0; offset < organizations.length; offset += 1) {
                const budget = organizations[(this.cursor + offset) % organizations.length]!;
                this.refill(budget);
                if (this.active >= this.config.globalConcurrency + this.config.organizationConcurrency) break;
                if (!budget.queue.length || budget.active >= this.config.organizationConcurrency) continue;
                const index = this.next(budget);
                const waiter = budget.queue[index]!;
                if (budget.requests < 1 || budget.bytes < waiter.estimate) continue;
                budget.queue.splice(index, 1);
                this.pending -= 1;
                budget.requests -= 1;
                budget.bytes -= waiter.estimate;
                budget.reservedRequests += 1;
                budget.reservedBytes += waiter.estimate;
                budget.active += 1;
                this.active += 1;
                budget.viewerStreak = waiter.priority() === 'viewer' ? budget.viewerStreak + 1 : 0;
                let started = false;
                let finished = false;
                waiter.grant({
                    start: () => {
                        if (started || finished) return;
                        this.refill(budget);
                        budget.reservedRequests -= 1;
                        started = true;
                        budget.requestsStarted += 1;
                    },
                    finish: (receivedBytes) => {
                        if (finished) return;
                        finished = true;
                        this.refill(budget);
                        budget.active -= 1;
                        this.active -= 1;
                        budget.lastUsedAt = Date.now();
                        budget.reservedBytes -= waiter.estimate;
                        if (!started) {
                            budget.reservedRequests -= 1;
                            budget.requests = Math.min(this.config.requestBurst - budget.reservedRequests, budget.requests + 1);
                            budget.bytes = Math.min(this.config.byteBurst - budget.reservedBytes, budget.bytes + waiter.estimate);
                        } else {
                            const charged = receivedBytes ?? waiter.estimate;
                            budget.bytes = Math.min(this.config.byteBurst - budget.reservedBytes, budget.bytes + waiter.estimate - charged);
                            budget.receivedBytes += receivedBytes ?? 0;
                            budget.chargedBytes += charged;
                        }
                        this.pump();
                    },
                });
                progress = true;
            }
            if (organizations.length) this.cursor = (this.cursor + 1) % organizations.length;
        } while (progress);
        let wait = Infinity;
        for (const budget of organizations) {
            if (!budget.queue.length || budget.active >= this.config.organizationConcurrency || this.active >= this.config.globalConcurrency + this.config.organizationConcurrency) continue;
            const waiter = budget.queue[this.next(budget)]!;
            wait = Math.min(wait, Math.max(
                (1 - budget.requests) / this.config.organizationRequestsPerSecond,
                (waiter.estimate - budget.bytes) / this.config.organizationBytesPerSecond,
            ) * 1_000);
        }
        if (Number.isFinite(wait)) this.timer = setTimeout(() => this.pump(), Math.max(1, Math.ceil(wait)));
    }

    stats(organizationId?: string) {
        this.pruneOrganizations();
        return [...this.organizations.values()].filter((budget) => organizationId === undefined || budget.organizationId === organizationId).map((budget) => {
            this.refill(budget);
            return {
                organizationId: budget.organizationId, active: budget.active,
                queued: budget.queue.length, requestTokens: budget.requests, byteTokens: budget.bytes,
                requestsStarted: budget.requestsStarted, receivedBytes: budget.receivedBytes,
                chargedBytes: budget.chargedBytes,
                reservedRequests: budget.reservedRequests, reservedBytes: budget.reservedBytes,
            };
        });
    }

    get queued() { return this.pending; }

    dispose() {
        this.closed = true;
        clearTimeout(this.timer);
        for (const budget of this.organizations.values()) {
            for (const waiter of budget.queue.splice(0)) waiter.cancel(new DOMException('Budget closed', 'AbortError'));
        }
        this.pending = 0;
    }
}

function emptyState(): VeyonScreenshotState {
    return {
        image: null,
        mimeType: 'image/jpeg',
        stale: false,
        lastUpdated: null,
        consecutiveFailures: 0,
        lastError: null,
    };
}

function isTimeoutError(error: unknown): boolean {
    return (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
    );
}

function summarizeError(error: unknown): { kind: string; message: string } {
    if (error instanceof VeyonApiError) {
        return { kind: `HTTP ${error.status}`, message: error.message };
    }
    if (error instanceof Error) {
        return { kind: error.name, message: error.message };
    }
    return { kind: 'unknown', message: String(error) };
}

function workerKey(organizationId: string, computerId: string) {
    return JSON.stringify([organizationId, computerId]);
}

// One worker per (organization, computer): a strictly serialized loop where
// the next request is scheduled only after the previous one settled, so at
// most one screenshot request per machine is ever in flight. The shared
// semaphore additionally caps how many workers hit Veyon at once.
class PollingWorker {
    inFlight = false;
    queued = false;
    private readonly references = new Map<symbol, VeyonScreenshotProfile>();
    private estimatedBytes: number;
    private readonly controller = new AbortController();
    private cycleController = new AbortController();
    private refreshPending = false;
    private client: VeyonFramebufferClient | undefined;
    private clientHost: string | undefined;
    readonly finished: Promise<void>;
    private finish!: () => void;
    private running = false;
    private lingerTimer: ReturnType<typeof setTimeout> | null = null;
    private sleeper: (() => void) | null = null;

    constructor(
        readonly organizationId: string,
        public computer: VeyonPollerComputer,
        private readonly config: VeyonPollerConfig,
        private readonly semaphore: Semaphore,
        private readonly getClient: (
            organizationId: string,
            signal?: AbortSignal,
        ) => Promise<VeyonFramebufferClient>,
        private readonly emit: (event: VeyonPollerEvent) => void,
        private readonly onStop: (worker: PollingWorker) => void,
        private state: VeyonScreenshotState,
        private readonly budget: VeyonPollBudget,
        private readonly previous?: Promise<void>,
        private readonly canClose: (host: string) => boolean = () => true,
    ) {
        this.estimatedBytes = state.image?.byteLength || config.estimatedFrameBytes;
        this.finished = new Promise((resolve) => { this.finish = resolve; });
    }

    start() {
        if (this.running) return;
        this.running = true;
        pollerLogger.info(
            'Screenshot polling worker started for {computer} ({host})',
            {
                computer: this.computer.name,
                computerId: this.computer.id,
                host: this.computer.host,
                organizationId: this.organizationId,
            },
        );
        void this.runLoop();
    }

    addRef(token: symbol, profile: VeyonScreenshotProfile) {
        const previous = this.profile();
        const idle = this.references.size === 0;
        this.references.set(token, profile);
        if (this.lingerTimer) {
            clearTimeout(this.lingerTimer);
            this.lingerTimer = null;
        }
        const current = this.profile();
        if (this.running && (idle || current.intervalMs < previous.intervalMs || current.width > previous.width || current.quality > previous.quality)) this.refresh();
    }

    // Returns the remaining refcount; schedules an idle stop when it hits 0.
    release(token?: symbol): number {
        const reference = token ?? this.references.keys().next().value;
        if (reference !== undefined) this.references.delete(reference);
        if (
            this.references.size === 0 &&
            this.lingerTimer === null &&
            this.running
        ) {
            this.cycleController.abort();
            this.cycleController = new AbortController();
            this.wake();
            this.lingerTimer = setTimeout(
                () => {
                    this.lingerTimer = null;
                    this.stop();
                },
                Math.max(0, this.config.idleLingerMs),
            );
        }
        return this.references.size;
    }

    refresh() {
        this.refreshPending = true;
        this.wake();
    }

    reset(computer = this.computer) {
        this.computer = { ...computer };
        this.state = emptyState();
        this.estimatedBytes = this.config.estimatedFrameBytes;
        this.cycleController.abort();
        this.cycleController = new AbortController();
        this.emit({ type: 'reset', organizationId: this.organizationId, computerId: computer.id });
        this.refresh();
    }

    profile(): VeyonScreenshotProfile {
        const profiles = [...this.references.values()];
        return {
            intervalMs: profiles.length ? Math.min(...profiles.map((profile) => profile.intervalMs)) : this.config.pollIntervalMs,
            width: profiles.length ? Math.max(...profiles.map((profile) => profile.width)) : this.config.frameWidth,
            quality: profiles.length ? Math.max(...profiles.map((profile) => profile.quality)) : this.config.frameQuality,
            priority: profiles.some((profile) => profile.priority === 'viewer') ? 'viewer' : 'grid',
        };
    }

    private intervalMs() { return this.profile().intervalMs; }

    stop() {
        if (this.lingerTimer) {
            clearTimeout(this.lingerTimer);
            this.lingerTimer = null;
        }
        if (!this.running) return;
        this.running = false;
        this.controller.abort();
        this.wake();
        pollerLogger.info(
            'Screenshot polling worker stopped for {computer} ({host})',
            {
                computer: this.computer.name,
                computerId: this.computer.id,
                host: this.computer.host,
                organizationId: this.organizationId,
            },
        );
        this.onStop(this);
    }

    snapshot(): VeyonScreenshotState {
        return { ...this.state };
    }

    dropImage() { this.state = { ...this.state, image: null, lastUpdated: null, stale: false }; }

    stats() {
        return {
            refcount: this.references.size,
            inFlight: this.inFlight,
            stale: this.state.stale,
            consecutiveFailures: this.state.consecutiveFailures,
            lastUpdated: this.state.lastUpdated,
            lastError: this.state.lastError,
            profile: this.profile(),
        };
    }

    private wake() {
        this.sleeper?.();
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.sleeper = null;
                resolve();
            }, ms);
            this.sleeper = () => {
                clearTimeout(timer);
                this.sleeper = null;
                resolve();
            };
        });
    }

    private async runLoop() {
        if (this.previous) await this.previous;
        try {
            while (this.running) {
                if (!this.references.size) {
                    await this.sleep(Math.max(1, this.config.idleLingerMs));
                    continue;
                }
                this.refreshPending = false;
                if (this.clientHost && this.clientHost !== this.computer.host) {
                    await this.closeConnection();
                    if (!this.running) break;
                }
                const hadFailures = this.state.consecutiveFailures > 0;
                await this.pollOnce();
                if (!this.running) break;
                // Log recovery once, not on every successful frame.
                if (hadFailures && this.state.consecutiveFailures === 0) {
                    pollerLogger.info(
                        'Screenshot polling recovered for {computer} ({host})',
                        {
                            computer: this.computer.name,
                            computerId: this.computer.id,
                            host: this.computer.host,
                            organizationId: this.organizationId,
                        },
                    );
                }
                if (!this.refreshPending) await this.sleep(this.nextDelayMs());
            }
        } finally {
            // Replacement workers wait for this cleanup before authenticating.
            await this.closeConnection();
            this.finish();
        }
    }

    private async closeConnection() {
        const host = this.clientHost;
        this.clientHost = undefined;
        if (!host || !this.canClose(host)) return;
        try {
            await this.client?.close?.(host, AbortSignal.timeout(this.config.requestTimeoutMs));
        } catch (error) {
            pollerLogger.debug('Screenshot connection cleanup failed: {error}', { error: errorProperty(error) });
        }
    }

    // Serialized request cycle: the loop itself is the only scheduler, so a
    // request is only issued after the previous one fully settled.
    private async pollOnce() {
        const startedAt = Date.now();
        const cycle = this.cycleController;
        const waitingSignal = AbortSignal.any([this.controller.signal, cycle.signal]);
        let timer: ReturnType<typeof setTimeout> | undefined;
        let lease: BudgetLease | undefined;
        let receivedBytes: number | undefined;
        let acquired = false;
        let pending: Promise<unknown> | undefined;
        try {
            this.queued = true;
            lease = await this.budget.acquire(this.organizationId, this.estimatedBytes, () => this.profile().priority, waitingSignal);
            waitingSignal.throwIfAborted();
            const deadline = new AbortController();
            timer = setTimeout(() => deadline.abort(new DOMException('Screenshot request timed out', 'TimeoutError')), this.config.requestTimeoutMs);
            const signal = AbortSignal.any([waitingSignal, deadline.signal]);
            this.queued = this.semaphore.active >= this.semaphore.limit;
            await this.semaphore.acquire(signal);
            acquired = true;
            this.queued = false;
            if (!this.running || !this.references.size) return;
            this.inFlight = true;
            const client = await this.raceTimeout(
                this.getClient(this.organizationId, signal), signal,
            );
            this.client = client;
            signal.throwIfAborted();
            if (!this.running) return;
            const query = new URLSearchParams({
                format: 'jpeg',
                quality: String(this.profile().quality),
                width: String(this.profile().width),
            });
            this.clientHost = this.computer.host;
            lease.start();
            const framebuffer = client.framebuffer(this.computer.host, query, signal, this.config.maxFrameBytes);
            pending = framebuffer;
            const response = await this.raceTimeout(framebuffer, signal);
            if ('receivedBytes' in response && typeof response.receivedBytes === 'number' && Number.isFinite(response.receivedBytes)) receivedBytes = Math.max(0, response.receivedBytes);
            signal.throwIfAborted();
            if (!this.running) return;
            if (!response.ok) {
                throw new VeyonApiError(
                    `HTTP ${response.status}`,
                    response.status,
                );
            }
            const mimeType =
                response.headers.get('Content-Type')?.split(';')[0] ||
                'image/jpeg';
            const body = response.arrayBuffer();
            pending = body;
            const image = await this.raceTimeout(body, signal);
            receivedBytes ??= image.byteLength;
            this.estimatedBytes = Math.max(1, Math.min(receivedBytes, this.config.maxFrameBytes));
            signal.throwIfAborted();
            if (!this.running) return;
            if (image.byteLength === 0) {
                throw new VeyonApiError(
                    'Veyon returned an empty screenshot',
                    502,
                    'VEYON_EMPTY_FRAME',
                );
            }
            if (image.byteLength > this.config.maxFrameBytes) throw new VeyonApiError('Screenshot exceeds the frame byte limit', 502, 'VEYON_FRAME_TOO_LARGE');
            this.onSuccess(image, mimeType);
        } catch (error) {
            if (typeof error === 'object' && error !== null && 'receivedBytes' in error && typeof error.receivedBytes === 'number' && Number.isFinite(error.receivedBytes)) {
                receivedBytes = Math.max(0, error.receivedBytes);
                this.estimatedBytes = Math.max(1, Math.min(receivedBytes, this.config.maxFrameBytes));
            }
            if (this.running && !cycle.signal.aborted && !(error instanceof VeyonApiError && error.code === 'VEYON_BUDGET_QUEUE_FULL')) this.onFailure(error, Date.now() - startedAt);
        } finally {
            clearTimeout(timer);
            // A client that ignores cancellation must not release its slot and
            // allow overlapping requests. Production fetch settles on abort.
            await pending?.catch(() => undefined);
            this.queued = false;
            this.inFlight = false;
            if (acquired) this.semaphore.release();
            lease?.finish(receivedBytes);
            if (this.clientHost && this.clientHost !== this.computer.host) await this.closeConnection();
        }
    }

    // All stages observe the same deadline, rather than renewing a timeout.
    private raceTimeout<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const cleanup = () => {
                signal.removeEventListener('abort', abort);
            };
            const abort = () => {
                cleanup();
                reject(signal.reason);
            };
            signal.addEventListener('abort', abort, { once: true });
            promise.then(
                (value) => {
                    cleanup();
                    resolve(value);
                },
                (error) => {
                    cleanup();
                    reject(error);
                },
            );
            if (signal.aborted) abort();
        });
    }

    private onSuccess(image: ArrayBuffer, mimeType: string) {
        const lastUpdated = Date.now();
        this.state = {
            image,
            mimeType,
            stale: false,
            lastUpdated,
            consecutiveFailures: 0,
            lastError: null,
        };
        this.emit({
            type: 'frame',
            organizationId: this.organizationId,
            computerId: this.computer.id,
            image,
            mimeType,
            lastUpdated,
        });
    }

    private onFailure(error: unknown, durationMs: number) {
        const summary = summarizeError(error);
        this.state = {
            ...this.state,
            // A failed poll never blanks the previous frame: it only marks
            // it stale and counts the failure toward the backoff.
            stale: this.state.image !== null,
            consecutiveFailures: this.state.consecutiveFailures + 1,
            lastError: summary.message,
        };
        const properties = {
            computer: this.computer.name,
            computerId: this.computer.id,
            host: this.computer.host,
            organizationId: this.organizationId,
            durationMs,
            consecutiveFailures: this.state.consecutiveFailures,
            nextDelayMs: Math.round(this.nextDelayMs()),
        };
        if (isTimeoutError(error)) {
            pollerLogger.warn(
                'Screenshot timed out for {computer} ({host}) after {durationMs}ms',
                properties,
            );
        } else if (isInvalidSessionError(error)) {
            // The client already reauthenticated once inside this cycle;
            // the session is still rejected, so report an auth problem.
            pollerLogger.warn(
                'Veyon session invalid after reauthentication for {computer} ({host})',
                properties,
            );
        } else {
            pollerLogger.warn('Screenshot failed for {computer} ({host})', {
                ...properties,
                error: errorProperty(error),
            });
        }
        pollerLogger.info(
            'Screenshot polling entered backoff for {computer} ({host}): {consecutiveFailures} consecutive failure(s), next attempt in {nextDelayMs}ms',
            properties,
        );
        this.emit({
            type: 'state',
            organizationId: this.organizationId,
            computerId: this.computer.id,
            stale: this.state.stale,
            lastUpdated: this.state.lastUpdated,
            consecutiveFailures: this.state.consecutiveFailures,
            lastError: this.state.lastError,
        });
    }

    // success: pollIntervalMs; failure #n: min(interval * 2^n, maxBackoff).
    // Jitter (0..jitterMs) spreads machines so they never poll in lockstep.
    private nextDelayMs(): number {
        const failures = this.state.consecutiveFailures;
        const base =
            failures === 0
                 ? this.intervalMs()
                : Math.min(
                       this.intervalMs() * 2 ** Math.min(failures, 10),
                       Math.max(this.intervalMs(), this.config.maxBackoffMs),
                  );
        return base + Math.random() * this.config.jitterMs;
    }
}

export type VeyonPollerWorkerStats = {
    computerId: string;
    name: string;
    host: string;
    refcount: number;
    inFlight: boolean;
    stale: boolean;
    consecutiveFailures: number;
    lastUpdated: number | null;
    lastError: string | null;
    profile: VeyonScreenshotProfile;
};

export type VeyonPollerStats = {
    workers: VeyonPollerWorkerStats[];
    retainedStates: number;
    inFlightRequests: number;
    queuedRequests: number;
    cachedFrameBytes: number;
    budgets: ReturnType<VeyonPollBudget['stats']>;
};

export class VeyonScreenshotPoller {
    private budget: VeyonPollBudget;
    private cacheTimer: ReturnType<typeof setTimeout> | undefined;
    private readonly stopping = new Map<string, Promise<void>>();
    private readonly workers = new Map<string, PollingWorker>();
    private readonly retained = new Map<
        string,
        { organizationId: string; host: string; state: VeyonScreenshotState; storedAt: number }
    >();
    private readonly listeners = new Set<VeyonPollerListener>();
    readonly semaphore: Semaphore;
    private readonly getClient: (
        organizationId: string,
        signal?: AbortSignal,
    ) => Promise<VeyonFramebufferClient>;

    constructor(
        readonly config: VeyonPollerConfig = resolveVeyonPollerConfig(),
        dependencies: VeyonPollerDependencies = {},
    ) {
        this.semaphore = new Semaphore(config.globalConcurrency);
        this.budget = new VeyonPollBudget(config);
        this.getClient =
            dependencies.getClient ??
            ((organizationId: string) =>
                getVeyonClient(organizationId, VEYON_POLLER_USER_ID));
    }

    private readonly emit = (event: VeyonPollerEvent) => {
        if (event.type === 'frame') this.pruneFrames();
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch (error) {
                pollerLogger.warn(
                    'Screenshot poller listener failed: {error}',
                    { error: errorProperty(error) },
                );
            }
        }
    };

    // Registers a viewer for a computer and returns the current state. The
    // first subscriber starts (or revives) the polling worker; polling stops
    // immediately when the last subscriber leaves; only connections linger.
    subscribe(
        organizationId: string,
        computer: VeyonPollerComputer,
        options: Partial<VeyonScreenshotProfile> & { token?: symbol; refresh?: boolean } = {},
    ): VeyonScreenshotState {
        const key = workerKey(organizationId, computer.id);
        this.pruneFrames();
        this.updateComputer(organizationId, computer);
        let worker = this.workers.get(key);
        if (!worker) {
            const retained = this.retained.get(key);
            this.retained.delete(key);
            // When a stopped worker is revived, hand it its retained frame
            // (marked stale until a fresh one arrives).
            worker = new PollingWorker(
                organizationId,
                { ...computer },
                this.config,
                this.semaphore,
                this.getClient,
                this.emit,
                (stopped) => {
                    if (this.workers.get(key) !== stopped) return;
                    this.workers.delete(key);
                    this.stopping.set(key, stopped.finished);
                    void stopped.finished.then(() => {
                        if (this.stopping.get(key) === stopped.finished) this.stopping.delete(key);
                    });
                    // Retained frames are no longer being refreshed, so mark
                    // them stale for the next subscriber.
                    this.retainState(
                        key,
                        organizationId,
                        stopped.computer.host,
                        stopped.snapshot().image
                            ? { ...stopped.snapshot(), stale: true }
                            : emptyState(),
                    );
                },
                retained ? { ...retained.state, stale: true } : emptyState(),
                this.budget,
                this.stopping.get(key),
                (host) => ![...this.workers.values()].some((other) =>
                    other.organizationId === organizationId &&
                    other.computer.id !== computer.id && other.computer.host === host,
                ),
            );
            this.workers.set(key, worker);
        }
        const viewer = options.priority === 'viewer';
        worker.addRef(options.token ?? Symbol(), {
            intervalMs: options.intervalMs ?? (viewer ? this.config.viewerIntervalMs : this.config.pollIntervalMs),
            width: options.width ?? (viewer ? this.config.viewerWidth : this.config.frameWidth),
            quality: options.quality ?? (viewer ? this.config.viewerQuality : this.config.frameQuality),
            priority: options.priority ?? 'grid',
        });
        if (options.refresh) worker.refresh();
        worker.start();
        return worker.snapshot();
    }

    // Call after a successful computer PUT, even when no new viewer subscribes.
    updateComputer(organizationId: string, computer: VeyonPollerComputer) {
        const key = workerKey(organizationId, computer.id);
        const worker = this.workers.get(key);
        if (worker && worker.computer.host !== computer.host) {
            this.retained.delete(key);
            worker.reset(computer);
        } else if (worker) {
            worker.computer = { ...computer };
        }
        if (this.retained.has(key) && this.retained.get(key)?.host !== computer.host) {
            this.retained.delete(key);
            this.emit({ type: 'reset', organizationId, computerId: computer.id });
        }
    }

    invalidateOrganization(organizationId: string) {
        for (const worker of this.workers.values()) {
            if (worker.organizationId === organizationId) worker.reset();
        }
        for (const [key, retained] of this.retained) {
            if (retained.organizationId !== organizationId) continue;
            this.retained.delete(key);
            const [, computerId] = JSON.parse(key) as [string, string];
            this.emit({ type: 'reset', organizationId, computerId });
        }
    }

    private retainState(
        key: string,
        organizationId: string,
        host: string,
        state: VeyonScreenshotState,
    ) {
        this.retained.set(key, { organizationId, host, state, storedAt: Date.now() });
        while (this.retained.size > this.config.maxRetainedStates) {
            const oldest = this.retained.keys().next().value;
            if (oldest === undefined) break;
            this.retained.delete(oldest);
        }
        this.pruneFrames();
    }

    // The cap includes active worker snapshots, not just idle retained states.
    private pruneFrames() {
        clearTimeout(this.cacheTimer);
        this.cacheTimer = undefined;
        const now = Date.now();
        const frames: Array<{ updatedAt: number; bytes: number; drop: () => void }> = [];
        let nextExpiry = Infinity;
        for (const [key, retained] of this.retained) {
            const updatedAt = retained.state.lastUpdated ?? retained.storedAt;
            if (now - updatedAt >= this.config.retainedMaxAgeMs) {
                this.retained.delete(key);
                continue;
            }
            nextExpiry = Math.min(nextExpiry, updatedAt + this.config.retainedMaxAgeMs);
            if (retained.state.image) frames.push({ updatedAt, bytes: retained.state.image.byteLength, drop: () => { this.retained.delete(key); } });
        }
        for (const worker of this.workers.values()) {
            const state = worker.snapshot();
            if (!state.image) continue;
            frames.push({ updatedAt: state.lastUpdated ?? 0, bytes: state.image.byteLength, drop: () => worker.dropImage() });
        }
        frames.sort((a, b) => a.updatedAt - b.updatedAt);
        let bytes = frames.reduce((sum, frame) => sum + frame.bytes, 0);
        let count = frames.length;
        for (const frame of frames) {
            if (now - frame.updatedAt >= this.config.retainedMaxAgeMs || bytes > this.config.maxRetainedBytes || count > this.config.maxRetainedStates) {
                frame.drop();
                bytes -= frame.bytes;
                count -= 1;
            } else nextExpiry = Math.min(nextExpiry, frame.updatedAt + this.config.retainedMaxAgeMs);
        }
        if (Number.isFinite(nextExpiry)) {
            this.cacheTimer = setTimeout(() => this.pruneFrames(), Math.max(1, nextExpiry - now));
            this.cacheTimer.unref?.();
        }
    }

    unsubscribe(organizationId: string, computerId: string, token?: symbol) {
        const key = workerKey(organizationId, computerId);
        const worker = this.workers.get(key);
        if (worker) worker.release(token);
    }

    getState(
        organizationId: string,
        computerId: string,
    ): VeyonScreenshotState | undefined {
        this.pruneFrames();
        const key = workerKey(organizationId, computerId);
        const worker = this.workers.get(key);
        if (worker) return worker.snapshot();
        const retained = this.retained.get(key);
        return retained ? { ...retained.state } : undefined;
    }

    // Drops all state for a computer that no longer exists.
    forget(organizationId: string, computerId: string) {
        const key = workerKey(organizationId, computerId);
        this.workers.get(key)?.stop();
        this.retained.delete(key);
        this.emit({ type: 'reset', organizationId, computerId });
    }

    addListener(listener: VeyonPollerListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    stats(organizationId?: string): VeyonPollerStats {
        this.pruneFrames();
        const workers = [...this.workers.values()].filter(
            (worker) =>
                organizationId === undefined ||
                worker.organizationId === organizationId,
        );
        return {
            workers: workers.map((worker) => ({
                computerId: worker.computer.id,
                name: worker.computer.name,
                host: worker.computer.host,
                ...worker.stats(),
            })),
            retainedStates: [...this.retained.values()].filter(
                (retained) =>
                    organizationId === undefined ||
                    retained.organizationId === organizationId,
            ).length,
            inFlightRequests:
                organizationId === undefined
                    ? this.semaphore.active
                    : workers.filter((worker) => worker.inFlight).length,
            queuedRequests:
                organizationId === undefined
                     ? this.semaphore.queued + this.budget.queued
                     : workers.filter((worker) => worker.queued).length,
            cachedFrameBytes: workers.reduce((bytes, worker) => bytes + (worker.snapshot().image?.byteLength ?? 0), 0) +
                [...this.retained.values()].filter((retained) => organizationId === undefined || retained.organizationId === organizationId).reduce((bytes, retained) => bytes + (retained.state.image?.byteLength ?? 0), 0),
            budgets: this.budget.stats(organizationId),
        };
    }

    dispose() {
        for (const worker of this.workers.values()) worker.stop();
        this.workers.clear();
        this.retained.clear();
        this.listeners.clear();
        clearTimeout(this.cacheTimer);
        this.budget.dispose();
        this.budget = new VeyonPollBudget(this.config);
    }
}

// App-wide singleton used by the API routes. Workers start lazily on the
// first subscriber and stop when nobody is watching, so no bootstrap or
// shutdown wiring is needed.
export const veyonPoller = new VeyonScreenshotPoller();
