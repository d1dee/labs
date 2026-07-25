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

    /** Safely extract an error message from a non-OK FOG response. */
    private async errorFrom(res: Response): Promise<string> {
        try {
            const json = (await res.json()) as {
                error?: string;
                message?: string;
            };
            return json.error || json.message || `HTTP ${res.status}`;
        } catch {
            return `HTTP ${res.status}`;
        }
    }

    // ---------- System / connection ----------

    async getSystemInfo(): Promise<FogResult<unknown>> {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.fogRequest('GET', '/fog/system/info');
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            const data = await res.json();
            return { success: true, data };
        } catch (err) {
            return { success: false, error: String(err) };
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
            const data = (await res.json()) as ListFogHosts;
            return { success: true, data };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    async getHost(id: number): Promise<FogResult<FogHost>> {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.fogRequest('GET', `/fog/host/${id}`);
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            const data = (await res.json()) as FogHost;
            return { success: true, data };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    async createHost(
        hostData: Record<string, unknown>,
    ): Promise<FogResult<FogHost>> {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.fogRequest('POST', '/fog/host/create', hostData);
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            const data = (await res.json()) as FogHost;
            return { success: true, data };
        } catch (err) {
            return { success: false, error: String(err) };
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
            const data = (await res.json()) as FogHost;
            return { success: true, data };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    async deleteHost(id: number): Promise<FogResult<unknown>> {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.fogRequest('DELETE', `/fog/host/${id}/delete`);
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            return { success: true };
        } catch (err) {
            return { success: false, error: String(err) };
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
            const data = (await res.json()) as {
                count: number;
                images: FogImage[];
            };
            return { success: true, data };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    async listTaskTypes(): Promise<
        FogResult<{ count: number; tasktypes: FogTaskType[] }>
    > {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.fogRequest('GET', '/fog/tasktype');
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            const data = (await res.json()) as {
                count: number;
                tasktypes: FogTaskType[];
            };
            return { success: true, data };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    async listSnapins(): Promise<
        FogResult<{ count: number; snapins: FogSnapin[] }>
    > {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.fogRequest('GET', '/fog/snapin');
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            const data = (await res.json()) as {
                count: number;
                snapins: FogSnapin[];
            };
            return { success: true, data };
        } catch (err) {
            return { success: false, error: String(err) };
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
            const data = (await res.json()) as Record<string, unknown>;
            return { success: true, data };
        } catch (err) {
            return { success: false, error: String(err) };
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
            const data = (await res.json()) as FogTaskResult | null;
            return { success: true, data: data ?? {} };
        } catch (err) {
            return { success: false, error: String(err) };
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
            const data = (await res.json()) as FogTaskResult | null;
            return { success: true, data: data ?? {} };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    async listActiveTasks(): Promise<
        FogResult<{ count: number; tasks: unknown[] }>
    > {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.fogRequest('GET', '/fog/task/active');
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            const data = (await res.json()) as {
                count: number;
                tasks: unknown[];
            };
            return { success: true, data };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    async cancelTask(taskId: number): Promise<FogResult<unknown>> {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.fogRequest('DELETE', `/fog/task/${taskId}/cancel`);
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            return { success: true };
        } catch (err) {
            return { success: false, error: String(err) };
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
            return { success: false, error: String(err) };
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
            const data = (await res.json()) as Record<string, unknown> | null;
            return { success: true, data: data ?? {} };
        } catch (err) {
            return { success: false, error: String(err) };
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
            return { success: false, error: String(err) };
        }
    }

    async listActiveMulticastSessions(): Promise<
        FogResult<{ count: number; multicastsessions: unknown[] }>
    > {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.fogRequest('GET', '/fog/multicastsession/current');
            if (!res.ok) return { success: false, error: await this.errorFrom(res) };
            const data = (await res.json()) as {
                count: number;
                multicastsessions: unknown[];
            };
            return { success: true, data };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }
}

// ===================== Helpers =====================

function unconfigured<T>(): FogResult<T> {
    return { success: false, error: 'FOG not configured' };
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
        if (!res.ok) {
            const json = (await res.json()) as {
                error?: string;
                message?: string;
            };
            return {
                success: false,
                error: json.error || json.message || `HTTP ${res.status}`,
            };
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}
