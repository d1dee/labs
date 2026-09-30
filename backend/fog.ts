import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { fogConfig } from '../db/schema';
import type { FogHost, ListFogHosts } from '../frontend/src/api';

// ===================== Types =====================

export interface FogCredentials {
    url: string;
    apiToken: string;
    userToken: string;
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

// ===================== Client =====================

/**
 * FOG API client bound to specific credentials. Token-auth based (no
 * sessions), so no auth caching is needed unlike Pi-hole.
 */
export class FogClient {
    private url: string;
    private apiToken: string;
    private userToken: string;

    constructor(creds: FogCredentials) {
        this.url = creds.url.replace(/\/$/, '');
        this.apiToken = creds.apiToken;
        this.userToken = creds.userToken;
    }

    get configured(): boolean {
        return Boolean(this.url && this.apiToken && this.userToken);
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
            'fog-api-token': this.apiToken,
            'fog-user-token': this.userToken,
            'Content-Type': 'application/json',
        };

        const opts: RequestInit = { method, headers };
        if (body && (method === 'POST' || method === 'PUT')) {
            opts.body = JSON.stringify(body);
        }

        return fetch(this.fogUrl(path), opts);
    }

    /**
     * Parse a FOG response body as JSON. FOG returns HTML pages (login or
     * error pages) when the URL is wrong or tokens are rejected, so surface a
     * human-readable message instead of a raw JSON SyntaxError.
     */
    private async readJson(res: Response): Promise<unknown> {
        const text = await res.text();
        try {
            return JSON.parse(text);
        } catch {
            throw new Error(nonJsonMessage(this.url, res.status, text));
        }
    }

    /** Safely extract an error message from a non-OK FOG response. */
    private async errorFrom(res: Response): Promise<string> {
        const text = await res.text().catch(() => '');
        try {
            const json = JSON.parse(text) as {
                error?: string;
                message?: string;
            };
            if (json.error || json.message) return json.error || json.message!;
        } catch {
            // Body is not JSON (e.g. an HTML error page); fall through.
        }
        return statusMessage(this.url, res.status, text);
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

    async listHosts(
        searchTerm?: string,
    ): Promise<FogResult<ListFogHosts>> {
        if (!this.configured) return unconfigured();
        try {
            const path = searchTerm?.trim()
                ? `/fog/host/search/${encodeURIComponent(searchTerm.trim())}`
                : '/fog/host';
            const res = await this.fogRequest('GET', path);
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            const data = (await this.readJson(res)) as ListFogHosts;
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
            const res = await this.fogRequest('POST', '/fog/host/create', hostData);
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
            const res = await this.fogRequest('PUT', `/fog/host/${id}/edit`, updates);
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
            const res = await this.fogRequest('DELETE', `/fog/host/${id}/delete`);
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
            const data = (await this.readJson(res)) as {
                count: number;
                images: FogImage[];
            };
            return { success: true, data };
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
            const data = (await this.readJson(res)) as {
                count: number;
                tasktypes: FogTaskType[];
            };
            return { success: true, data };
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
            const data = (await this.readJson(res)) as {
                count: number;
                snapins: FogSnapin[];
            };
            return { success: true, data };
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
            // Single Snapin task type is 13 - based on actual API response
            const res = await this.fogRequest('POST', `/fog/host/${hostId}/task`, {
                taskTypeID: 13, // Single Snapin task type
                snapinID: snapinId,
                ...options,
            });
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            // FOG returns null on successful task creation
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
                taskTypeID: taskTypeId,
                ...options,
            });
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            // FOG returns null on successful task creation
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
            const res = await this.fogRequest('GET', '/fog/task/active');
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            const data = (await this.readJson(res)) as {
                count: number;
                tasks: unknown[];
            };
            return { success: true, data };
        } catch (err) {
            return { success: false, error: errorMessage(err) };
        }
    }

    async cancelTask(taskId: number): Promise<FogResult<unknown>> {
        if (!this.configured) return unconfigured();
        try {
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
            const res = await this.fogRequest('PUT', `/fog/task/${taskId}/update`, {
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
            const res = await this.fogRequest('PUT', `/fog/task/${taskId}/update`, updates);
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
            const data = (await this.readJson(res)) as {
                count: number;
                multicastsessions: unknown[];
            };
            return { success: true, data };
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
        return `FOG rejected the API credentials (HTTP ${status}). Please verify the API token and user token in the FOG settings.`;
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
    if (err instanceof Error) {
        if (
            err instanceof SyntaxError ||
            /JSON Parse error|not valid JSON|Unexpected token/i.test(err.message)
        ) {
            return 'The FOG server returned an unexpected (non-JSON) response. Please verify the FOG server URL and tokens in the FOG settings.';
        }
        if (
            /fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i.test(
                `${err.message} ${err.cause instanceof Error ? err.cause.message : ''}`,
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
 * Resolve FOG credentials for an organization.
 */
export async function getFogCredentials(
    organizationId: string,
): Promise<FogCredentials | undefined> {
    const row = await db.query.fogConfig.findFirst({
        where: eq(fogConfig.organizationId, organizationId),
    });
    if (row && row.url && row.apiToken && row.userToken) {
        return {
            url: row.url,
            apiToken: row.apiToken,
            userToken: row.userToken,
        };
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

    if (!creds) return new FogClient({ url: '', apiToken: '', userToken: '' });

    const tokensKey = `${creds.apiToken}|${creds.userToken}`;
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
 * Test a FOG connection by calling the system info endpoint. Used by the
 * settings save flow to validate credentials before persisting.
 */
export async function testFogConnection(
    creds: FogCredentials,
): Promise<{ success: boolean; error?: string }> {
    const url = creds.url.replace(/\/$/, '');
    if (!url || !creds.apiToken || !creds.userToken) {
        return { success: false, error: 'URL, API token, and user token are required' };
    }
    try {
        const res = await fetch(`${url}/fog/system/info`, {
            method: 'GET',
            headers: {
                'fog-api-token': creds.apiToken,
                'fog-user-token': creds.userToken,
                'Content-Type': 'application/json',
            },
        });
        const text = await res.text();
        if (!res.ok) {
            try {
                const json = JSON.parse(text) as {
                    error?: string;
                    message?: string;
                };
                if (json.error || json.message) {
                    return { success: false, error: json.error || json.message };
                }
            } catch {
                // Body is not JSON (e.g. an HTML error page); fall through.
            }
            return { success: false, error: statusMessage(url, res.status, text) };
        }
        // A 200 with an HTML body means we reached a web server that is not
        // the FOG API (or an auth redirect); treat it as a failed test.
        try {
            JSON.parse(text);
        } catch {
            return { success: false, error: nonJsonMessage(url, res.status, text) };
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: errorMessage(err) };
    }
}
