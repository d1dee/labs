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
