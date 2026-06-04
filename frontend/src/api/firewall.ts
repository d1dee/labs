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
    const response = await fetch(`/api/labs`, {
        method: 'GET',
        credentials: 'include',
    });

    if (!response.ok) {
        throw new Error('Failed to fetch labs');
    }

    return response.json();
}

/**
 * Fetch stats for a specific lab — uses cookie-based session
 */
export async function getLabStats(labId: string): Promise<LabStats> {
    const response = await fetch(`/api/labs/${labId}/stats`, {
        method: 'GET',
        credentials: 'include',
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch stats for lab ${labId}`);
    }

    return response.json();
}

/**
 * Toggle lab access — uses cookie-based session
 */
export async function toggleLab(
    labId: string,
    enable: boolean,
): Promise<{ success: boolean; message: string }> {
    const response = await fetch(`/api/labs/${labId}/toggle`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enable }),
    });

    if (!response.ok) {
        throw new Error(`Failed to toggle lab ${labId}`);
    }

    return response.json();
}

/**
 * Fetch activation history for a lab — uses cookie-based session
 */
export async function getLabHistory(
    labId: string,
): Promise<{ history: ActivationHistoryEntry[] }> {
    const response = await fetch(`/api/labs/${labId}/history`, {
        method: 'GET',
        credentials: 'include',
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch history for lab ${labId}`);
    }

    return response.json();
}

/**
 * Fetch data usage history for a lab — uses cookie-based session
 */
export async function getDataUsageHistory(
    labId: string,
): Promise<{ history: DataUsageHistoryEntry[] }> {
    const response = await fetch(`/api/labs/${labId}/usage-history`, {
        method: 'GET',
        credentials: 'include',
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch data usage history for lab ${labId}`);
    }

    return response.json();
}
