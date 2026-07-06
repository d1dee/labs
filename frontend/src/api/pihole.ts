import { $fetch, throwOnError } from './client';

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
    return throwOnError(
        await $fetch<{ configured: boolean; url: string | null }>(
            '/api/pihole/status',
            { method: 'GET' },
        ),
        'Failed to fetch Pi-hole status',
    );
}

export async function getPiholeSummary(): Promise<PiholeSummary> {
    return throwOnError(
        await $fetch<PiholeSummary>('/api/pihole/summary', {
            method: 'GET',
        }),
        'Failed to fetch Pi-hole summary',
    );
}

export async function getPiholeTopDomains(
    blocked = true,
    count = 10,
): Promise<PiholeTopDomains> {
    return throwOnError(
        await $fetch<PiholeTopDomains>(
            `/api/pihole/top-domains?blocked=${blocked}&count=${count}`,
            { method: 'GET' },
        ),
        'Failed to fetch Pi-hole top domains',
    );
}

export async function getPiholeRecentBlocked(
    count = 20,
): Promise<PiholeRecentBlocked> {
    return throwOnError(
        await $fetch<PiholeRecentBlocked>(
            `/api/pihole/recent-blocked?count=${count}`,
            { method: 'GET' },
        ),
        'Failed to fetch Pi-hole recent blocked',
    );
}

export async function getPiholeQueries(
    length = 100,
): Promise<PiholeQueries> {
    return throwOnError(
        await $fetch<PiholeQueries>(`/api/pihole/queries?length=${length}`, {
            method: 'GET',
        }),
        'Failed to fetch Pi-hole queries',
    );
}

export async function getPiholeDomains(): Promise<PiholeDomains> {
    return throwOnError(
        await $fetch<PiholeDomains>('/api/pihole/domains', {
            method: 'GET',
        }),
        'Failed to fetch Pi-hole domains',
    );
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

    return throwOnError(
        await $fetch<PiholeDomains>('/api/pihole/domains', {
            method: 'POST',
            body,
        }),
        'Failed to add Pi-hole domain',
    );
}

export async function deletePiholeDomain(
    domain: string,
    type: 'allow' | 'deny',
    kind: 'exact' | 'regex',
): Promise<{ success: boolean }> {
    return throwOnError(
        await $fetch<{ success: boolean }>('/api/pihole/domains', {
            method: 'DELETE',
            body: { domain, type, kind },
        }),
        'Failed to delete Pi-hole domain',
    );
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
    return throwOnError(
        await $fetch<PiholeDomains>('/api/pihole/domains', {
            method: 'PUT',
            body: { domain, type, kind, ...updates },
        }),
        'Failed to update Pi-hole domain',
    );
}

export async function getPiholeBlocking(): Promise<PiholeBlocking> {
    return throwOnError(
        await $fetch<PiholeBlocking>('/api/pihole/blocking', {
            method: 'GET',
        }),
        'Failed to fetch Pi-hole blocking status',
    );
}

export async function setPiholeBlocking(
    blocking: boolean,
    timer?: number | null,
): Promise<PiholeBlocking> {
    const body: Record<string, unknown> = { blocking };
    if (timer !== undefined) body.timer = timer;

    return throwOnError(
        await $fetch<PiholeBlocking>('/api/pihole/blocking', {
            method: 'POST',
            body,
        }),
        'Failed to set Pi-hole blocking status',
    );
}
