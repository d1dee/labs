import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { organizationComputerInventory, organizationDeviceCache, veyonComputer } from '../db/schema';
import type { FogHost } from '../frontend/src/api/fog';
import { credentialsComplete, getFogClient, getFogCredentials } from './fog';
import { getFirewallConfigWithLabs } from './firewall-config';
import { qualifyFogHostname } from './dns-suffix';
import { veyonPoller } from './veyon-poller';

export type InventoryComputer = typeof veyonComputer.$inferSelect;
type StoredComputer = Omit<InventoryComputer, 'createdAt' | 'updatedAt'> & { createdAt: string; updatedAt: string };
export type ComputerInventorySnapshot = { hosts: FogHost[]; computers: StoredComputer[]; linkedIds: string[]; updatedAt: string; inventoryWarning?: string };
type InventoryResult = { computers: InventoryComputer[]; hosts: FogHost[]; warning?: string; configured: boolean };
type StoredSnapshot = { source: string; snapshot: ComputerInventorySnapshot };
type InventorySuffix = string | undefined | ((host: FogHost) => string | undefined);
type Dependencies = {
    source(org: string): Promise<string | null>;
    list(org: string): Promise<{ hosts: FogHost[]; count: number; truncated?: boolean; inventoryWarning?: string }>;
    manual(org: string): Promise<InventoryComputer[]>;
    load(org: string): Promise<StoredSnapshot | undefined>;
    save(org: string, value: StoredSnapshot): Promise<void>;
    suffix(org: string): Promise<InventorySuffix>;
    reconcile(org: string, previous: InventoryComputer[], next: InventoryComputer[]): void;
    now(): number;
};
const validAddress = (host: string) => host.length > 0 && host.length <= 255 && !host.startsWith('-') && /^[a-zA-Z0-9._:[\]-]+$/.test(host);
const macKey = (mac: string | null | undefined) => (mac ?? '').replace(/[:-]/g, '').toLowerCase();
const validMac = (mac: string) => /^([a-f\d]{2}[:-]){5}[a-f\d]{2}$/i.test(mac);
const targetPort = (host: string) => {
    const match = host.match(/^(?:\[[^\]]+\]|[^:]+):(\d+)$/);
    const port = Number(match?.[1]);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? String(port) : undefined;
};
const withoutPort = (host: string) => targetPort(host) ? host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '') : host;
const restore = (rows: StoredComputer[]) => rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) }));

/** FOG owns identity; legacy rows only supply stable IDs and non-FOG manual targets. */
export function buildComputerInventory(org: string, source: string, hosts: FogHost[], legacy: InventoryComputer[], previous: ComputerInventorySnapshot | undefined, suffix: InventorySuffix, now: string): ComputerInventorySnapshot {
    const claimed = new Set<string>();
    const linkedIds = new Set(previous?.linkedIds ?? []);
    const ids = new Set<number>();
    const addresses = new Set<string>();
    const previousByFogId = new Map(previous?.computers.map((row) => [row.fogHostId, row]));
    const ownership = new Map<string, Set<number>>();
    for (const host of hosts) {
        if (!host || typeof host.name !== 'string') throw new Error('FOG returned an invalid host identity');
        const domain = typeof suffix === 'function' ? suffix(host) : suffix;
        const keys = [host.name, host.ip, qualifyFogHostname(host.name, domain)]
            .filter((value): value is string => Boolean(value)).map((value) => `address:${value.toLowerCase()}`);
        keys.push(...[host.primac, ...(host.macs ?? [])].filter((mac): mac is string => typeof mac === 'string' && validMac(mac)).map((mac) => `mac:${macKey(mac)}`));
        for (const key of keys) {
            const owners = ownership.get(key) ?? new Set<number>();
            owners.add(host.id);
            ownership.set(key, owners);
        }
    }
    const inferredByFogId = new Map<number, InventoryComputer[]>();
    const linkedByFogId = new Map<number, InventoryComputer[]>();
    for (const row of legacy) {
        if (row.fogHostId != null) {
            linkedByFogId.set(row.fogHostId, [...(linkedByFogId.get(row.fogHostId) ?? []), row]);
            continue;
        }
        if (linkedIds.has(row.id)) continue;
        const candidates = new Set([
            ...(ownership.get(`address:${withoutPort(row.host).toLowerCase()}`) ?? []),
            ...(row.macAddress ? ownership.get(`mac:${macKey(row.macAddress)}`) ?? [] : []),
        ]);
        if (candidates.size !== 1) continue;
        const id = [...candidates][0]!;
        inferredByFogId.set(id, [...(inferredByFogId.get(id) ?? []), row]);
    }
    const computers = hosts.map((host): StoredComputer => {
        if (!host || !Number.isSafeInteger(host.id) || host.id <= 0 || ids.has(host.id) || typeof host.name !== 'string' || !host.name.trim() || host.name.length > 100) throw new Error('FOG returned invalid or duplicate host identities');
        ids.add(host.id);
        const target = qualifyFogHostname(host.name.trim(), typeof suffix === 'function' ? suffix(host) : suffix) || host.ip?.trim() || '';
        if (!validAddress(target) || addresses.has(target.toLowerCase())) throw new Error('FOG returned invalid or ambiguous target addresses');
        addresses.add(target.toLowerCase());
        const macs = [host.primac, ...(host.macs ?? [])].filter((mac): mac is string => typeof mac === 'string' && validMac(mac));
        const old = previousByFogId.get(host.id);
        const linked = linkedByFogId.get(host.id) ?? [];
        if (linked.length > 1) throw new Error('Multiple legacy targets claim the same FOG host');
        // Migrate only unique strong matches. Friendly names alone are not identity evidence.
        const inferred = (inferredByFogId.get(host.id) ?? []).filter((row) => !claimed.has(row.id));
        const match = old ?? linked[0] ?? (inferred.length === 1 ? inferred[0] : undefined);
        const id = match?.id ?? createHash('sha256').update(JSON.stringify([org, source, host.id])).digest('hex').slice(0, 12);
        if (claimed.has(id)) throw new Error('FOG identity mapping is ambiguous');
        claimed.add(id);
        linkedIds.add(id);
        const createdAt = match?.createdAt ? new Date(match.createdAt).toISOString() : now;
        const macAddress = macs[0] ?? null;
        // A non-default Veyon port is integration configuration, not host identity.
        const port = match ? targetPort(match.host) : undefined;
        const connectionHost = port ? `${isIP(target) === 6 ? `[${target}]` : target}:${port}` : target;
        const changed = !old || old.name !== host.name.trim() || old.host !== connectionHost || old.macAddress !== macAddress;
        return { id, organizationId: org, name: host.name.trim(), host: connectionHost, macAddress, location: match?.location ?? null,
            fogHostId: host.id, createdAt, updatedAt: changed ? now : old.updatedAt };
    });
    // Persist the migrated IDs even after deletion so old manual rows cannot resurrect.
    return { hosts, computers, linkedIds: [...linkedIds], updatedAt: now };
}

export function createComputerInventoryProvider(deps: Dependencies) {
    const active = new Map<string, Promise<InventoryResult>>();
    const attempts = new Map<string, { source: string; at: number; warning?: string }>();
    const get = async (org: string, force = false): Promise<InventoryResult> => {
        const pending = active.get(org);
        if (pending) return pending;
        const operation = (async () => {
            const [source, legacy, saved] = await Promise.all([deps.source(org), deps.manual(org), deps.load(org)]);
            const manual = legacy.filter((row) => row.fogHostId == null);
            if (!source) {
                const computers = manual.filter((row) => !saved?.snapshot.linkedIds.includes(row.id));
                deps.reconcile(org, saved ? restore(saved.snapshot.computers) : [], computers);
                return { computers, hosts: [], configured: false };
            }
            let snapshot = saved?.source === source ? saved.snapshot : undefined;
            const previous = saved ? restore(saved.snapshot.computers) : [];
            const attempted = attempts.get(org);
            let warning = attempted?.source === source ? attempted.warning : undefined;
            if (force || !attempted || attempted.source !== source || deps.now() - attempted.at >= 10_000) {
                try {
                    const data = await deps.list(org);
                    if (!Array.isArray(data.hosts) || data.truncated || data.count !== data.hosts.length) throw new Error('Incomplete FOG inventory');
                    const previousHosts = new Map(snapshot?.hosts.map((host) => [host.id, host]));
                    const hosts = data.inventoryWarning ? data.hosts.map((host) => ({ ...host,
                        inventory: host.inventory ?? previousHosts.get(host.id)?.inventory })) : data.hosts;
                    const candidates = saved && saved.source !== source ? legacy.filter((row) => row.fogHostId == null && !saved.snapshot.linkedIds.includes(row.id)) : legacy;
                    const next = buildComputerInventory(org, source, hosts, candidates, snapshot, await deps.suffix(org), new Date(deps.now()).toISOString());
                    next.linkedIds = [...new Set([...(saved?.snapshot.linkedIds ?? []), ...next.linkedIds])];
                    next.inventoryWarning = data.inventoryWarning;
                    await deps.save(org, { source, snapshot: next });
                    snapshot = next;
                    warning = undefined;
                } catch {
                    warning = snapshot ? 'FOG unavailable. Using the last complete inventory; identities may be out of date.' : 'FOG unavailable. No complete inventory is cached; only manual targets are available.';
                }
                attempts.delete(org);
                while (attempts.size >= 128) attempts.delete(attempts.keys().next().value!);
                attempts.set(org, { source, at: deps.now(), warning });
            }
            const computers = [...(snapshot ? restore(snapshot.computers) : []), ...manual.filter((row) =>
                !(snapshot?.linkedIds ?? saved?.snapshot.linkedIds ?? []).includes(row.id))];
            for (const computer of computers) if (!validAddress(computer.host)) throw new Error('Invalid stored target address');
            deps.reconcile(org, previous, computers);
            return { computers, hosts: snapshot?.hosts ?? [], warning: warning ?? snapshot?.inventoryWarning, configured: true };
        })();
        active.set(org, operation);
        try { return await operation; } finally { if (active.get(org) === operation) active.delete(org); }
    };
    return get;
}

export const getComputerInventory = createComputerInventoryProvider({
    source: async (org) => {
        const creds = await getFogCredentials(org);
        return credentialsComplete(creds) ? createHash('sha256').update(creds!.url.replace(/\/$/, '')).digest('hex') : null;
    },
    list: async (org) => {
        const result = await (await getFogClient(org)).listHosts(undefined, true);
        if (!result.success || !result.data) throw new Error('FOG inventory unavailable');
        return result.data;
    },
    manual: (org) => db.query.veyonComputer.findMany({ where: eq(veyonComputer.organizationId, org) }),
    load: (org) => db.query.organizationComputerInventory.findFirst({ where: eq(organizationComputerInventory.organizationId, org) }),
    save: async (org, value) => { await db.insert(organizationComputerInventory).values({ organizationId: org, ...value })
        .onConflictDoUpdate({ target: organizationComputerInventory.organizationId, set: value }); },
    suffix: async (org) => {
        const firewall = await getFirewallConfigWithLabs(org);
        // Lab membership is already resolved by the shared device service. Read
        // its durable observation, not the service itself (which consumes us).
        const cached = await db.query.organizationDeviceCache.findFirst({ where: eq(organizationDeviceCache.organizationId, org) });
        return (host) => {
            const device = cached?.snapshot.devices.find((device) => device.fogHostIds.includes(host.id));
            const lab = firewall?.labs.find((lab) => lab.id === device?.lab?.id);
            return lab?.dnsSuffix || firewall?.defaultDnsSuffix;
        };
    },
    reconcile: (org, previous, next) => {
        const current = new Map(next.map((row) => [row.id, row]));
        const previousById = new Map(previous.map((row) => [row.id, row]));
        for (const row of previous) if (!current.has(row.id)) veyonPoller.forget(org, row.id);
        for (const row of next) {
            const old = previousById.get(row.id);
            if (old && old.host !== row.host) veyonPoller.updateComputer(org, row);
        }
    },
    now: Date.now,
});

export async function resolveVeyonTargets(org: string, ids: string[]) {
    const { computers } = await getComputerInventory(org);
    const byId = new Map(computers.map((row) => [row.id, row]));
    // Reject the entire request before any side effects rather than silently skipping misses.
    const targets = [...new Set(ids)].map((id) => byId.get(id));
    if (targets.some((row) => !row || row.organizationId !== org || !validAddress(row.host))) return null;
    return targets as InventoryComputer[];
}

/** A successful explicit deletion is stronger evidence than an unavailable list. */
export async function removeKnownFogHost(org: string, id: number) {
    const cached = await db.query.organizationComputerInventory.findFirst({ where: eq(organizationComputerInventory.organizationId, org) });
    if (!cached) return;
    const removed = cached.snapshot.computers.filter((computer) => computer.fogHostId === id);
    const snapshot = { ...cached.snapshot,
        hosts: cached.snapshot.hosts.filter((host) => host.id !== id),
        computers: cached.snapshot.computers.filter((computer) => computer.fogHostId !== id),
        updatedAt: new Date().toISOString(),
    };
    await db.update(organizationComputerInventory).set({ snapshot }).where(eq(organizationComputerInventory.organizationId, org));
    for (const computer of removed) veyonPoller.forget(org, computer.id);
}
