import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { fogConfig } from '../db/schema';
import type { FogHost, FogInventory, ListFogHosts } from '../frontend/src/api';
import { errorProperty, getLogger } from './logger';

const fogLogger = getLogger(['labs', 'fog']);
type RequestContext = { method: string; path: string };

// Already logged at the transport/parser boundary; method catches only normalize.
class LoggedFogError extends Error {}

function loggedError(error: unknown, context: Record<string, unknown>): LoggedFogError {
    fogLogger.error('FOG operation failed: {error}', { ...context, error: errorProperty(error) });
    return new LoggedFogError(error instanceof Error ? error.message : String(error), { cause: error });
}

async function responseText(res: Response, context?: RequestContext): Promise<string> {
    try {
        return await res.text();
    } catch (error) {
        throw loggedError(error, { ...context, status: res.status });
    }
}

function responseError(url: string, res: Response, text: string, context?: RequestContext): string {
    let error: unknown;
    let message: string | undefined;
    try {
        const json = JSON.parse(text) as { error?: string; message?: string } | null;
        message = json?.error || json?.message;
    } catch (caught) {
        error = caught;
    }
    fogLogger.error('FOG upstream request failed (HTTP {status}): {response}', {
        ...context,
        status: res.status,
        response: text,
        ...(error === undefined ? {} : { error: errorProperty(error) }),
    });
    return message || statusMessage(url, res.status, text);
}

function responseJson(url: string, res: Response, text: string, context?: RequestContext): unknown {
    try {
        return JSON.parse(text);
    } catch (error) {
        const logged = loggedError(error, { ...context, status: res.status, response: text });
        logged.message = nonJsonMessage(url, res.status, text);
        throw logged;
    }
}

// ===================== Types =====================

export interface FogCredentials {
    url: string;
    apiToken: string;
    /**
     * Per-user token. Required for FOG <= 1.5 header auth; unused when
     * apiToken is a FOG 1.6 bearer token (fog_ prefixed).
     */
    userToken?: string;
}

export interface FogImage {
    id: number;
    name: string;
    description?: string;
    path?: string;
    size?: string;
    [key: string]: unknown;
}

export interface FogTaskType {
    id: number;
    name: string;
    description?: string;
    icon?: string;
    type?: string;
    [key: string]: unknown;
}

export interface FogSnapin {
    id: number;
    name: string;
    description?: string;
    file?: string;
    args?: string;
    [key: string]: unknown;
}

export interface FogTaskResult {
    id?: number;
    name?: string;
    message?: string;
    [key: string]: unknown;
}

type FogResult<T> = {
    success: boolean;
    data?: T;
    error?: string;
};

/**
 * FOG 1.6 paged list envelope (DataTables style). FOG <= 1.5 returned
 * `{ count, <class>: [...] }` instead; both shapes are handled by
 * normalizeList().
 */
interface FogPageEnvelope {
    data?: unknown[];
    recordsTotal?: number;
    recordsFiltered?: number;
    recordsReturned?: number;
    truncated?: boolean;
    nextUrl?: string | null;
    count?: number;
    [key: string]: unknown;
}

// ===================== Auth =====================

/**
 * FOG 1.6 API tokens are issued from the user's API tab and carry a `fog_`
 * prefix; they are sent as `Authorization: Bearer <token>` and need no
 * user token. Older setups use the server-wide `fog-api-token` header plus
 * a `fog-user-token` caller identity.
 */
export function isBearerToken(apiToken: string): boolean {
    return apiToken.trimStart().startsWith('fog_');
}

/** True when the credentials carry everything their auth mode requires. */
export function credentialsComplete(creds?: FogCredentials | null): boolean {
    if (!creds?.url || !creds.apiToken) return false;
    return isBearerToken(creds.apiToken) || Boolean(creds.userToken);
}

/** Build the auth headers for a set of FOG credentials. */
function authHeaders(creds: FogCredentials): Record<string, string> {
    if (isBearerToken(creds.apiToken)) {
        return { Authorization: `Bearer ${creds.apiToken.trim()}` };
    }
    return {
        'fog-api-token': creds.apiToken,
        'fog-user-token': creds.userToken ?? '',
    };
}

// ===================== List normalization =====================

/**
 * Normalize a FOG list response into `{ count, items }`. Accepts both the
 * FOG 1.6 paged envelope (`data` + `recordsTotal`) and the <= 1.5 shape
 * (`count` + class-named array, e.g. `hosts`).
 */
function normalizeList<T>(raw: unknown, legacyKey: string): { count: number; items: T[] } {
    const envelope = (raw ?? {}) as FogPageEnvelope & Record<string, unknown>;
    let items: T[];
    if (Array.isArray(envelope.data)) {
        items = envelope.data as T[];
    } else if (Array.isArray(envelope[legacyKey])) {
        items = envelope[legacyKey] as T[];
    } else {
        throw new Error('FOG returned an invalid list response');
    }
    const count =
        typeof envelope.recordsTotal === 'number'
            ? envelope.recordsTotal
            : typeof envelope.count === 'number'
              ? envelope.count
              : items.length;
    return { count, items };
}

/**
 * FOG 1.6 list rows only expose `primac`; the full `macs` array is limited
 * to single-host GETs. Synthesize `macs` from `primac` so table/filter
 * consumers keep working without an N+1 fetch per host.
 */
function withSynthesizedMacs<T>(hosts: T[]): T[] {
    return hosts.map((host) => {
        const h = host as Record<string, unknown>;
        if (!Array.isArray(h.macs) && typeof h.primac === 'string' && h.primac) {
            return { ...h, macs: [h.primac] } as T;
        }
        return host;
    });
}

// ===================== Client =====================

/**
 * FOG API client bound to specific credentials. Token-auth based (no
 * sessions), so no auth caching is needed unlike Pi-hole. Routes follow the
 * FOG 1.6 OpenAPI document; legacy alias routes (/create, /edit, /delete,
 * /active, /update) are avoided.
 */
export class FogClient {
    private responseContexts = new WeakMap<Response, RequestContext>();
    private url: string;
    private apiToken: string;
    private userToken: string;

    constructor(creds: FogCredentials) {
        this.url = creds.url.replace(/\/$/, '');
        this.apiToken = creds.apiToken;
        this.userToken = creds.userToken ?? '';
    }

    get configured(): boolean {
        return credentialsComplete({
            url: this.url,
            apiToken: this.apiToken,
            userToken: this.userToken,
        });
    }

    private fogUrl(path: string): string {
        return `${this.url}${path}`;
    }

    private async fogRequest(
        method: 'GET' | 'POST' | 'PUT' | 'DELETE',
        path: string,
        body?: Record<string, unknown>,
    ): Promise<Response> {
        if (!this.configured) {
            throw new Error('FOG not configured');
        }

        const headers: Record<string, string> = {
            ...authHeaders({
                url: this.url,
                apiToken: this.apiToken,
                userToken: this.userToken,
            }),
            'Content-Type': 'application/json',
        };

        try {
            const opts: RequestInit = { method, headers, redirect: 'error', signal: AbortSignal.timeout(15_000) };
            if (body && (method === 'POST' || method === 'PUT')) {
                opts.body = JSON.stringify(body);
            }
            const res = await fetch(this.fogUrl(path), opts);
            this.responseContexts.set(res, { method, path });
            return res;
        } catch (error) {
            throw loggedError(error, { method, path });
        }
    }

    /**
     * Parse a FOG response body as JSON. FOG returns HTML pages (login or
     * error pages) when the URL is wrong or tokens are rejected, so surface a
     * human-readable message instead of a raw JSON SyntaxError. FOG 1.6
     * answers some mutations (task create, cancel, delete) with an empty
     * body or the JSON string ""; both normalize to null.
     */
    private async readJson(res: Response): Promise<unknown> {
        const context = this.responseContexts.get(res);
        const text = await responseText(res, context);
        if (!text.trim()) return null;
        const parsed = responseJson(this.url, res, text, context);
        return typeof parsed === 'string' && !parsed.trim() ? null : parsed;
    }

    /** Safely extract an error message from a non-OK FOG response. */
    private async errorFrom(res: Response): Promise<string> {
        const context = this.responseContexts.get(res);
        let text: string;
        try {
            text = await responseText(res, context);
        } catch {
            // responseText logged the original read failure and HTTP context.
            return statusMessage(this.url, res.status, '');
        }
        return responseError(this.url, res, text, context);
    }

    // ---------- System / connection ----------

    async getSystemInfo(): Promise<FogResult<unknown>> {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.fogRequest('GET', '/fog/system/info');
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            const data = await this.readJson(res);
            return { success: true, data };
        } catch (err) {
            return { success: false, error: errorMessage(err) };
        }
    }

    // ---------- Hosts ----------

    private async completeList<T>(path: string, key: string): Promise<T[]> {
        const base = new URL(this.fogUrl(path));
        let next = base;
        let expected: number | undefined;
        const visited = new Set<string>();
        const items: T[] = [];
        for (let page = 0; page < 1000; page++) {
            if (visited.has(next.href)) throw new Error('FOG pagination repeated a page');
            visited.add(next.href);
            const requestPath = `${path}${next.search}`;
            const res = await this.fogRequest('GET', requestPath);
            if (!res.ok) throw new LoggedFogError(await this.errorFrom(res));
            const raw = await this.readJson(res) as FogPageEnvelope;
            const result = normalizeList<T>(raw, key);
            for (const field of ['count', 'recordsTotal', 'recordsFiltered', 'recordsReturned'] as const) {
                if (raw[field] !== undefined && (!Number.isSafeInteger(raw[field]) || Number(raw[field]) < 0)) {
                    throw new Error('FOG returned invalid pagination counts');
                }
            }
            const total = raw.recordsFiltered ?? raw.recordsTotal ?? raw.count;
            if (path === '/fog/host' && raw.recordsTotal !== undefined && raw.recordsFiltered !== undefined && raw.recordsFiltered !== raw.recordsTotal) {
                throw new Error('FOG returned a filtered inventory for an authoritative host list');
            }
            if (total !== undefined) {
                if (expected !== undefined && expected !== total) throw new Error('FOG inventory changed during pagination; retry required');
                expected = total;
            }
            if (raw.recordsReturned !== undefined && raw.recordsReturned !== result.items.length) throw new Error('FOG returned an incomplete page');
            items.push(...result.items);
            if (items.length > 100_000 || (expected !== undefined && items.length > expected)) throw new Error('FOG returned inconsistent pagination counts');
            if (raw.nextUrl !== undefined && raw.nextUrl !== null && typeof raw.nextUrl !== 'string') throw new Error('FOG returned an invalid next page URL');
            if (raw.truncated !== undefined && typeof raw.truncated !== 'boolean') throw new Error('FOG returned an invalid pagination flag');
            if (raw.nextUrl) {
                const candidate = new URL(raw.nextUrl, next);
                if (candidate.origin !== base.origin || candidate.pathname !== base.pathname || candidate.username || candidate.password || candidate.hash) {
                    throw new Error('FOG returned an unsafe next page URL');
                }
                if (!result.items.length) throw new Error('FOG pagination made no progress');
                next = candidate;
            } else if (expected !== undefined && items.length < expected) {
                if (!result.items.length) throw new Error('FOG returned an incomplete host inventory');
                next = new URL(base);
                next.searchParams.set('start', String(items.length));
                next.searchParams.set('length', String(result.items.length));
            } else {
                if (raw.truncated === true) throw new Error('FOG returned a truncated inventory without a continuation');
                return items;
            }
        }
        throw new Error('FOG inventory exceeds the pagination limit');
    }

    async listHosts(
        searchTerm?: string,
        includeInventory = false,
    ): Promise<FogResult<ListFogHosts>> {
        if (!this.configured) return unconfigured();
        try {
            const path = searchTerm?.trim()
                ? `/fog/host/search/${encodeURIComponent(searchTerm.trim())}`
                : '/fog/host';
            const rows = await this.completeList<FogHost>(path, 'hosts');
            const ids = new Set<number>();
            const items = rows.map((host) => {
                if (!host || typeof host !== 'object' || !/^[1-9]\d*$/.test(String(host.id)) || !Number.isSafeInteger(Number(host.id)) || typeof host.name !== 'string' || !host.name.trim()) {
                    throw new Error('FOG returned an invalid host identity');
                }
                const id = Number(host.id);
                if (ids.has(id)) throw new Error('FOG returned duplicate host identities across pages');
                ids.add(id);
                if (host.ip != null && typeof host.ip !== 'string') throw new Error('FOG returned an invalid host address');
                if (host.primac != null && typeof host.primac !== 'string') throw new Error('FOG returned an invalid host MAC');
                if (host.macs != null && (!Array.isArray(host.macs) || host.macs.some((mac) => typeof mac !== 'string'))) throw new Error('FOG returned invalid host MACs');
                return { ...host, id, name: host.name.trim() };
            });
            const data: ListFogHosts = { count: items.length, hosts: withSynthesizedMacs(items) };
            // Paged host lists can omit related inventory. Load it once for the
            // management view, not once per host or for identity-only consumers.
            if (includeInventory && items.some((host) => host.inventory == null)) {
                try {
                    const inventory = await this.completeList<FogInventory>('/fog/inventory', 'inventorys');
                    if (inventory.some((row) => !row || typeof row !== 'object' || !Number.isSafeInteger(Number(row.hostID)))) throw new Error('FOG returned invalid inventory rows');
                    const byHostId = new Map(inventory.map((inventory) => [String(inventory.hostID), inventory]));
                    data.hosts = data.hosts.map((host) => host.inventory != null ? host : {
                        ...host, inventory: byHostId.get(String(host.id)),
                    });
                } catch (err) {
                    data.inventoryWarning = errorMessage(err);
                }
            }
            return { success: true, data };
        } catch (err) {
            return { success: false, error: errorMessage(err) };
        }
    }

    async getHost(id: number): Promise<FogResult<FogHost>> {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.fogRequest('GET', `/fog/host/${id}`);
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            const data = (await this.readJson(res)) as FogHost;
            return { success: true, data };
        } catch (err) {
            return { success: false, error: errorMessage(err) };
        }
    }

    async createHost(
        hostData: Record<string, unknown>,
    ): Promise<FogResult<FogHost>> {
        if (!this.configured) return unconfigured();
        try {
            // FOG 1.6 canonical create route (legacy alias: /fog/host/create)
            const res = await this.fogRequest('POST', '/fog/host', hostData);
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            const data = (await this.readJson(res)) as FogHost;
            return { success: true, data };
        } catch (err) {
            return { success: false, error: errorMessage(err) };
        }
    }

    async updateHost(
        id: number,
        updates: Record<string, unknown>,
    ): Promise<FogResult<FogHost>> {
        if (!this.configured) return unconfigured();
        try {
            // FOG 1.6 canonical update route (legacy alias: /fog/host/{id}/edit)
            const res = await this.fogRequest('PUT', `/fog/host/${id}`, updates);
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            const data = (await this.readJson(res)) as FogHost;
            return { success: true, data };
        } catch (err) {
            return { success: false, error: errorMessage(err) };
        }
    }

    async deleteHost(id: number): Promise<FogResult<unknown>> {
        if (!this.configured) return unconfigured();
        try {
            // FOG 1.6 canonical delete route (legacy alias: /fog/host/{id}/delete).
            // A 409 means another record still references this host.
            const res = await this.fogRequest('DELETE', `/fog/host/${id}`);
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            return { success: true };
        } catch (err) {
            return { success: false, error: errorMessage(err) };
        }
    }

    // ---------- Images / Snapins / Task types ----------

    async listImages(): Promise<
        FogResult<{ count: number; images: FogImage[] }>
    > {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.fogRequest('GET', '/fog/image');
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            const { count, items } = normalizeList<FogImage>(
                await this.readJson(res),
                'images',
            );
            return { success: true, data: { count, images: items } };
        } catch (err) {
            return { success: false, error: errorMessage(err) };
        }
    }

    async listTaskTypes(): Promise<
        FogResult<{ count: number; tasktypes: FogTaskType[] }>
    > {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.fogRequest('GET', '/fog/tasktype');
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            const { count, items } = normalizeList<FogTaskType>(
                await this.readJson(res),
                'tasktypes',
            );
            return { success: true, data: { count, tasktypes: items } };
        } catch (err) {
            return { success: false, error: errorMessage(err) };
        }
    }

    async listSnapins(): Promise<
        FogResult<{ count: number; snapins: FogSnapin[] }>
    > {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.fogRequest('GET', '/fog/snapin');
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            const { count, items } = normalizeList<FogSnapin>(
                await this.readJson(res),
                'snapins',
            );
            return { success: true, data: { count, snapins: items } };
        } catch (err) {
            return { success: false, error: errorMessage(err) };
        }
    }

    // ---------- Tasks ----------

    async getTask(
        taskId: number,
    ): Promise<FogResult<Record<string, unknown>>> {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.fogRequest('GET', `/fog/task/${taskId}`);
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            const data = (await this.readJson(res)) as Record<string, unknown>;
            return { success: true, data };
        } catch (err) {
            return { success: false, error: errorMessage(err) };
        }
    }

    async createSnapinTask(
        hostId: number,
        snapinId: number,
        options?: Record<string, unknown>,
    ): Promise<FogResult<FogTaskResult>> {
        if (!this.configured) return unconfigured();
        try {
            // Single Snapin task type is 13. FOG 1.6 TaskRequest selects the
            // snapin with deploySnapins; snapinID is kept for older servers.
            const { snapinID: _ignored, ...rest } = options ?? {};
            const res = await this.fogRequest('POST', `/fog/host/${hostId}/task`, {
                taskTypeID: 13, // Single Snapin task type
                snapinID: snapinId,
                deploySnapins: snapinId,
                ...rest,
            });
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            // FOG 1.6 answers queued task creation with an empty body (older
            // versions returned null); normalize both to {}.
            const data = (await this.readJson(res)) as FogTaskResult | null;
            return { success: true, data: data ?? {} };
        } catch (err) {
            return { success: false, error: errorMessage(err) };
        }
    }

    async createTask(
        hostId: number,
        taskTypeId: number,
        options?: Record<string, unknown>,
    ): Promise<FogResult<FogTaskResult>> {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.fogRequest('POST', `/fog/host/${hostId}/task`, {
                ...options,
                taskTypeID: taskTypeId,
            });
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            // FOG 1.6 answers queued task creation with an empty body (older
            // versions returned null); normalize both to {}.
            const data = (await this.readJson(res)) as FogTaskResult | null;
            return { success: true, data: data ?? {} };
        } catch (err) {
            return { success: false, error: errorMessage(err) };
        }
    }

    async listActiveTasks(): Promise<
        FogResult<{ count: number; tasks: unknown[] }>
    > {
        if (!this.configured) return unconfigured();
        try {
            // FOG 1.6 canonical route (legacy alias: /fog/task/active)
            const res = await this.fogRequest('GET', '/fog/task/current');
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            const { count, items } = normalizeList<unknown>(
                await this.readJson(res),
                'tasks',
            );
            return { success: true, data: { count, tasks: items } };
        } catch (err) {
            return { success: false, error: errorMessage(err) };
        }
    }

    async cancelTask(taskId: number): Promise<FogResult<unknown>> {
        if (!this.configured) return unconfigured();
        try {
            // A 409 means the task already finished (Complete/Canceled/Failed).
            const res = await this.fogRequest('DELETE', `/fog/task/${taskId}/cancel`);
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            return { success: true };
        } catch (err) {
            return { success: false, error: errorMessage(err) };
        }
    }

    async forceTask(taskId: number): Promise<FogResult<unknown>> {
        if (!this.configured) return unconfigured();
        try {
            // FOG 1.6 canonical update route (legacy alias: /fog/task/{id}/update)
            const res = await this.fogRequest('PUT', `/fog/task/${taskId}`, {
                isForced: 1,
            });
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            return { success: true };
        } catch (err) {
            return { success: false, error: errorMessage(err) };
        }
    }

    async updateTask(
        taskId: number,
        updates: Record<string, unknown>,
    ): Promise<FogResult<Record<string, unknown>>> {
        if (!this.configured) return unconfigured();
        try {
            // FOG 1.6 canonical update route (legacy alias: /fog/task/{id}/update)
            const res = await this.fogRequest('PUT', `/fog/task/${taskId}`, updates);
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            const data = (await this.readJson(res)) as Record<string, unknown> | null;
            return { success: true, data: data ?? {} };
        } catch (err) {
            return { success: false, error: errorMessage(err) };
        }
    }

    async restartTask(
        taskId: number,
        hostId?: number,
        taskTypeId?: number,
    ): Promise<FogResult<unknown>> {
        if (!this.configured) return unconfigured();
        try {
            let actualHostId = hostId;
            let actualTaskTypeId = taskTypeId;
            if (!actualHostId || !actualTaskTypeId) {
                const taskResult = await this.getTask(taskId);
                if (!taskResult.success || !taskResult.data) {
                    return { success: false, error: taskResult.error || 'Failed to get task details' };
                }
                const task = taskResult.data as { hostID?: number; typeID?: number };
                actualHostId = task.hostID;
                actualTaskTypeId = task.typeID;
            }
            if (!actualHostId || !actualTaskTypeId) {
                return { success: false, error: 'Missing host ID or task type ID' };
            }
            // 1. Cancel existing task
            const cancelResult = await this.cancelTask(taskId);
            if (!cancelResult.success) {
                return { success: false, error: cancelResult.error || 'Failed to cancel task' };
            }
            // 2. Create new task on same host with same type
            const createResult = await this.createTask(actualHostId, actualTaskTypeId);
            if (!createResult.success) {
                return { success: false, error: createResult.error || 'Failed to create new task' };
            }
            // 3. Find and force the newly created task
            const activeResult = await this.listActiveTasks();
            if (!activeResult.success || !activeResult.data) {
                return { success: false, error: activeResult.error || 'Failed to list active tasks' };
            }
            const tasks = activeResult.data.tasks as Array<{
                id: number;
                hostID?: number;
                typeID?: number;
                stateID?: number;
            }>;
            const newTask = tasks
                .filter(
                    (t) =>
                        t.hostID === actualHostId &&
                        t.typeID === actualTaskTypeId &&
                        (t.stateID === 1 || t.stateID === 2),
                )
                .sort((a, b) => b.id - a.id)[0];
            if (newTask) {
                const forceResult = await this.forceTask(newTask.id);
                if (!forceResult.success) {
                    return { success: false, error: forceResult.error || 'Failed to force new task' };
                }
            }
            return { success: true };
        } catch (err) {
            return { success: false, error: errorMessage(err) };
        }
    }

    async listActiveMulticastSessions(): Promise<
        FogResult<{ count: number; multicastsessions: unknown[] }>
    > {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.fogRequest('GET', '/fog/multicastsession/current');
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            const { count, items } = normalizeList<unknown>(
                await this.readJson(res),
                'multicastsessions',
            );
            return { success: true, data: { count, multicastsessions: items } };
        } catch (err) {
            return { success: false, error: errorMessage(err) };
        }
    }
}

// ===================== Helpers =====================

function unconfigured<T>(): FogResult<T> {
    return { success: false, error: 'FOG not configured' };
}

/** True when a response body looks like HTML/XML rather than JSON. */
function looksLikeHtml(body: string): boolean {
    return body.trimStart().startsWith('<');
}

/** Friendly message for a FOG response that is not valid JSON. */
function nonJsonMessage(url: string, status: number, body: string): string {
    if (looksLikeHtml(body)) {
        return `FOG server at ${url} returned an HTML page instead of JSON (HTTP ${status}). This usually means the FOG URL is incorrect or the API/user tokens were rejected. Please check the FOG settings.`;
    }
    return `FOG server at ${url} returned an invalid response (HTTP ${status}). Please verify the FOG server URL and tokens in the FOG settings.`;
}

/** Friendly message for a non-OK FOG response without a usable JSON error. */
function statusMessage(url: string, status: number, body: string): string {
    if (status === 401 || status === 403) {
        return `FOG rejected the API credentials (HTTP ${status}). Please verify the API token (and user token for legacy auth) in the FOG settings. FOG 1.6 bearer tokens start with "fog_" and need no user token.`;
    }
    if (status === 404) {
        return `FOG endpoint not found at ${url} (HTTP 404). Please verify the FOG server URL in the FOG settings.`;
    }
    if (looksLikeHtml(body)) {
        return nonJsonMessage(url, status, body);
    }
    return `FOG request failed (HTTP ${status}).`;
}

/** Convert an unknown thrown value into a user-presentable message. */
function errorMessage(err: unknown): string {
    if (!(err instanceof LoggedFogError)) {
        fogLogger.error('FOG operation failed: {error}', { error: errorProperty(err) });
    }
    if (err instanceof Error) {
        const original = err instanceof LoggedFogError && err.cause instanceof Error ? err.cause : err;
        if (
            err instanceof SyntaxError ||
            /JSON Parse error|not valid JSON|Unexpected token/i.test(err.message)
        ) {
            return 'The FOG server returned an unexpected (non-JSON) response. Please verify the FOG server URL and tokens in the FOG settings.';
        }
        if (
            /fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i.test(
                `${err.message} ${original.cause instanceof Error ? original.cause.message : ''}`,
            )
        ) {
            return 'Could not reach the FOG server. Please verify the FOG server URL in the FOG settings and that the server is online.';
        }
        return err.message;
    }
    return String(err);
}

// ===================== Credential resolution =====================

/**
 * Resolve FOG credentials for an organization. A FOG 1.6 bearer token
 * (fog_ prefixed) only needs the URL + apiToken; legacy header auth also
 * requires the per-user token.
 */
export async function getFogCredentials(
    organizationId: string,
): Promise<FogCredentials | undefined> {
    const row = await db.query.fogConfig.findFirst({
        where: eq(fogConfig.organizationId, organizationId),
    });
    if (row && row.url && row.apiToken) {
        const creds: FogCredentials = {
            url: row.url,
            apiToken: row.apiToken,
            userToken: row.userToken || undefined,
        };
        if (credentialsComplete(creds)) return creds;
    }
    return undefined;
}

// Cache clients by URL so connections are reused across requests. The cached
// tokens are compared to detect credential rotation.
const clientCache = new Map<
    string,
    { tokens: string; client: FogClient }
>();

/**
 * Get a (cached) FOG client bound to the resolved credentials for the
 * given organization. Returns an unconfigured client when no credentials
 * are available; its methods will short-circuit with an error.
 */
export async function getFogClient(organizationId: string): Promise<FogClient> {
    const creds = await getFogCredentials(organizationId);

    if (!creds) return new FogClient({ url: '', apiToken: '' });

    const tokensKey = `${creds.apiToken}|${creds.userToken ?? ''}`;
    const cached = clientCache.get(creds.url);
    if (cached && cached.tokens === tokensKey) {
        return cached.client;
    }

    const client = new FogClient(creds);
    clientCache.set(creds.url, { tokens: tokensKey, client });
    return client;
}

export async function isFogConfigured(
    organizationId: string,
): Promise<boolean> {
    const creds = await getFogCredentials(organizationId);
    return Boolean(creds);
}

/**
 * Read the stored per-organization FOG configuration (raw, unmasked).
 * Returns null when no DB row exists.
 */
export async function getFogConfigForOrg(organizationId: string) {
    return db.query.fogConfig.findFirst({
        where: eq(fogConfig.organizationId, organizationId),
    });
}

/**
 * Test a FOG connection by calling an authenticated endpoint. FOG 1.6
 * serves /fog/system/info without authentication, so it cannot validate
 * tokens; a minimal paged host list request is used instead. Used by the
 * settings save flow to validate credentials before persisting.
 */
export async function testFogConnection(
    creds: FogCredentials,
): Promise<{ success: boolean; error?: string }> {
    const url = creds.url.replace(/\/$/, '');
    const normalized: FogCredentials = {
        url,
        apiToken: creds.apiToken,
        userToken: creds.userToken,
    };
    if (!url || !creds.apiToken) {
        return { success: false, error: 'URL and API token are required' };
    }
    if (!isBearerToken(creds.apiToken) && !creds.userToken) {
        return {
            success: false,
            error:
                'A user token is required for legacy (non-bearer) API tokens. FOG 1.6 bearer tokens start with "fog_" and need no user token.',
        };
    }
    try {
        const res = await fetch(`${url}/fog/host?start=0&length=1`, {
            method: 'GET',
            headers: {
                ...authHeaders(normalized),
                'Content-Type': 'application/json',
            },
        });
        const context = { method: 'GET', path: '/fog/host?start=0&length=1' };
        const text = await responseText(res, context);
        if (!res.ok) {
            return { success: false, error: responseError(url, res, text, context) };
        }
        // A 200 with an HTML body means we reached a web server that is not
        // the FOG API (or an auth redirect); treat it as a failed test.
        responseJson(url, res, text, context);
        return { success: true };
    } catch (err) {
        if (!(err instanceof LoggedFogError)) {
            err = loggedError(err, { method: 'GET', path: '/fog/host?start=0&length=1' });
        }
        return { success: false, error: errorMessage(err) };
    }
}
