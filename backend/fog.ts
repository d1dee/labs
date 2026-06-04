import type { FogHost, ListFogHosts } from "../frontend/src/api";

const FOG_URL = process.env.FOG_URL?.replace(/\/$/, '') || '';
const FOG_API_TOKEN = process.env.FOG_API_TOKEN || '';
const FOG_USER_TOKEN = process.env.FOG_USER_TOKEN || '';

function fogUrl(path: string): string {
    return `${FOG_URL}${path}`;
}

export function isFogConfigured(): boolean {
    return Boolean(FOG_URL && FOG_API_TOKEN && FOG_USER_TOKEN);
}

async function fogRequest(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
): Promise<Response> {
    if (!isFogConfigured()) {
        throw new Error('FOG not configured');
    }

    const headers: Record<string, string> = {
        'fog-api-token': FOG_API_TOKEN,
        'fog-user-token': FOG_USER_TOKEN,
        'Content-Type': 'application/json',
    };

    const opts: RequestInit = { method, headers };
    if (body && (method === 'POST' || method === 'PUT')) {
        opts.body = JSON.stringify(body);
    }

    return fetch(fogUrl(path), opts);
}

// ===================== Types =====================

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

// ===================== API Functions =====================

export async function getFogSystemInfo(): Promise<{
    success: boolean;
    data?: unknown;
    error?: string;
}> {
    if (!isFogConfigured()) {
        return { success: false, error: 'FOG not configured' };
    }
    try {
        const res = await fogRequest('GET', '/fog/system/info');
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
        const data = await res.json();
        return { success: true, data };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}

export async function listFogHosts(
    searchTerm?: string,
): Promise<{ success: boolean; data?: ListFogHosts; error?: string }> {
    if (!isFogConfigured()) {
        return { success: false, error: 'FOG not configured' };
    }
    try {
        const path = searchTerm?.trim()
            ? `/fog/host/search/${encodeURIComponent(searchTerm.trim())}`
            : '/fog/host';
        const res = await fogRequest('GET', path);
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
        const data = (await res.json()) as ListFogHosts;
        return { success: true, data };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}

export async function getFogHost(
    id: number,
): Promise<{ success: boolean; data?: FogHost; error?: string }> {
    if (!isFogConfigured()) {
        return { success: false, error: 'FOG not configured' };
    }
    try {
        const res = await fogRequest('GET', `/fog/host/${id}`);
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
        const data = (await res.json()) as FogHost;
        return { success: true, data };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}

export async function createFogHost(
    hostData: Record<string, unknown>,
): Promise<{ success: boolean; data?: FogHost; error?: string }> {
    if (!isFogConfigured()) {
        return { success: false, error: 'FOG not configured' };
    }
    try {
        const res = await fogRequest('POST', '/fog/host/create', hostData);
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
        const data = (await res.json()) as FogHost;
        return { success: true, data };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}

export async function updateFogHost(
    id: number,
    updates: Record<string, unknown>,
): Promise<{ success: boolean; data?: FogHost; error?: string }> {
    if (!isFogConfigured()) {
        return { success: false, error: 'FOG not configured' };
    }
    try {
        const res = await fogRequest('PUT', `/fog/host/${id}/edit`, updates);
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
        const data = (await res.json()) as FogHost;
        return { success: true, data };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}

export async function deleteFogHost(
    id: number,
): Promise<{ success: boolean; error?: string }> {
    if (!isFogConfigured()) {
        return { success: false, error: 'FOG not configured' };
    }
    try {
        const res = await fogRequest('DELETE', `/fog/host/${id}/delete`);
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

export async function listFogImages(): Promise<{
    success: boolean;
    data?: { count: number; images: FogImage[] };
    error?: string;
}> {
    if (!isFogConfigured()) {
        return { success: false, error: 'FOG not configured' };
    }
    try {
        const res = await fogRequest('GET', '/fog/image');
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
        const data = (await res.json()) as {
            count: number;
            images: FogImage[];
        };
        return { success: true, data };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}

export async function listFogTaskTypes(): Promise<{
    success: boolean;
    data?: { count: number; tasktypes: FogTaskType[] };
    error?: string;
}> {
    if (!isFogConfigured()) {
        return { success: false, error: 'FOG not configured' };
    }
    try {
        const res = await fogRequest('GET', '/fog/tasktype');
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
        const data = (await res.json()) as {
            count: number;
            tasktypes: FogTaskType[];
        };
        return { success: true, data };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}

export async function listFogSnapins(): Promise<{
    success: boolean;
    data?: { count: number; snapins: FogSnapin[] };
    error?: string;
}> {
    if (!isFogConfigured()) {
        return { success: false, error: 'FOG not configured' };
    }
    try {
        const res = await fogRequest('GET', '/fog/snapin');
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
        const data = (await res.json()) as {
            count: number;
            snapins: FogSnapin[];
        };
        return { success: true, data };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}

export async function createFogTask(
    hostId: number,
    taskTypeId: number,
    options?: Record<string, unknown>,
): Promise<{ success: boolean; data?: FogTaskResult; error?: string }> {
    if (!isFogConfigured()) {
        return { success: false, error: 'FOG not configured' };
    }
    try {
        // Docs say body should be {"taskType": "1"} (string per FOG docs)
        const res = await fogRequest('POST', `/fog/host/${hostId}/task`, {
            taskType: String(taskTypeId),
            ...options,
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
        const data = (await res.json()) as FogTaskResult;
        return { success: true, data };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}

export async function createFogSnapinTask(
    hostId: number,
    snapinId: number,
    options?: Record<string, unknown>,
): Promise<{ success: boolean; data?: FogTaskResult; error?: string }> {
    if (!isFogConfigured()) {
        return { success: false, error: 'FOG not configured' };
    }
    try {
        // Single Snapin task type is 11 per official docs
        const res = await fogRequest('POST', `/fog/host/${hostId}/task`, {
            taskType: '11',
            snapinID: String(snapinId),
            ...options,
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
        const data = (await res.json()) as FogTaskResult;
        return { success: true, data };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}

export async function listActiveTasks(): Promise<{
    success: boolean;
    data?: { count: number; tasks: unknown[] };
    error?: string;
}> {
    if (!isFogConfigured()) {
        return { success: false, error: 'FOG not configured' };
    }
    try {
        const res = await fogRequest('GET', '/fog/task/active');
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
        const data = (await res.json()) as {
            count: number;
            tasks: unknown[];
        };
        return { success: true, data };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}

export async function listActiveMulticastSessions(): Promise<{
    success: boolean;
    data?: { count: number; multicastsessions: unknown[] };
    error?: string;
}> {
    if (!isFogConfigured()) {
        return { success: false, error: 'FOG not configured' };
    }
    try {
        const res = await fogRequest('GET', '/fog/multicastsession/current');
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
        const data = (await res.json()) as {
            count: number;
            multicastsessions: unknown[];
        };
        return { success: true, data };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}
