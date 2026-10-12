export type DeviceSource = 'dhcp' | 'arp' | 'fog' | 'veyon' | 'pihole';

export interface DeviceIdentity {
    id: string;
    hostname: string | null;
    hostnames: string[];
    addresses: string[];
    macAddresses: string[];
    lab: { id: string; name: string; dhcpServer: string } | null;
    location: string | null;
    sources: DeviceSource[];
    veyonComputerIds: string[];
    fogHostIds: number[];
}

export interface DeviceDirectory {
    organizationId: string;
    updatedAt: string;
    devices: DeviceIdentity[];
    sources: Record<DeviceSource, {
        state: 'available' | 'unconfigured' | 'unavailable' | 'partial';
        updatedAt: string | null;
    }>;
}

export interface DeviceLookup {
    address?: string | null;
    hostname?: string | null;
    macAddress?: string | null;
    veyonComputerId?: string;
    fogHostId?: number;
}

export function normalizeDeviceMac(value: string) {
    const mac = value.toLowerCase().replace(/[:.\-]/g, '');
    return /^[0-9a-f]{12}$/.test(mac) ? mac : '';
}

export function normalizeDeviceHost(value: string) {
    const host = value.trim().toLowerCase().replace(/\.$/, '');
    if (host.startsWith('[')) return host.slice(1, host.indexOf(']') === -1 ? undefined : host.indexOf(']'));
    return host.indexOf(':') === host.lastIndexOf(':') ? host.replace(/:\d+$/, '') : host;
}

/** Build once per snapshot. Conflicting identities are never resolved by first match. */
export function createDeviceIdentityLookup(devices: DeviceIdentity[]) {
    const indexes = {
        address: new Map<string, Set<DeviceIdentity>>(),
        hostname: new Map<string, Set<DeviceIdentity>>(),
        macAddress: new Map<string, Set<DeviceIdentity>>(),
        veyonComputerId: new Map<string, Set<DeviceIdentity>>(),
        fogHostId: new Map<string, Set<DeviceIdentity>>(),
    };
    const add = (index: Map<string, Set<DeviceIdentity>>, key: string, device: DeviceIdentity) => {
        if (!key) return;
        const matches = index.get(key) ?? new Set<DeviceIdentity>();
        matches.add(device);
        index.set(key, matches);
    };
    for (const device of devices) {
        for (const address of device.addresses) add(indexes.address, normalizeDeviceHost(address), device);
        for (const hostname of [device.hostname, ...device.hostnames]) {
            if (hostname) add(indexes.hostname, normalizeDeviceHost(hostname), device);
        }
        for (const mac of device.macAddresses) add(indexes.macAddress, normalizeDeviceMac(mac), device);
        for (const id of device.veyonComputerIds) add(indexes.veyonComputerId, id, device);
        for (const id of device.fogHostIds) add(indexes.fogHostId, String(id), device);
    }
    const unique = (matches: Set<DeviceIdentity> | undefined) => matches?.size === 1 ? matches.values().next().value ?? null : null;
    return (lookup: DeviceLookup): DeviceIdentity | null => {
        if (lookup.veyonComputerId || lookup.fogHostId !== undefined) {
            const device = lookup.veyonComputerId ? unique(indexes.veyonComputerId.get(lookup.veyonComputerId))
                : unique(indexes.fogHostId.get(String(lookup.fogHostId)));
            return device && (!lookup.macAddress || device.macAddresses.some((mac) => normalizeDeviceMac(mac) === normalizeDeviceMac(lookup.macAddress!))) ? device : null;
        }
        if (lookup.macAddress) return unique(indexes.macAddress.get(normalizeDeviceMac(lookup.macAddress)));
        const named = lookup.hostname ? indexes.hostname.get(normalizeDeviceHost(lookup.hostname)) : undefined;
        if (lookup.address) {
            const addressed = indexes.address.get(normalizeDeviceHost(lookup.address));
            if (addressed?.size) {
                const device = unique(addressed);
                const name = lookup.hostname ? normalizeDeviceHost(lookup.hostname) : '';
                const aliases = device ? [device.hostname, ...device.hostnames].filter(Boolean).map((alias) => normalizeDeviceHost(alias!)) : [];
                if (name && name !== normalizeDeviceHost(lookup.address) && aliases.length && !aliases.includes(name)) return null;
                return device && (!named?.size || named.has(device)) ? device : null;
            }
            const device = unique(named);
            // An unmatched address must not override a different known address for this name.
            return device?.addresses.length === 0 ? device : null;
        }
        return unique(named);
    };
}
