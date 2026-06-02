const PIHOLE_URL = process.env.PIHOLE_URL?.replace(/\/$/, '') || '';
const PIHOLE_PASSWORD = process.env.PIHOLE_PASSWORD || '';

let sessionSid: string | null = null;
let sessionCsrf: string | null = null;

function piholeUrl(path: string): string {
    return `${PIHOLE_URL}/api${path}`;
}

async function piholeAuth(): Promise<{
    success: boolean;
    sid?: string;
    csrf?: string;
    error?: string;
}> {
    try {
        const res = await fetch(piholeUrl('/auth'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: PIHOLE_PASSWORD }),
        });
        const json = (await res.json()) as {
            session?: { valid?: boolean; sid?: string; csrf?: string };
            error?: { message?: string };
        };
        if (json.session?.valid && json.session.sid) {
            sessionSid = json.session.sid;
            sessionCsrf = json.session.csrf || null;
            return {
                success: true,
                sid: sessionSid,
                csrf: sessionCsrf ?? undefined,
            };
        }
        return {
            success: false,
            error: json.error?.message || 'Authentication failed',
        };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}

async function ensureAuth(): Promise<{ success: boolean; error?: string }> {
    if (sessionSid) return { success: true };
    if (!PIHOLE_URL || !PIHOLE_PASSWORD) {
        return { success: false, error: 'Pi-hole not configured' };
    }
    return piholeAuth();
}

async function piholeFetch(
    path: string,
    opts: RequestInit = {},
): Promise<Response> {
    const auth = await ensureAuth();
    if (!auth.success) {
        throw new Error(auth.error || 'Not authenticated');
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(opts.headers as Record<string, string>),
    };
    if (sessionSid) {
        headers['X-FTL-SID'] = sessionSid;
    }
    if (sessionCsrf) {
        headers['X-FTL-CSRF'] = sessionCsrf;
    }

    const res = await fetch(piholeUrl(path), { ...opts, headers });

    if (res.status === 401) {
        sessionSid = null;
        sessionCsrf = null;
        const reauth = await piholeAuth();
        if (!reauth.success) {
            throw new Error(reauth.error || 'Re-authentication failed');
        }
        headers['X-FTL-SID'] = sessionSid!;
        if (sessionCsrf) headers['X-FTL-CSRF'] = sessionCsrf;
        return fetch(piholeUrl(path), { ...opts, headers });
    }

    return res;
}

// ===================== Types =====================

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

export function isPiholeConfigured(): boolean {
    return Boolean(PIHOLE_URL && PIHOLE_PASSWORD);
}

// ===================== API Functions =====================

export async function getPiholeSummary(): Promise<{
    success: boolean;
    data?: PiholeSummary;
    error?: string;
}> {
    if (!isPiholeConfigured()) {
        return { success: false, error: 'Pi-hole not configured' };
    }
    try {
        const res = await piholeFetch('/stats/summary');
        if (!res.ok) {
            const json = (await res.json()) as { error?: { message?: string } };
            return {
                success: false,
                error: json.error?.message || `HTTP ${res.status}`,
            };
        }
        const data = (await res.json()) as PiholeSummary;
        return { success: true, data };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}

export async function getPiholeTopDomains(
    blocked = true,
    count = 10,
): Promise<{ success: boolean; data?: PiholeTopDomains; error?: string }> {
    if (!isPiholeConfigured()) {
        return { success: false, error: 'Pi-hole not configured' };
    }
    try {
        const res = await piholeFetch(
            `/stats/top_domains?blocked=${blocked}&count=${count}`,
        );
        if (!res.ok) {
            const json = (await res.json()) as { error?: { message?: string } };
            return {
                success: false,
                error: json.error?.message || `HTTP ${res.status}`,
            };
        }
        const data = (await res.json()) as PiholeTopDomains;
        return { success: true, data };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}

export async function getPiholeRecentBlocked(
    count = 20,
): Promise<{ success: boolean; data?: PiholeRecentBlocked; error?: string }> {
    if (!isPiholeConfigured()) {
        return { success: false, error: 'Pi-hole not configured' };
    }
    try {
        const res = await piholeFetch(`/stats/recent_blocked?count=${count}`);
        if (!res.ok) {
            const json = (await res.json()) as { error?: { message?: string } };
            return {
                success: false,
                error: json.error?.message || `HTTP ${res.status}`,
            };
        }
        const data = (await res.json()) as PiholeRecentBlocked;
        return { success: true, data };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}

export async function getPiholeQueries(
    length = 100,
): Promise<{ success: boolean; data?: PiholeQueries; error?: string }> {
    if (!isPiholeConfigured()) {
        return { success: false, error: 'Pi-hole not configured' };
    }
    try {
        const res = await piholeFetch(`/queries?length=${length}`);
        if (!res.ok) {
            const json = (await res.json()) as { error?: { message?: string } };
            return {
                success: false,
                error: json.error?.message || `HTTP ${res.status}`,
            };
        }
        const data = (await res.json()) as PiholeQueries;
        return { success: true, data };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}

export async function getPiholeDomains(): Promise<{
    success: boolean;
    data?: PiholeDomains;
    error?: string;
}> {
    if (!isPiholeConfigured()) {
        return { success: false, error: 'Pi-hole not configured' };
    }
    try {
        const res = await piholeFetch('/domains');
        if (!res.ok) {
            const json = (await res.json()) as { error?: { message?: string } };
            return {
                success: false,
                error: json.error?.message || `HTTP ${res.status}`,
            };
        }
        const data = (await res.json()) as PiholeDomains;
        return { success: true, data };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}

export async function addPiholeDomain(
    domain: string,
    type: 'allow' | 'deny' = 'deny',
    kind: 'exact' | 'regex' = 'exact',
    comment = '',
    enabled = true,
): Promise<{ success: boolean; data?: PiholeDomains; error?: string }> {
    if (!isPiholeConfigured()) {
        return { success: false, error: 'Pi-hole not configured' };
    }
    try {
        const body: Record<string, unknown> = { domain };
        if (comment) body.comment = comment;
        body.enabled = enabled;

        const res = await piholeFetch(`/domains/${type}/${kind}`, {
            method: 'POST',
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const json = (await res.json()) as { error?: { message?: string } };
            return {
                success: false,
                error: json.error?.message || `HTTP ${res.status}`,
            };
        }
        const data = (await res.json()) as PiholeDomains;
        return { success: true, data };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}

export async function deletePiholeDomain(
    type: 'allow' | 'deny',
    kind: 'exact' | 'regex',
    domain: string,
): Promise<{ success: boolean; error?: string }> {
    if (!isPiholeConfigured()) {
        return { success: false, error: 'Pi-hole not configured' };
    }
    try {
        const res = await piholeFetch(
            `/domains/${type}/${kind}/${encodeURIComponent(domain)}`,
            { method: 'DELETE' },
        );
        if (!res.ok && res.status !== 204) {
            const json = (await res.json()) as { error?: { message?: string } };
            return {
                success: false,
                error: json.error?.message || `HTTP ${res.status}`,
            };
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}

export async function updatePiholeDomain(
    type: 'allow' | 'deny',
    kind: 'exact' | 'regex',
    domain: string,
    updates: {
        enabled?: boolean;
        comment?: string;
        groups?: number[];
        newType?: 'allow' | 'deny';
        newKind?: 'exact' | 'regex';
    },
): Promise<{ success: boolean; data?: PiholeDomains; error?: string }> {
    if (!isPiholeConfigured()) {
        return { success: false, error: 'Pi-hole not configured' };
    }
    try {
        const body: Record<string, unknown> = {};
        if (updates.enabled !== undefined) body.enabled = updates.enabled;
        if (updates.comment !== undefined) body.comment = updates.comment;
        if (updates.groups !== undefined) body.groups = updates.groups;
        if (updates.newType !== undefined) body.type = updates.newType;
        if (updates.newKind !== undefined) body.kind = updates.newKind;

        const res = await piholeFetch(
            `/domains/${type}/${kind}/${encodeURIComponent(domain)}`,
            {
                method: 'PUT',
                body: JSON.stringify(body),
            },
        );
        if (!res.ok) {
            const json = (await res.json()) as { error?: { message?: string } };
            return {
                success: false,
                error: json.error?.message || `HTTP ${res.status}`,
            };
        }
        const data = (await res.json()) as PiholeDomains;
        return { success: true, data };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}

export async function getPiholeBlocking(): Promise<{
    success: boolean;
    data?: PiholeBlocking;
    error?: string;
}> {
    if (!isPiholeConfigured()) {
        return { success: false, error: 'Pi-hole not configured' };
    }
    try {
        const res = await piholeFetch('/dns/blocking');
        if (!res.ok) {
            const json = (await res.json()) as { error?: { message?: string } };
            return {
                success: false,
                error: json.error?.message || `HTTP ${res.status}`,
            };
        }
        const data = (await res.json()) as PiholeBlocking;
        return { success: true, data };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}

export async function setPiholeBlocking(
    blocking: boolean,
    timer?: number | null,
): Promise<{ success: boolean; data?: PiholeBlocking; error?: string }> {
    if (!isPiholeConfigured()) {
        return { success: false, error: 'Pi-hole not configured' };
    }
    try {
        const body: Record<string, unknown> = { blocking };
        if (timer !== undefined) body.timer = timer;

        const res = await piholeFetch('/dns/blocking', {
            method: 'POST',
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const json = (await res.json()) as { error?: { message?: string } };
            return {
                success: false,
                error: json.error?.message || `HTTP ${res.status}`,
            };
        }
        const data = (await res.json()) as PiholeBlocking;
        return { success: true, data };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}
