// Pure FOG → Veyon sync planning. Structural input types keep this module
// unit-testable without database or FOG client imports; FogHost from
// ../frontend/src/api is assignable to SyncFogHost. The shared plan contract
// lives in the frontend API module (same precedent as backend/fog.ts).

import type { VeyonSyncPlan } from '../frontend/src/api/veyon';

export type { VeyonSyncPlan };

export interface SyncFogHost {
    id: number;
    name: string;
    ip?: string | null;
    primac?: string | null;
    macs?: string[] | null;
}

export interface SyncComputerRow {
    id: string;
    name: string;
    host: string;
    macAddress?: string | null;
    fogHostId?: number | null;
}

// Mirrors hostSchema / computerBodySchema in routes/veyon.ts. Kept as local
// constants so this module stays dependency-light.
const HOST_PATTERN = /^[a-zA-Z0-9._:[\]-]+$/;
const HOST_MAX_LENGTH = 255;
const NAME_MAX_LENGTH = 100;
const MAC_PATTERN = /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/;

export function normalizeMac(mac: string): string {
    return mac.toLowerCase().replace(/[:\-.]/g, '');
}

function hostWithoutPort(host: string): string {
    // Bracketed IPv6 ([::1] or [::1]:11100): strip brackets and optional port.
    if (host.startsWith('[')) {
        const closing = host.indexOf(']');
        return closing === -1 ? host : host.slice(1, closing);
    }
    const firstColon = host.indexOf(':');
    if (firstColon === -1) return host;
    // More than one colon means a bare IPv6 literal; never strip anything.
    if (host.indexOf(':', firstColon + 1) !== -1) return host;
    // Exactly one colon with an all-digit suffix is host:port.
    return /^\d+$/.test(host.slice(firstColon + 1)) ? host.slice(0, firstColon) : host;
}

function fogMacs(host: SyncFogHost): Set<string> {
    const macs = new Set<string>();
    if (host.primac) macs.add(normalizeMac(host.primac));
    for (const mac of host.macs ?? []) {
        if (mac) macs.add(normalizeMac(mac));
    }
    return macs;
}

type TierPredicate = (host: SyncFogHost, computer: SyncComputerRow) => boolean;

const tiers: TierPredicate[] = [
    (host, computer) => computer.fogHostId != null && computer.fogHostId === host.id,
    (host, computer) => {
        if (!computer.macAddress) return false;
        return fogMacs(host).has(normalizeMac(computer.macAddress));
    },
    (host, computer) => {
        const value = hostWithoutPort(computer.host).toLowerCase();
        return (
            value === host.name.toLowerCase() ||
            (Boolean(host.ip) && value === host.ip!.toLowerCase())
        );
    },
    (host, computer) =>
        Boolean(host.name) && computer.name.toLowerCase() === host.name.toLowerCase(),
];

export function buildVeyonSyncPlan(
    fogHosts: SyncFogHost[],
    computers: SyncComputerRow[],
): VeyonSyncPlan {
    // Tier matching runs globally per tier so higher-priority rules win;
    // each host and computer matches at most once.
    const matches = new Map<number, { host: SyncFogHost; computer: SyncComputerRow }>();
    const matchedHostIds = new Set<number>();
    const matchedComputerIds = new Set<string>();
    for (const matchesTier of tiers) {
        for (const host of fogHosts) {
            if (matchedHostIds.has(host.id)) continue;
            const computer = computers.find(
                (candidate) =>
                    !matchedComputerIds.has(candidate.id) &&
                    matchesTier(host, candidate),
            );
            if (!computer) continue;
            matchedHostIds.add(host.id);
            matchedComputerIds.add(computer.id);
            matches.set(host.id, { host, computer });
        }
    }

    const plan: VeyonSyncPlan = {
        additions: [],
        renames: [],
        removals: [],
        links: [],
        unchanged: 0,
        unmanaged: [],
        warnings: [],
    };

    for (const { host, computer } of matches.values()) {
        if (computer.name !== host.name) {
            plan.renames.push({
                computerId: computer.id,
                fogHostId: host.id,
                currentName: computer.name,
                newName: host.name,
                host: computer.host,
            });
        } else if (computer.fogHostId !== host.id) {
            plan.links.push({ computerId: computer.id, fogHostId: host.id });
        } else {
            plan.unchanged += 1;
        }
    }

    // Additions dedupe hosts case-insensitively against existing computers
    // and earlier additions (organizationId+host is unique). FOG-supplied
    // values are untrusted: validate them exactly like the manual computer
    // route would before they are persisted or flow into veyon-cli spawns.
    const takenHosts = new Set(computers.map((computer) => computer.host.toLowerCase()));
    for (const host of fogHosts) {
        if (matchedHostIds.has(host.id)) continue;
        const name = host.name.trim();
        if (name.length < 1 || name.length > NAME_MAX_LENGTH) {
            plan.warnings.push(
                `Skipped FOG host ${host.id}: name must be 1-${NAME_MAX_LENGTH} characters after trimming`,
            );
            continue;
        }
        const fallbackHost = host.name.trim() || host.ip?.trim() || '';
        if (!fallbackHost) {
            plan.warnings.push(
                `FOG host ${host.id} has no name or IP address and cannot be added`,
            );
            continue;
        }
        // Leading dashes would become CLI flags in Bun.spawn argument lists.
        if (fallbackHost.startsWith('-')) {
            plan.warnings.push(
                `Skipped FOG host "${name}" (${host.id}): host address "${fallbackHost}" must not start with "-"`,
            );
            continue;
        }
        if (fallbackHost.length > HOST_MAX_LENGTH || !HOST_PATTERN.test(fallbackHost)) {
            plan.warnings.push(
                `Skipped FOG host "${name}" (${host.id}): invalid host address "${fallbackHost}"`,
            );
            continue;
        }
        const rawMac = host.primac?.trim() || host.macs?.find((mac) => mac?.trim()) || null;
        let macAddress: string | null = null;
        if (rawMac) {
            if (!rawMac.startsWith('-') && MAC_PATTERN.test(rawMac)) {
                macAddress = rawMac;
            } else {
                // An invalid MAC never blocks the addition; it is dropped.
                plan.warnings.push(
                    `Ignoring invalid MAC address "${rawMac}" for FOG host "${name}" (${host.id})`,
                );
            }
        }
        if (takenHosts.has(fallbackHost.toLowerCase())) {
            plan.warnings.push(
                `Skipped FOG host "${name || host.id}": host address "${fallbackHost}" collides with an existing computer`,
            );
            continue;
        }
        takenHosts.add(fallbackHost.toLowerCase());
        plan.additions.push({
            fogHostId: host.id,
            name,
            host: fallbackHost,
            macAddress,
            location: null,
        });
    }

    for (const computer of computers) {
        if (matchedComputerIds.has(computer.id)) continue;
        // Removals only for persisted links whose FOG host disappeared;
        // inferred matches that were lost simply become unmanaged.
        if (
            computer.fogHostId != null &&
            !fogHosts.some((host) => host.id === computer.fogHostId)
        ) {
            plan.removals.push({
                computerId: computer.id,
                name: computer.name,
                host: computer.host,
                fogHostId: computer.fogHostId,
                reason: 'fog-host-deleted',
            });
        } else {
            plan.unmanaged.push({
                computerId: computer.id,
                name: computer.name,
                host: computer.host,
            });
        }
    }

    return plan;
}
