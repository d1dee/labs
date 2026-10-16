import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { eq, lte } from 'drizzle-orm';
import { db } from '../db/database';
import { organizationDeviceCache, organizationDeviceLab, veyonComputer } from '../db/schema';
import { formatDeviceHost, normalizeDeviceHost, normalizeDeviceMac, type DeviceDirectory, type DeviceIdentity, type DeviceSource } from '../frontend/src/api/devices';
import { getFirewallConfigWithLabs } from './firewall-config';
import { credentialsComplete, getFogClient, getFogConfigForOrg } from './fog';
import { addressInSubnet, callMikrotik, getDHCPLeases } from './mikrotik';
import { getPiholeClient, getPiholeConfigForOrg } from './pihole';
import type { ComputerLocationLab, ComputerLocationLease } from './veyon-locations';

type RouterRow = ComputerLocationLease & { 'host-name'?: string; published?: boolean | string; interface?: string };
type FogRow = { id: number; name: string; ip?: string; primac?: string; macs?: Array<string | { mac: string }> };
type ComputerRow = { id: string; name: string; host: string; macAddress: string | null; location: string | null; fogHostId: number | null };
const sourceNames: DeviceSource[] = ['dhcp', 'arp', 'fog', 'veyon', 'pihole'];

export interface DeviceDirectoryInput {
    organizationId: string;
    updatedAt?: string;
    labs?: (ComputerLocationLab & { dnsSuffix?: string | null })[];
    defaultDnsSuffix?: string;
    leases?: RouterRow[];
    /** The full lease read succeeded, even though the returned inventory is organization-scoped. */
    dhcpComplete?: boolean;
    arp?: RouterRow[];
    fogHosts?: FogRow[];
    computers?: ComputerRow[];
    piholeHosts?: string[];
    piholeClients?: Array<{ ip: string; name: string }>;
    sources?: DeviceDirectory['sources'];
    retainedLabs?: Array<typeof organizationDeviceLab.$inferSelect>;
    onLabObservation?: (entry: typeof organizationDeviceLab.$inferSelect) => void;
}

type Observation = {
    source: DeviceSource; names: string[]; addresses: string[]; macs: string[];
    displayNames?: string[];
    fogIds: number[]; veyonIds: string[]; location?: string | null;
    server?: string; historical?: boolean; invalidMac?: boolean;
};
const unique = <T>(values: T[]) => [...new Set(values)];
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const host = (value: unknown) => normalizeDeviceHost(text(value));
const names = (values: unknown[]) => {
    const displayNames = new Map<string, string>();
    for (const value of values) {
        const normalized = host(value);
        if (normalized && !isIP(normalized) && !displayNames.has(normalized)) {
            displayNames.set(normalized, formatDeviceHost(text(value)));
        }
    }
    return { names: [...displayNames.keys()], displayNames: [...displayNames.values()] };
};
const addresses = (values: unknown[]) => unique(values.map(host).filter((value) => isIP(value)));
const macs = (values: unknown[]) => unique(values.map((value) => normalizeDeviceMac(text(value))).filter(Boolean));
const flag = (value: unknown) => value === true || value === 'true';

/** Strong links are grouped first; weak links must be globally unique and noncontradictory. */
export function buildDeviceDirectory(input: DeviceDirectoryInput): DeviceDirectory {
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    // Advance durable ordering even when refreshes share a millisecond or the clock moves back.
    const observedAt = (input.retainedLabs ?? []).filter((entry) => entry.organizationId === input.organizationId)
        .reduce((time, entry) => Math.max(time, entry.observedAt + 1), Date.parse(updatedAt));
    const configured = { dhcp: input.leases, arp: input.arp, fog: input.fogHosts, veyon: input.computers, pihole: input.piholeHosts ?? input.piholeClients };
    const sources = input.sources ?? Object.fromEntries(sourceNames.map((source) => [source, {
        state: configured[source] === undefined ? 'unconfigured' : 'available',
        updatedAt: configured[source] === undefined ? null : updatedAt,
    }])) as DeviceDirectory['sources'];
    const observations: Observation[] = [];
    const knownMacs = new Set(macs([
        ...(input.computers ?? []).map((computer) => computer.macAddress),
        ...(input.fogHosts ?? []).flatMap((computer) => [computer.primac,
            ...(Array.isArray(computer.macs) ? computer.macs.map((entry) => typeof entry === 'string' ? entry : entry?.mac) : [])]),
    ]));
    const add = (row: Observation) => {
        if (row.names.length || row.addresses.length || row.macs.length || row.fogIds.length || row.veyonIds.length) observations.push(row);
    };
    for (const row of input.leases ?? []) {
        if (!row || row.status !== 'bound' || flag(row.disabled) || flag(row.invalid)) continue;
        const server = text(row['active-server'] || row.server);
        const leaseAddresses = addresses([row['active-address'] || row.address]);
        const leaseMacs = macs([row['active-mac-address'] || row['mac-address']]);
        if (input.labs !== undefined && !leaseMacs.some((mac) => knownMacs.has(mac)) && !input.labs.some((lab) =>
            lab.subnet ? leaseAddresses.some((address) => addressInSubnet(address, lab.subnet!))
                : lab.dhcpServer && lab.dhcpServer === server)) continue;
        add({ source: 'dhcp', ...names([row['host-name']]), addresses: leaseAddresses,
            macs: leaseMacs,
            server, fogIds: [], veyonIds: [] });
    }
    for (const row of input.arp ?? []) {
        if (!row || !['reachable', 'delay', 'probe'].includes(row.status ?? '') || flag(row.disabled) || flag(row.invalid) || flag(row.published)) continue;
        // Router credentials may see several organizations. Only assigned lab scopes are ours.
        if (input.labs !== undefined && !macs([row['mac-address']]).some((mac) => knownMacs.has(mac)) && !input.labs.some((lab) => {
            if (lab.interface && row.interface !== lab.interface) return false;
            if (lab.subnet && !addressInSubnet(text(row.address), lab.subnet)) return false;
            if (lab.interface || lab.subnet) return true;
            return observations.some((lease) => lease.source === 'dhcp' && lease.server === lab.dhcpServer && lease.addresses.includes(text(row.address)));
        })) continue;
        add({ source: 'arp', names: [], addresses: addresses([row.address]), macs: macs([row['mac-address']]), fogIds: [], veyonIds: [] });
    }
    for (const row of input.fogHosts ?? []) {
        if (!row) continue;
        add({ source: 'fog', ...names([row.name]), addresses: addresses([row.ip]),
            macs: macs([row.primac, ...(Array.isArray(row.macs) ? row.macs.map((entry) => typeof entry === 'string' ? entry : entry?.mac) : [])]),
            fogIds: Number.isFinite(Number(row.id)) ? [Number(row.id)] : [], veyonIds: [] });
    }
    for (const row of input.computers ?? []) {
        // The directory name is a friendly label, not evidence of a DNS hostname.
        add({ source: 'veyon', ...names([row.host]), addresses: addresses([row.host]),
            macs: macs([row.macAddress]), fogIds: row.fogHostId === null ? [] : [row.fogHostId],
            veyonIds: [row.id], location: row.location,
            invalidMac: Boolean(row.macAddress && !normalizeDeviceMac(row.macAddress)) });
    }
    for (const line of input.piholeHosts ?? []) {
        if (typeof line !== 'string') continue;
        const [address, ...aliases] = line.trim().split(/\s+/);
        if (!addresses([address]).length) continue;
        add({ source: 'pihole', ...names(aliases), addresses: addresses([address]), macs: [], fogIds: [], veyonIds: [] });
    }
    for (const row of input.piholeClients ?? []) {
        add({ source: 'pihole', ...names([row.name]), addresses: addresses([row.ip]), macs: [], fogIds: [], veyonIds: [], historical: true });
    }
    let groups = observations.map((row) => [row]);
    const network = observations.filter((row) => row.source === 'dhcp' || row.source === 'arp');
    const liveAddresses = new Set(network.flatMap((row) => row.addresses));
    const keys = (group: Observation[], field: 'macs' | 'fogIds' | 'names' | 'addresses') => {
        const live = field === 'addresses' ? group.filter((row) => row.source === 'dhcp' || row.source === 'arp') : [];
        return unique((live.length ? live : group).flatMap((row) => {
            if (field !== 'addresses' || live.length) return row[field] as Array<string | number>;
            return row.addresses.filter((address) => {
                if (!liveAddresses.has(address)) return true;
                if (row.source === 'fog' || (row.source === 'veyon' && row.macs.length)) return false;
                const currentNames = network.filter((entry) => entry.addresses.includes(address)).flatMap((entry) => entry.names);
                return !row.historical || !row.names.length || !currentNames.length || row.names.some((name) => currentNames.includes(name));
            });
        }));
    };
    const intersects = (a: Array<string | number>, b: Array<string | number>) => a.some((key) => b.includes(key));
    const targetConflict = (group: Observation[], linkedMacs: Array<string | number>) => group.some((row) =>
        row.source === 'veyon' && !row.macs.length && row.addresses.some((address) => {
            const owners = unique(network.filter((entry) => entry.addresses.includes(address)).flatMap((entry) => entry.macs));
            return owners.length > 1 || (owners.length === 1 && linkedMacs.length > 0 && !intersects(owners, linkedMacs));
        }));
    for (let i = 0; i < groups.length; i++) {
        for (let j = i + 1; j < groups.length; j++) {
            const a = keys(groups[i]!, 'macs'); const b = keys(groups[j]!, 'macs');
            const sharedMac = intersects(a, b);
            if (sharedMac || ((!a.length || !b.length) && ![...groups[i]!, ...groups[j]!].some((row) => row.invalidMac) &&
                !targetConflict(groups[i]!, b) && !targetConflict(groups[j]!, a) &&
                intersects(keys(groups[i]!, 'fogIds'), keys(groups[j]!, 'fogIds')))) {
                groups[i]!.push(...groups.splice(j, 1)[0]!);
                // A newly joined group can bridge a group visited earlier.
                i = -1;
                break;
            }
        }
    }
    let changed = true;
    const dnsAliases = (group: Observation[]) => group.every((row) => row.source === 'pihole' && !row.historical);
    while (changed) {
        changed = false;
        const index = (field: 'names' | 'addresses') => {
            const result = new Map<string | number, Set<Observation[]>>();
            for (const group of groups) for (const key of keys(group, field)) {
                const matches = result.get(key) ?? new Set();
                matches.add(group); result.set(key, matches);
            }
            return result;
        };
        const byName = index('names'); const byAddress = index('addresses');
        const unambiguous = (matches: Set<Observation[]> | undefined) => {
            if (!matches || [...matches].filter((group) => keys(group, 'macs').length).length > 1) return false;
            const rows = [...matches];
            for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
                for (const field of ['names', 'addresses'] as const) {
                    if (field === 'names' && (dnsAliases(rows[i]!) || dnsAliases(rows[j]!))) continue;
                    const a = keys(rows[i]!, field); const b = keys(rows[j]!, field);
                    if (a.length && b.length && !intersects(a, b)) return false;
                }
            }
            return true;
        };
        for (let i = 0; i < groups.length && !changed; i++) for (let j = i + 1; j < groups.length; j++) {
            const a = groups[i]!; const b = groups[j]!;
            if ([...a, ...b].some((row) => row.invalidMac)) continue;
            const am = keys(a, 'macs'); const bm = keys(b, 'macs');
            if (am.length && bm.length) continue;
            const an = keys(a, 'names'); const bn = keys(b, 'names');
            const aa = keys(a, 'addresses'); const ba = keys(b, 'addresses');
            const nameMatch = an.some((key) => bn.includes(key) && unambiguous(byName.get(key)));
            const addressMatch = aa.some((key) => ba.includes(key) && unambiguous(byAddress.get(key)));
            if (!nameMatch && !addressMatch) continue;
            if (an.length && bn.length && !intersects(an, bn) && !dnsAliases(a) && !dnsAliases(b)) continue;
            if (aa.length && ba.length && !intersects(aa, ba)) continue;
            // Explicit current DNS aliases may differ from DHCP names, but cannot steal another device's name.
            const aliasConflict = (aliases: Observation[], current: Observation[]) => dnsAliases(aliases) && keys(aliases, 'names').some((name) =>
                [...(byName.get(name) ?? [])].some((candidate) => candidate !== aliases && candidate !== current &&
                    keys(candidate, 'macs').length && !intersects(keys(candidate, 'macs'), keys(current, 'macs'))));
            if (aliasConflict(a, b) || aliasConflict(b, a)) continue;
            // Historical observations must not introduce aliases into a current named identity.
            const historicalConflict = (old: Observation[], current: Observation[]) => old.some((row) => row.historical && row.names.some((name) => {
                const authoritative = current.filter((entry) => !entry.historical).flatMap((entry) => entry.names);
                return authoritative.length > 0 && !authoritative.includes(name);
            }));
            if (historicalConflict(a, b) || historicalConflict(b, a)) continue;
            a.push(...groups.splice(j, 1)[0]!); changed = true; break;
        }
    }
    const priority: Record<DeviceSource, number> = { dhcp: 0, fog: 1, veyon: 2, arp: 3, pihole: 4 };
    const devices: DeviceIdentity[] = groups.map((group) => {
        const ordered = [...group].sort((a, b) => Number(Boolean(a.historical)) - Number(Boolean(b.historical)) || priority[a.source] - priority[b.source]);
        const live = group.filter((row) => row.source === 'dhcp' || row.source === 'arp');
        const deviceAddresses = unique((live.length ? live : ordered).flatMap((row) => row.addresses))
            .filter((address) => live.length || !liveAddresses.has(address)).sort();
        const deviceMacs = keys(group, 'macs') as string[];
        const fogHostIds = (keys(group, 'fogIds') as number[]).sort((a, b) => a - b);
        const veyonComputerIds = unique(group.flatMap((row) => row.veyonIds)).sort();
        // Keep the preferred source's spelling, deduplicating by DNS identity.
        const hostnameVariants = new Map<string, string>();
        for (const row of ordered.filter((row) => !row.historical || !live.length)) {
            for (const name of row.displayNames ?? row.names) {
                const normalized = host(name);
                if (!hostnameVariants.has(normalized)) hostnameVariants.set(normalized, name);
            }
        }
        const hostnames = [...hostnameVariants.values()];
        const matches = new Map<string, ComputerLocationLab>();
        if (!group.some((row) => row.invalidMac)) for (const lab of input.labs ?? []) {
            if (lab.subnet && deviceAddresses.some((address) => addressInSubnet(address, lab.subnet!))) matches.set(lab.id, lab);
        }
        // Server-based detection is a fallback for labs without a usable address match.
        if (!matches.size && (input.dhcpComplete ?? sources.dhcp.state === 'available')) for (const row of group.filter((entry) => entry.source === 'dhcp')) {
            for (const lab of input.labs ?? []) if (row.addresses.length && lab.dhcpServer && row.server === lab.dhcpServer &&
                (!lab.subnet || row.addresses.some((address) => addressInSubnet(address, lab.subnet!)))) matches.set(lab.id, lab);
        }
        let lab = matches.size === 1 ? [...matches.values()][0]! : null;
        const inventory = group.filter((row) => row.source === 'veyon' || row.source === 'fog');
        // Use each inventory record's own hardware, not MACs learned through an IP/name join.
        const fingerprints = group.some((row) => row.invalidMac) ? [] : inventory.filter((row) => row.macs.length).map((row) => ({
            fingerprint: createHash('sha256').update(JSON.stringify([row.source, row.source === 'veyon' ? row.veyonIds : row.fogIds, [...row.macs].sort()])).digest('hex'),
            observed: live.some((current) => current.macs.some((mac) => row.macs.includes(mac))),
        }));
        if (!live.length && inventory.length) {
            const retained = (input.retainedLabs ?? []).filter((entry) => entry.organizationId === input.organizationId && fingerprints.some((key) => key.fingerprint === entry.fingerprint));
            const latest = retained.reduce((time, entry) => Math.max(time, entry.observedAt), 0);
            const labIds = unique(retained.filter((entry) => entry.observedAt === latest).map((entry) => entry.labId));
            lab = labIds.length === 1 ? (input.labs ?? []).find((item) => item.id === labIds[0]) ?? null : null;
        }
        if (live.length && input.labs !== undefined) for (const { fingerprint, observed } of fingerprints) {
            // A null observation also replaces history, preventing resurrection after ambiguity or a move outside labs.
            input.onLabObservation?.({ organizationId: input.organizationId, fingerprint, labId: observed ? lab?.id ?? null : null,
                observedAt });
        }
        const hostname = hostnames[0] ?? null;
        const displaySuffix = [input.defaultDnsSuffix, ...(input.labs ?? []).map((item) => item.dnsSuffix)]
            .filter((suffix): suffix is string => Boolean(suffix))
            .sort((a, b) => b.length - a.length)
            .find((suffix) => hostname?.toLowerCase().endsWith(`.${suffix.toLowerCase()}`));
        const manual = unique(group.map((row) => row.location).filter((value): value is string => Boolean(value)));
        const id = veyonComputerIds.length ? `veyon:${veyonComputerIds[0]}` : fogHostIds.length ? `fog:${fogHostIds[0]}` : deviceMacs.length ? `mac:${[...deviceMacs].sort()[0]}` : `observed:${createHash('sha256').update(JSON.stringify([[...hostnameVariants.keys()].sort(), deviceAddresses])).digest('hex').slice(0, 20)}`;
        return { id, hostname: displaySuffix ? hostname!.slice(0, -(displaySuffix.length + 1)) : hostname, hostnames, addresses: deviceAddresses,
            macAddresses: deviceMacs.sort(), lab: lab ? { id: lab.id, name: lab.name, dhcpServer: lab.dhcpServer } : null,
            location: lab?.name ?? (manual.length === 1 ? manual[0]! : null), sources: unique(ordered.map((row) => row.source)), veyonComputerIds, fogHostIds };
    });
    return { organizationId: input.organizationId, updatedAt, devices: devices.sort((a, b) => a.id.localeCompare(b.id)), sources,
        labs: (input.labs ?? []).map(({ id, name, dhcpServer, subnet }) => ({ id, name, dhcpServer, subnet })) };
}

const dependencies = {
    loadFirewall: getFirewallConfigWithLabs,
    loadFogConfig: getFogConfigForOrg,
    loadPiholeConfig: getPiholeConfigForOrg,
    loadComputers: async (organizationId: string) => db.query.veyonComputer.findMany({ where: eq(veyonComputer.organizationId, organizationId) }),
    getDHCPLeases, callMikrotik, getFogClient, getPiholeClient,
    loadCache: async (organizationId: string) => db.query.organizationDeviceCache.findFirst({
        where: eq(organizationDeviceCache.organizationId, organizationId),
    }),
    saveCache: async (entry: typeof organizationDeviceCache.$inferInsert) => {
        db.insert(organizationDeviceCache).values(entry).onConflictDoUpdate({
            target: organizationDeviceCache.organizationId,
            set: { signature: entry.signature, expiresAt: entry.expiresAt, snapshot: entry.snapshot },
        }).run();
    },
    deleteCache: (organizationId: string) => {
        db.delete(organizationDeviceCache).where(eq(organizationDeviceCache.organizationId, organizationId)).run();
    },
    loadRetainedLabs: async (organizationId: string) => db.query.organizationDeviceLab.findMany({
        where: eq(organizationDeviceLab.organizationId, organizationId),
    }),
    saveRetainedLabs: async (entries: Array<typeof organizationDeviceLab.$inferSelect>) => {
        if (!entries.length) return;
        db.transaction((tx) => {
            for (const entry of entries) tx.insert(organizationDeviceLab).values(entry).onConflictDoUpdate({
                target: [organizationDeviceLab.organizationId, organizationDeviceLab.fingerprint],
                set: { labId: entry.labId, observedAt: entry.observedAt },
                setWhere: lte(organizationDeviceLab.observedAt, entry.observedAt),
            }).run();
        });
    },
    now: () => Date.now(),
};

/** Each service has a bounded cache; production uses the single shared instance below. */
export function createOrganizationDeviceService(overrides: Partial<typeof dependencies> = {}) {
    const deps = { ...dependencies, ...overrides };
    const cache = new Map<string, { signature: string; expiresAt: number; snapshot: Promise<DeviceDirectory> }>();
    const activeRequests = new Map<string, Set<{ invalidated: boolean }>>();
    const attempt = async <T>(read: () => T | Promise<T>) => {
        try { return { ok: true as const, value: await read() }; }
        catch { return { ok: false as const }; }
    };
    const getSnapshot = async (organizationId: string, request: { invalidated: boolean }): Promise<DeviceDirectory> => {
        // Re-read persisted settings and directory rows, including updatedAt and credentials,
        // before cache lookup. Hashing keeps secrets out of retained signatures and responses.
        const [firewall, fog, pihole, computers] = await Promise.all([
            attempt(() => deps.loadFirewall(organizationId)), attempt(() => deps.loadFogConfig(organizationId)),
            attempt(() => deps.loadPiholeConfig(organizationId)), attempt(() => deps.loadComputers(organizationId)),
        ]);
        const signature = createHash('sha256').update(JSON.stringify([7, firewall, fog, pihole, computers])).digest('hex');
        const now = deps.now();
        for (const [org, entry] of cache) if (entry.expiresAt <= now) cache.delete(org);
        const cached = cache.get(organizationId);
        if (cached?.signature === signature) return cached.snapshot;
        const snapshot = (async () => {
            const persisted = await attempt(() => deps.loadCache(organizationId));
            if (persisted.ok && persisted.value?.signature === signature && persisted.value.expiresAt > deps.now() &&
                persisted.value.snapshot.organizationId === organizationId) {
                const entry = cache.get(organizationId);
                if (entry?.signature === signature && !request.invalidated) entry.expiresAt = persisted.value.expiresAt;
                return persisted.value.snapshot;
            }
            const updatedAt = new Date(now).toISOString();
            const sources = Object.fromEntries(sourceNames.map((source) => [source, { state: 'unconfigured', updatedAt: null }])) as DeviceDirectory['sources'];
            const input: DeviceDirectoryInput = { organizationId, updatedAt, sources };
            const mark = (source: DeviceSource, state: DeviceDirectory['sources'][DeviceSource]['state']) => {
                sources[source] = { state, updatedAt: state === 'available' || state === 'partial' ? updatedAt : null };
            };
            if (computers.ok) { input.computers = computers.value; mark('veyon', 'available'); }
            else mark('veyon', 'unavailable');
            if (firewall.ok) input.labs = firewall.value?.labs ?? [];
            const config = firewall.ok ? firewall.value : undefined;
            input.defaultDnsSuffix = config?.defaultDnsSuffix;
            const routerConfigured = Boolean(config?.mikrotikBaseUrl && config.mikrotikUsername && config.mikrotikPassword);
            const hasDeviceScope = (input.labs ?? []).some((lab) => lab.subnet || lab.interface || lab.dhcpServer) ||
                (input.computers ?? []).some((computer) => Boolean(normalizeDeviceMac(computer.macAddress ?? ''))) || credentialsComplete(fog.ok ? fog.value : undefined);
            await Promise.all([
                (async () => {
                    if (!firewall.ok) { mark('dhcp', 'unavailable'); return; }
                    if (!routerConfigured || !hasDeviceScope) return;
                    // Server names can change; scope the response by lab ranges and known device MACs before persistence.
                    const response = await attempt(() => deps.getDHCPLeases(organizationId));
                    input.dhcpComplete = response.ok && response.value.success && Array.isArray(response.value.data);
                    if (input.dhcpComplete && response.ok) input.leases = response.value.data;
                    mark('dhcp', input.dhcpComplete ? 'partial' : 'unavailable');
                })(),
                (async () => {
                    if (!firewall.ok) { mark('arp', 'unavailable'); return; }
                    if (!routerConfigured || !hasDeviceScope) return;
                    const response = await attempt(() => deps.callMikrotik(organizationId, '/ip/arp'));
                    if (response.ok && response.value.success && Array.isArray(response.value.data)) { input.arp = response.value.data; mark('arp', 'partial'); }
                    else mark('arp', 'unavailable');
                })(),
                (async () => {
                    if (!fog.ok) { mark('fog', 'unavailable'); return; }
                    if (!credentialsComplete(fog.value)) return;
                    const response = await attempt(async () => (await deps.getFogClient(organizationId)).listHosts());
                    if (response.ok && response.value.success && Array.isArray(response.value.data?.hosts)) {
                        const data = response.value.data!;
                        input.fogHosts = data.hosts;
                        const envelope = data as typeof data & { truncated?: boolean; nextUrl?: string };
                        mark('fog', data.count > data.hosts.length || envelope.truncated || envelope.nextUrl ? 'partial' : 'available');
                    } else mark('fog', 'unavailable');
                })(),
                (async () => {
                    if (!pihole.ok) { mark('pihole', 'unavailable'); return; }
                    if (!pihole.value?.url || !pihole.value.password) return;
                    const client = await attempt(() => deps.getPiholeClient(organizationId));
                    if (!client.ok) { mark('pihole', 'unavailable'); return; }
                    const [hosts, queries] = await Promise.all([
                        attempt(() => client.value.getDnsList('hosts')), attempt(() => client.value.getQueries(200)),
                    ]);
                    let good = 0;
                    if (hosts.ok && hosts.value.success && Array.isArray(hosts.value.data?.items)) { input.piholeHosts = hosts.value.data!.items; good++; }
                    if (queries.ok && queries.value.success && Array.isArray(queries.value.data?.queries)) {
                        input.piholeClients = queries.value.data!.queries.map((query) => query.client).filter(Boolean); good++;
                    }
                    // Query clients are a bounded historical sample, not a complete inventory.
                    mark('pihole', good ? 'partial' : 'unavailable');
                })(),
            ]);
            const retained = await attempt(() => deps.loadRetainedLabs(organizationId));
            if (retained.ok) input.retainedLabs = retained.value;
            const observations: Array<typeof organizationDeviceLab.$inferSelect> = [];
            input.onLabObservation = (entry) => { observations.push(entry); };
            const directory = buildDeviceDirectory(input);
            if (!request.invalidated) {
                await attempt(() => deps.saveRetainedLabs(observations));
            }
            if (!request.invalidated) {
                await attempt(() => deps.saveCache({ organizationId, signature,
                    expiresAt: now + 30_000, snapshot: directory }));
            }
            return directory;
        })();
        if (!request.invalidated) {
            cache.delete(organizationId);
            while (cache.size >= 128) cache.delete(cache.keys().next().value!);
            cache.set(organizationId, { signature, expiresAt: now + 30_000, snapshot });
        }
        return snapshot;
    };
    const get = async (organizationId: string): Promise<DeviceDirectory> => {
        const request = { invalidated: false };
        const active = activeRequests.get(organizationId) ?? new Set();
        active.add(request);
        activeRequests.set(organizationId, active);
        try { return await getSnapshot(organizationId, request); }
        finally {
            active.delete(request);
            if (!active.size) activeRequests.delete(organizationId);
        }
    };
    return Object.assign(get, { invalidate: (organizationId: string) => {
        for (const request of activeRequests.get(organizationId) ?? []) request.invalidated = true;
        cache.delete(organizationId);
        deps.deleteCache(organizationId);
    } });
}

const organizationDeviceService = createOrganizationDeviceService();
export const getOrganizationDevices: (organizationId: string) => Promise<DeviceDirectory> = organizationDeviceService;
export const invalidateOrganizationDevices = organizationDeviceService.invalidate;
