import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { piholeConfig } from '../db/schema';

// ===================== Types =====================

export interface PiholeCredentials {
    url: string;
    password: string;
}

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

export type PiholeDnsElement = 'upstreams' | 'hosts' | 'cnameRecords';

export interface PiholeDnsList {
    element: PiholeDnsElement;
    items: string[];
}

type PiholeResult<T> = {
    success: boolean;
    data?: T;
    error?: string;
};

// ===================== Client =====================

/**
 * Authenticated Pi-hole API client bound to specific credentials.
 * Each instance caches its own session SID/CSRF tokens.
 */
export class PiholeClient {
    private url: string;
    private password: string;
    private sid: string | null = null;
    private csrf: string | null = null;
    /**
     * In-flight auth promise, shared across concurrent calls so that
     * `Promise.all([a, b, c])` triggers a single /api/auth request instead
     * of three (which trips Pi-hole's auth rate limit).
     */
    private authPromise: Promise<{
        success: boolean;
        sid?: string;
        csrf?: string;
        error?: string;
    }> | null = null;

    constructor(creds: PiholeCredentials) {
        this.url = creds.url.replace(/\/$/, '');
        this.password = creds.password;
    }

    get configured(): boolean {
        return Boolean(this.url && this.password);
    }

    private piholeUrl(path: string): string {
        return `${this.url}/api${path}`;
    }

    private async auth(): Promise<{
        success: boolean;
        sid?: string;
        csrf?: string;
        error?: string;
    }> {
        try {
            const res = await fetch(this.piholeUrl('/auth'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: this.password }),
            });
            const json = (await res.json()) as {
                session?: { valid?: boolean; sid?: string; csrf?: string };
                error?: { message?: string };
            };
            if (json.session?.valid && json.session.sid) {
                this.sid = json.session.sid;
                this.csrf = json.session.csrf || null;
                return {
                    success: true,
                    sid: this.sid,
                    csrf: this.csrf ?? undefined,
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

    private async ensureAuth(): Promise<{ success: boolean; error?: string }> {
        if (this.sid) return { success: true };
        // Deduplicate concurrent auth attempts to avoid Pi-hole rate limits.
        if (!this.authPromise) {
            this.authPromise = this.auth().finally(() => {
                this.authPromise = null;
            });
        }
        const result = await this.authPromise;
        if (!result.success) {
            return { success: false, error: result.error };
        }
        return { success: true };
    }

    private async piholeFetch(
        path: string,
        opts: RequestInit = {},
    ): Promise<Response> {
        const auth = await this.ensureAuth();
        if (!auth.success) {
            throw new Error(auth.error || 'Not authenticated');
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(opts.headers as Record<string, string>),
        };
        if (this.sid) headers['X-FTL-SID'] = this.sid;
        if (this.csrf) headers['X-FTL-CSRF'] = this.csrf;

        const res = await fetch(this.piholeUrl(path), { ...opts, headers });

        // Re-authenticate once on session expiry
        if (res.status === 401) {
            this.sid = null;
            this.csrf = null;
            const reauth = await this.ensureAuth();
            if (!reauth.success) {
                throw new Error(reauth.error || 'Re-authentication failed');
            }
            headers['X-FTL-SID'] = this.sid!;
            if (this.csrf) headers['X-FTL-CSRF'] = this.csrf;
            return fetch(this.piholeUrl(path), { ...opts, headers });
        }

        return res;
    }

    // ---------- Stats ----------

    async getSummary(): Promise<PiholeResult<PiholeSummary>> {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.piholeFetch('/stats/summary');
            if (!res.ok) return errorFrom(res);
            return { success: true, data: (await res.json()) as PiholeSummary };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    async getTopDomains(
        blocked = true,
        count = 10,
    ): Promise<PiholeResult<PiholeTopDomains>> {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.piholeFetch(
                `/stats/top_domains?blocked=${blocked}&count=${count}`,
            );
            if (!res.ok) return errorFrom(res);
            return {
                success: true,
                data: (await res.json()) as PiholeTopDomains,
            };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    async getRecentBlocked(
        count = 20,
    ): Promise<PiholeResult<PiholeRecentBlocked>> {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.piholeFetch(
                `/stats/recent_blocked?count=${count}`,
            );
            if (!res.ok) return errorFrom(res);
            return {
                success: true,
                data: (await res.json()) as PiholeRecentBlocked,
            };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    async getQueries(length = 100): Promise<PiholeResult<PiholeQueries>> {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.piholeFetch(`/queries?length=${length}`);
            if (!res.ok) return errorFrom(res);
            return {
                success: true,
                data: (await res.json()) as PiholeQueries,
            };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    // ---------- Domains ----------

    async getDomains(): Promise<PiholeResult<PiholeDomains>> {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.piholeFetch('/domains');
            if (!res.ok) return errorFrom(res);
            return { success: true, data: (await res.json()) as PiholeDomains };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    async addDomain(
        domain: string,
        type: 'allow' | 'deny' = 'deny',
        kind: 'exact' | 'regex' = 'exact',
        comment = '',
        enabled = true,
    ): Promise<PiholeResult<PiholeDomains>> {
        if (!this.configured) return unconfigured();
        try {
            const body: Record<string, unknown> = { domain };
            if (comment) body.comment = comment;
            body.enabled = enabled;

            const res = await this.piholeFetch(`/domains/${type}/${kind}`, {
                method: 'POST',
                body: JSON.stringify(body),
            });
            if (!res.ok) return errorFrom(res);
            return { success: true, data: (await res.json()) as PiholeDomains };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    async deleteDomain(
        type: 'allow' | 'deny',
        kind: 'exact' | 'regex',
        domain: string,
    ): Promise<PiholeResult<unknown>> {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.piholeFetch(
                `/domains/${type}/${kind}/${encodeURIComponent(domain)}`,
                { method: 'DELETE' },
            );
            if (!res.ok && res.status !== 204) return errorFrom(res);
            return { success: true };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    async updateDomain(
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
    ): Promise<PiholeResult<PiholeDomains>> {
        if (!this.configured) return unconfigured();
        try {
            const body: Record<string, unknown> = {};
            if (updates.enabled !== undefined) body.enabled = updates.enabled;
            if (updates.comment !== undefined) body.comment = updates.comment;
            if (updates.groups !== undefined) body.groups = updates.groups;
            if (updates.newType !== undefined) body.type = updates.newType;
            if (updates.newKind !== undefined) body.kind = updates.newKind;

            const res = await this.piholeFetch(
                `/domains/${type}/${kind}/${encodeURIComponent(domain)}`,
                {
                    method: 'PUT',
                    body: JSON.stringify(body),
                },
            );
            if (!res.ok) return errorFrom(res);
            return { success: true, data: (await res.json()) as PiholeDomains };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    // ---------- Blocking ----------

    async getBlocking(): Promise<PiholeResult<PiholeBlocking>> {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.piholeFetch('/dns/blocking');
            if (!res.ok) return errorFrom(res);
            return {
                success: true,
                data: (await res.json()) as PiholeBlocking,
            };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    async setBlocking(
        blocking: boolean,
        timer?: number | null,
    ): Promise<PiholeResult<PiholeBlocking>> {
        if (!this.configured) return unconfigured();
        try {
            const body: Record<string, unknown> = { blocking };
            if (timer !== undefined) body.timer = timer;

            const res = await this.piholeFetch('/dns/blocking', {
                method: 'POST',
                body: JSON.stringify(body),
            });
            if (!res.ok) return errorFrom(res);
            return {
                success: true,
                data: (await res.json()) as PiholeBlocking,
            };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    // ---------- DNS config ----------

    async getDnsList(
        element: PiholeDnsElement,
    ): Promise<PiholeResult<PiholeDnsList>> {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.piholeFetch(`/config/dns/${element}`);
            if (!res.ok) return errorFrom(res);
            const json = (await res.json()) as {
                config?: { dns?: Record<string, string[]> };
            };
            const items = json.config?.dns?.[element] ?? [];
            return { success: true, data: { element, items } };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    async addDnsItem(
        element: PiholeDnsElement,
        value: string,
    ): Promise<PiholeResult<{ success: boolean }>> {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.piholeFetch(
                `/config/dns/${element}/${encodeURIComponent(value)}?restart=true`,
                { method: 'PUT' },
            );
            if (!res.ok && res.status !== 201) return errorFrom(res);
            return { success: true, data: { success: true } };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }

    async deleteDnsItem(
        element: PiholeDnsElement,
        value: string,
    ): Promise<PiholeResult<{ success: boolean }>> {
        if (!this.configured) return unconfigured();
        try {
            const res = await this.piholeFetch(
                `/config/dns/${element}/${encodeURIComponent(value)}?restart=true`,
                { method: 'DELETE' },
            );
            if (!res.ok && res.status !== 204) return errorFrom(res);
            return { success: true, data: { success: true } };
        } catch (err) {
            return { success: false, error: String(err) };
        }
    }
}

// ===================== Helpers =====================

function unconfigured<T>(): PiholeResult<T> {
    return { success: false, error: 'Pi-hole not configured' };
}

async function errorFrom(res: Response): Promise<PiholeResult<never>> {
    try {
        const json = (await res.json()) as { error?: { message?: string } };
        return {
            success: false,
            error: json.error?.message || `HTTP ${res.status}`,
        };
    } catch {
        return { success: false, error: `HTTP ${res.status}` };
    }
}

// ===================== Credential resolution =====================

/**
 * Resolve Pi-hole credentials for an organization.
 * Per-org DB configuration takes precedence over the global env fallback
 * (PIHOLE_URL / PIHOLE_PASSWORD).
 */
export async function getPiholeCredentials(
    organizationId: string,
): Promise<PiholeCredentials | undefined> {
    const row = await db.query.piholeConfig.findFirst({
        where: eq(piholeConfig.organizationId, organizationId),
    });
    if (row && row.url && row.password) {
        return { url: row.url, password: row.password };
    }
}

// Cache clients by URL so sessions are reused across requests. The cached
// password is compared to detect credential rotation.
const clientCache = new Map<
    string,
    { password: string; client: PiholeClient }
>();

/**
 * Get a (cached) Pi-hole client bound to the resolved credentials for the
 * given organization. Returns an unconfigured client when no credentials
 * are available; its methods will short-circuit with an error.
 */
export async function getPiholeClient(
    organizationId: string,
): Promise<PiholeClient> {
    const creds = await getPiholeCredentials(organizationId);
    if (!creds) return new PiholeClient({ url: '', password: '' });

    const cached = clientCache.get(creds.url);
    if (cached && cached.password === creds.password) {
        return cached.client;
    }

    const client = new PiholeClient(creds);
    clientCache.set(creds.url, { password: creds.password, client });
    return client;
}

export async function isPiholeConfigured(
    organizationId: string,
): Promise<boolean> {
    const creds = await getPiholeCredentials(organizationId);
    return Boolean(creds?.url && creds?.password);
}

/**
 * Read the stored per-organization Pi-hole configuration (raw, unmasked).
 * Returns null when no DB row exists (env fallback still applies).
 */
export async function getPiholeConfigForOrg(organizationId: string) {
    return db.query.piholeConfig.findFirst({
        where: eq(piholeConfig.organizationId, organizationId),
    });
}

/**
 * Test a Pi-hole connection by authenticating against it. Used by the
 * settings save flow to validate credentials before persisting.
 */
export async function testPiholeConnection(
    creds: PiholeCredentials,
): Promise<{ success: boolean; error?: string }> {
    const url = creds.url.replace(/\/$/, '');
    if (!url || !creds.password) {
        return { success: false, error: 'URL and password are required' };
    }
    try {
        const res = await fetch(`${url}/api/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: creds.password }),
        });
        const json = (await res.json()) as {
            session?: { valid?: boolean };
            error?: { message?: string };
        };
        if (json.session?.valid) return { success: true };
        return {
            success: false,
            error:
                json.error?.message ||
                `Authentication failed (HTTP ${res.status})`,
        };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}
