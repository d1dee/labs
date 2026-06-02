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

// ===================== Pi-hole v6 API =====================

export interface PiholeSummary {
    queries: {
        total: number;
        blocked: number;
        percent_blocked: number;
        unique_domains: number;
        forwarded: number;
        cached: number;
        frequency: number;
        types: Record<string, number>;
        replies: Record<string, number>;
        status: Record<string, number>;
    };
    clients: {
        active: number;
        total: number;
    };
    gravity: {
        domains_being_blocked: number;
        last_update: number;
    };
    took: number;
}

export interface PiholeTopDomain {
    domain: string;
    count: number;
}

export interface PiholeTopDomains {
    domains: PiholeTopDomain[];
    total_queries: number;
    blocked_queries: number;
    took: number;
}

export interface PiholeRecentBlocked {
    blocked: string[];
    took: number;
}

export interface PiholeQuery {
    id: number;
    time: number;
    type: string;
    domain: string;
    cname: string | null;
    status: string;
    client: {
        ip: string;
        name: string;
    };
    reply: string;
    dnssec: string;
    elapsed: number;
}

export interface PiholeQueries {
    queries: PiholeQuery[];
    cursor: number | null;
    took: number;
}

export interface PiholeDomainItem {
    id: number;
    domain: string;
    unicode: string;
    type: 'allow' | 'deny';
    kind: 'exact' | 'regex';
    comment: string | null;
    groups: number[];
    enabled: boolean;
    date_added: number;
    date_modified: number;
}

export interface PiholeDomains {
    domains: PiholeDomainItem[];
    took: number;
    processed?: {
        success: { item: string }[];
        errors: { item: string; error: string }[];
    } | null;
}

export interface PiholeBlocking {
    blocking: 'enabled' | 'disabled' | 'failed' | 'unknown';
    timer: number | null;
    took: number;
}

export async function getPiholeStatus(): Promise<{
    configured: boolean;
    url: string | null;
}> {
    const response = await fetch('/api/pihole/status', {
        method: 'GET',
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error('Failed to fetch Pi-hole status');
    }
    return response.json();
}

export async function getPiholeSummary(): Promise<PiholeSummary> {
    const response = await fetch('/api/pihole/summary', {
        method: 'GET',
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error('Failed to fetch Pi-hole summary');
    }
    return response.json();
}

export async function getPiholeTopDomains(
    blocked = true,
    count = 10,
): Promise<PiholeTopDomains> {
    const response = await fetch(
        `/api/pihole/top-domains?blocked=${blocked}&count=${count}`,
        {
            method: 'GET',
            credentials: 'include',
        },
    );
    if (!response.ok) {
        throw new Error('Failed to fetch Pi-hole top domains');
    }
    return response.json();
}

export async function getPiholeRecentBlocked(
    count = 20,
): Promise<PiholeRecentBlocked> {
    const response = await fetch(`/api/pihole/recent-blocked?count=${count}`, {
        method: 'GET',
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error('Failed to fetch Pi-hole recent blocked');
    }
    return response.json();
}

export async function getPiholeQueries(length = 100): Promise<PiholeQueries> {
    const response = await fetch(`/api/pihole/queries?length=${length}`, {
        method: 'GET',
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error('Failed to fetch Pi-hole queries');
    }
    return response.json();
}

export async function getPiholeDomains(): Promise<PiholeDomains> {
    const response = await fetch('/api/pihole/domains', {
        method: 'GET',
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error('Failed to fetch Pi-hole domains');
    }
    return response.json();
}

export async function addPiholeDomain(
    domain: string,
    type: 'allow' | 'deny' = 'deny',
    kind: 'exact' | 'regex' = 'exact',
    comment = '',
    enabled = true,
): Promise<PiholeDomains> {
    const body: Record<string, unknown> = { domain, type, kind, enabled };
    if (comment) body.comment = comment;

    const response = await fetch('/api/pihole/domains', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error('Failed to add Pi-hole domain');
    }
    return response.json();
}

export async function deletePiholeDomain(
    domain: string,
    type: 'allow' | 'deny',
    kind: 'exact' | 'regex',
): Promise<{ success: boolean }> {
    const response = await fetch('/api/pihole/domains', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, type, kind }),
    });
    if (!response.ok) {
        throw new Error('Failed to delete Pi-hole domain');
    }
    return response.json();
}

export async function updatePiholeDomain(
    domain: string,
    type: 'allow' | 'deny',
    kind: 'exact' | 'regex',
    updates: {
        enabled?: boolean;
        comment?: string;
        groups?: number[];
        newType?: 'allow' | 'deny';
        newKind?: 'exact' | 'regex';
    },
): Promise<PiholeDomains> {
    const body: Record<string, unknown> = { domain, type, kind, ...updates };

    const response = await fetch('/api/pihole/domains', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error('Failed to update Pi-hole domain');
    }
    return response.json();
}

export async function getPiholeBlocking(): Promise<PiholeBlocking> {
    const response = await fetch('/api/pihole/blocking', {
        method: 'GET',
        credentials: 'include',
    });
    if (!response.ok) {
        throw new Error('Failed to fetch Pi-hole blocking status');
    }
    return response.json();
}

export async function setPiholeBlocking(
    blocking: boolean,
    timer?: number | null,
): Promise<PiholeBlocking> {
    const body: Record<string, unknown> = { blocking };
    if (timer !== undefined) body.timer = timer;

    const response = await fetch('/api/pihole/blocking', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error('Failed to set Pi-hole blocking status');
    }
    return response.json();
}
