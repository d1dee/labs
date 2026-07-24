import { $fetch, throwOnError } from './client';

export interface Lab {
    id: string;
    name: string;
    pool: string;
    subnet: string;
    ruleId: string;
}

export interface LabStats {
    lab: {
        id: string;
        name: string;
        subnet: string;
    };
    firewall: {
        ruleId: string;
        disabled: boolean;
        comment: string;
        status: 'active' | 'blocked';
        usageMB: number;
    };
    devices: {
        connected: number;
        dhcpServer: string;
    };
    timestamp: string;
}

export interface ActivationHistoryEntry {
    id: string;
    labId: string;
    enabled: boolean;
    triggeredBy: string;
    createdAt: string;
}

export interface DataUsageHistoryEntry {
    id: string;
    labId: string;
    totalBytes: number;
    usageMB: number;
    usageDiffMB: number;
    createdAt: string;
}

/**
 * Fetch all labs — uses cookie-based session from Better Auth
 */
export async function getLabs(): Promise<{ labs: Lab[] }> {
    return throwOnError(
        await $fetch<{ labs: Lab[] }>('/api/labs', { method: 'GET' }),
        'Failed to fetch labs',
    );
}

export interface LabsOverview {
    labs: Lab[];
    stats: Record<string, LabStats>;
    history: Record<string, ActivationHistoryEntry[]>;
}

/**
 * Fetch labs, per-lab stats and per-lab activation history in a single
 * request — avoids one stats + one history request per lab.
 */
export async function getLabsOverview(): Promise<LabsOverview> {
    return throwOnError(
        await $fetch<LabsOverview>('/api/labs/overview', {
            method: 'GET',
        }),
        'Failed to fetch labs overview',
    );
}

/**
 * Fetch stats for a specific lab — uses cookie-based session
 */
export async function getLabStats(labId: string): Promise<LabStats> {
    return throwOnError(
        await $fetch<LabStats>(`/api/labs/${labId}/stats`, {
            method: 'GET',
        }),
        `Failed to fetch stats for lab ${labId}`,
    );
}

/**
 * Toggle lab access — uses cookie-based session
 */
export async function toggleLab(
    labId: string,
    enable: boolean,
): Promise<{ success: boolean; message: string }> {
    return throwOnError(
        await $fetch<{ success: boolean; message: string }>(
            `/api/labs/${labId}/toggle`,
            {
                method: 'POST',
                body: { enable },
            },
        ),
        `Failed to toggle lab ${labId}`,
    );
}

/**
 * Fetch activation history for a lab — uses cookie-based session
 */
export async function getLabHistory(
    labId: string,
): Promise<{ history: ActivationHistoryEntry[] }> {
    return throwOnError(
        await $fetch<{ history: ActivationHistoryEntry[] }>(
            `/api/labs/${labId}/history`,
            { method: 'GET' },
        ),
        `Failed to fetch history for lab ${labId}`,
    );
}

/**
 * Fetch data usage history for a lab — uses cookie-based session
 */
export async function getDataUsageHistory(
    labId: string,
): Promise<{ history: DataUsageHistoryEntry[] }> {
    return throwOnError(
        await $fetch<{ history: DataUsageHistoryEntry[] }>(
            `/api/labs/${labId}/usage-history`,
            { method: 'GET' },
        ),
        `Failed to fetch data usage history for lab ${labId}`,
    );
}
