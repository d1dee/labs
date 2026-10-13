import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/database';
import { demoState } from '../db/schema';

// ===================== User Check =====================

export function isDemoUser(userObj: { username?: string | null } | null): boolean {
    return userObj?.username === 'demo';
}

// ===================== Core Demo State CRUD =====================

export async function getDemoState(
    userId: string,
    category: string,
    resourceId?: string,
) {
    const conditions = [
        eq(demoState.userId, userId),
        eq(demoState.category, category),
    ];
    if (resourceId) {
        conditions.push(eq(demoState.resourceId, resourceId));
    }
    return db
        .select()
        .from(demoState)
        .where(and(...conditions))
        // Timestamp columns store whole seconds; rowid preserves insertion order for ties.
        .orderBy(desc(demoState.createdAt), desc(sql`${demoState}.rowid`));
}

export async function getLatestDemoState(
    userId: string,
    category: string,
    resourceId?: string,
) {
    const results = await getDemoState(userId, category, resourceId);
    return results[0] || null;
}

export async function setDemoState(
    userId: string,
    category: string,
    action: string,
    resourceId?: string | null,
    data?: Record<string, unknown>,
) {
    await db.insert(demoState).values({
        id: crypto.randomUUID(),
        userId,
        category,
        resourceId: resourceId || null,
        action,
        data: JSON.stringify(data || {}),
        createdAt: new Date(),
    });
}

// ===================== Lab Helpers =====================

export async function getDemoLabEnabled(
    userId: string,
    labId: string,
): Promise<boolean | null> {
    const state = await getLatestDemoState(userId, 'lab', labId);
    if (!state) return null;
    const data = JSON.parse(state.data);
    return data.enabled ?? null;
}

export async function setDemoLabState(
    userId: string,
    labId: string,
    enabled: boolean,
) {
    await setDemoState(userId, 'lab', 'toggle', labId, { enabled });
}

export async function getDemoLabHistory(userId: string, labId: string) {
    const states = await getDemoState(userId, 'lab', labId);
    return states.map((s) => {
        const data = JSON.parse(s.data);
        return {
            id: s.id,
            labId: s.resourceId,
            enabled: data.enabled,
            triggeredBy: userId,
            createdAt: s.createdAt.toISOString(),
        };
    });
}

// ===================== Pi-hole Helpers =====================

export async function getDemoPiholeBlocking(userId: string): Promise<{
    blocking: 'enabled' | 'disabled' | 'failed' | 'unknown';
    timer: number | null;
    took: number;
} | null> {
    const state = await getLatestDemoState(userId, 'pihole_blocking');
    if (!state) return null;
    const data = JSON.parse(state.data);
    return {
        blocking: data.blocking ? 'enabled' : 'disabled',
        timer: data.timer ?? null,
        took: 0,
    };
}

export async function setDemoPiholeBlocking(
    userId: string,
    blocking: boolean,
    timer?: number | null,
) {
    await setDemoState(userId, 'pihole_blocking', 'set', null, {
        blocking,
        timer,
    });
}

export interface DemoPiholeDomainOverride {
    domain: string;
    type: 'allow' | 'deny';
    kind: 'exact' | 'regex';
    enabled: boolean;
    comment: string | null;
    groups: number[];
    date_added: number;
    date_modified: number;
}

export async function getDemoPiholeDomainOverrides(
    userId: string,
): Promise<{
    additions: DemoPiholeDomainOverride[];
    deletions: Array<{ domain: string; type: 'allow' | 'deny'; kind: 'exact' | 'regex' }>;
    updates: Array<{ domain: string; enabled?: boolean; comment?: string; groups?: number[]; newType?: 'allow' | 'deny'; newKind?: 'exact' | 'regex' }>;
}> {
    const states = await getDemoState(userId, 'pihole_domain');
    const additions: DemoPiholeDomainOverride[] = [];
    const deletions: Array<{ domain: string; type: 'allow' | 'deny'; kind: 'exact' | 'regex' }> = [];
    const updates: Array<{ domain: string; enabled?: boolean; comment?: string; groups?: number[]; newType?: 'allow' | 'deny'; newKind?: 'exact' | 'regex' }> = [];

    // Track the effective state by processing from newest to oldest
    const processedDomains = new Set<string>();

    for (const state of states) {
        const domain = state.resourceId!;
        if (processedDomains.has(domain)) continue;
        processedDomains.add(domain);

        const data = JSON.parse(state.data);
        if (state.action === 'add') {
            additions.push({
                domain,
                type: data.type || 'deny',
                kind: data.kind || 'exact',
                enabled: data.enabled !== false,
                comment: data.comment || null,
                groups: data.groups || [0],
                date_added: Date.now(),
                date_modified: Date.now(),
            });
        } else if (state.action === 'delete') {
            deletions.push({
                domain,
                type: data.type,
                kind: data.kind,
            });
        } else if (state.action === 'update') {
            updates.push({
                domain,
                enabled: data.enabled,
                comment: data.comment,
                groups: data.groups,
                newType: data.newType,
                newKind: data.newKind,
            });
        }
    }

    return { additions, deletions, updates };
}

export async function addDemoPiholeDomain(
    userId: string,
    domain: string,
    type: 'allow' | 'deny',
    kind: 'exact' | 'regex',
    comment: string,
    enabled: boolean,
) {
    await setDemoState(userId, 'pihole_domain', 'add', domain, {
        type,
        kind,
        comment,
        enabled,
    });
}

export async function deleteDemoPiholeDomain(
    userId: string,
    domain: string,
    type: 'allow' | 'deny',
    kind: 'exact' | 'regex',
) {
    await setDemoState(userId, 'pihole_domain', 'delete', domain, {
        type,
        kind,
    });
}

export async function updateDemoPiholeDomain(
    userId: string,
    domain: string,
    updates: {
        enabled?: boolean;
        comment?: string;
        groups?: number[];
        newType?: 'allow' | 'deny';
        newKind?: 'exact' | 'regex';
    },
) {
    await setDemoState(userId, 'pihole_domain', 'update', domain, updates);
}

export function applyDemoPiholeDomains(
    realDomains: { domains: any[]; took: number; processed?: any },
    demoOverrides: Awaited<ReturnType<typeof getDemoPiholeDomainOverrides>>,
): { domains: any[]; took: number; processed?: any } {
    let domains = realDomains.domains.map((domain) => ({ ...domain }));

    // Apply deletions
    for (const del of demoOverrides.deletions) {
        domains = domains.filter(
            (d) =>
                !(
                    d.domain === del.domain &&
                    d.type === del.type &&
                    d.kind === del.kind
                ),
        );
    }

    // Apply type/kind changes first (move domain to new type/kind)
    for (const update of demoOverrides.updates) {
        if (update.newType || update.newKind) {
            const idx = domains.findIndex(
                (d) => d.domain === update.domain,
            );
            if (idx !== -1) {
                if (update.newType) domains[idx].type = update.newType;
                if (update.newKind) domains[idx].kind = update.newKind;
                domains[idx].date_modified = Date.now();
            }
        }
    }

    // Apply other updates
    for (const update of demoOverrides.updates) {
        const idx = domains.findIndex(
            (d) => d.domain === update.domain,
        );
        if (idx !== -1) {
            if (update.enabled !== undefined) domains[idx].enabled = update.enabled;
            if (update.comment !== undefined) domains[idx].comment = update.comment;
            if (update.groups !== undefined) domains[idx].groups = update.groups;
            domains[idx].date_modified = Date.now();
        }
    }

    // Apply additions
    for (const add of demoOverrides.additions) {
        // Check if domain already exists (from real data or previous add)
        const exists = domains.some(
            (d) => d.domain === add.domain && d.type === add.type && d.kind === add.kind,
        );
        if (!exists) {
            domains.push({
                id: Math.floor(Math.random() * 1000000),
                unicode: add.domain,
                ...add,
            });
        }
    }

    return { ...realDomains, domains, took: realDomains.took };
}

// ===================== FOG Helpers =====================

export function generateDemoFogHostId(): number {
    return -(Date.now() + Math.floor(Math.random() * 1000));
}

export async function getDemoFogHostOverrides(userId: string): Promise<{
    creations: Array<Record<string, unknown> & { id: number }>;
    updates: Array<Record<string, unknown> & { id: number }>;
    deletions: number[];
}> {
    const states = await getDemoState(userId, 'fog_host');
    const creations: Array<Record<string, unknown> & { id: number }> = [];
    const updates: Array<Record<string, unknown> & { id: number }> = [];
    const deletions: number[] = [];

    const effective = new Map<number, { action: string; data: Record<string, unknown> }>();
    // Replay the event history; a newer patch must not discard an earlier creation.
    for (const state of states.slice().reverse()) {
        const id = Number(state.resourceId);
        const data = JSON.parse(state.data);
        const previous = effective.get(id);
        if (state.action === 'update') {
            if (previous?.action === 'delete') continue;
            effective.set(id, { action: previous?.action === 'create' ? 'create' : 'update', data: { ...previous?.data, ...data } });
        } else if (state.action === 'create' || state.action === 'delete') {
            effective.set(id, { action: state.action, data });
        }
    }
    for (const [id, state] of effective) {
        if (state.action === 'create') creations.push({ ...state.data, id });
        else if (state.action === 'update') updates.push({ ...state.data, id });
        else deletions.push(id);
    }

    return { creations, updates, deletions };
}

export async function createDemoFogHost(
    userId: string,
    hostId: number,
    data: Record<string, unknown>,
) {
    await setDemoState(userId, 'fog_host', 'create', String(hostId), data);
}

export async function updateDemoFogHost(
    userId: string,
    hostId: number,
    data: Record<string, unknown>,
) {
    await setDemoState(userId, 'fog_host', 'update', String(hostId), data);
}

export async function deleteDemoFogHost(userId: string, hostId: number) {
    await setDemoState(userId, 'fog_host', 'delete', String(hostId), {});
}

export function applyDemoFogHosts(
    realHosts: { count: number; hosts: any[] },
    demoOverrides: Awaited<ReturnType<typeof getDemoFogHostOverrides>>,
): { count: number; hosts: any[] } {
    let hosts = [...realHosts.hosts];

    // Apply deletions
    for (const id of demoOverrides.deletions) {
        hosts = hosts.filter((h) => Number(h.id) !== id);
    }

    // Apply updates
    for (const update of demoOverrides.updates) {
        const idx = hosts.findIndex((h) => Number(h.id) === update.id);
        if (idx !== -1) {
            hosts[idx] = { ...hosts[idx], ...update };
        }
    }

    // Apply creations
    for (const create of demoOverrides.creations) {
        const exists = hosts.some((h) => Number(h.id) === create.id);
        if (!exists) {
            hosts.push({
                name: 'Demo Host',
                description: '',
                macs: [],
                ...create,
            });
        }
    }

    return { count: hosts.length, hosts };
}

export function applyDemoFogHost(
    realHost: any,
    demoOverrides: Awaited<ReturnType<typeof getDemoFogHostOverrides>>,
    hostId: number,
): any {
    const update = demoOverrides.updates.find((u) => u.id === hostId);
    if (update) {
        return { ...realHost, ...update };
    }
    return realHost;
}

// ===================== Generic Demo Response Helpers =====================

/**
 * Build a Pi-hole domains response that merges real data with demo overrides.
 * Falls back to demo-only data if Pi-hole is not configured.
 */
export async function buildDemoPiholeDomainsResponse(
    userId: string,
    getRealDomains: () => Promise<{ success: boolean; data?: { domains: any[]; took: number; processed?: any }; error?: string }>,
): Promise<{ domains: any[]; took: number; processed?: any }> {
    const overrides = await getDemoPiholeDomainOverrides(userId);
    const realResult = await getRealDomains();
    if (!realResult.success || !realResult.data) {
        return {
            domains: overrides.additions,
            took: 0,
            processed: null,
        };
    }
    return applyDemoPiholeDomains(realResult.data, overrides);
}

/**
 * Build a FOG hosts response that merges real data with demo overrides.
 * Falls back to demo-only data if FOG is not configured.
 */
export async function buildDemoFogHostsResponse(
    userId: string,
    getRealHosts: () => Promise<{ success: boolean; data?: { count: number; hosts: any[] }; error?: string }>,
): Promise<{ count: number; hosts: any[] }> {
    const overrides = await getDemoFogHostOverrides(userId);
    const realResult = await getRealHosts();
    if (!realResult.success || !realResult.data) {
        return {
            count: overrides.creations.length,
            hosts: overrides.creations,
        };
    }
    return applyDemoFogHosts(realResult.data, overrides);
}

/**
 * Build a FOG host response that applies demo overrides.
 * Falls back to demo-only data if FOG is not configured or host not found.
 */
export async function buildDemoFogHostResponse(
    userId: string,
    hostId: number,
    getRealHost: () => Promise<{ success: boolean; data?: any; error?: string }>,
): Promise<any> {
    const overrides = await getDemoFogHostOverrides(userId);
    const realResult = await getRealHost();

    // Check if this is a demo-created host
    const demoCreation = overrides.creations.find((c) => c.id === hostId);
    if (demoCreation) {
        return demoCreation;
    }

    if (!realResult.success || !realResult.data) {
        return null;
    }

    return applyDemoFogHost(realResult.data, overrides, hostId);
}
