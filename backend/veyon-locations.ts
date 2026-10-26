import { addressInSubnet } from './mikrotik';
import { normalizeMac } from './veyon-sync';
import { getOrganizationDevices } from './devices';
import { createDeviceIdentityLookup } from '../frontend/src/api/devices';
import { getFirewallConfigWithLabs } from './firewall-config';
import { qualifyFogHostname } from './dns-suffix';

export interface ComputerLocationLab {
    id: string;
    name: string;
    dhcpServer: string | null;
    subnet: string | null;
    interface?: string | null;
}

export interface ComputerLocationLease {
    status?: string | null;
    server?: string | null;
    'active-server'?: string | null;
    address?: string | null;
    'active-address'?: string | null;
    'mac-address'?: string | null;
    'active-mac-address'?: string | null;
    disabled?: boolean | string;
    invalid?: boolean | string;
}

type Computer = { id?: string; host: string; macAddress: string | null; location: string | null; fogHostId?: number | null };

function literalIPv4(host: string): string | null {
    const address = host.replace(/:\d+$/, '');
    return addressInSubnet(address, address) ? address : null;
}

function connectionHost(host: string, address: string): string {
    const port = host.match(/^(?:\[[^\]]+\]|[^:]+):(\d+)$/)?.[1];
    return port ? `${address}:${port}` : address;
}

export function assignComputerLocations<T extends Computer>(
    computers: T[],
    labs: ComputerLocationLab[],
    leases: ComputerLocationLease[],
): T[] {
    const byMac = new Map<string, Map<string, ComputerLocationLab>>();
    const byAddress = new Map<string, Map<string, ComputerLocationLab>>();
    for (const lease of leases) {
        if (!lease || lease.status !== 'bound' ||
            lease.disabled === true || lease.disabled === 'true' ||
            lease.invalid === true || lease.invalid === 'true') continue;
        const server = lease['active-server'] || lease.server;
        const address = lease['active-address'] || lease.address || '';
        const mac = normalizeMac(lease['active-mac-address'] || lease['mac-address'] || '');
        for (const lab of labs) {
            if (!lab.dhcpServer || lab.dhcpServer !== server ||
                (lab.subnet && !addressInSubnet(address, lab.subnet))) continue;
            if (/^[0-9a-f]{12}$/.test(mac)) {
                const matches = byMac.get(mac) ?? new Map<string, ComputerLocationLab>();
                matches.set(lab.id, lab);
                byMac.set(mac, matches);
            }
            if (literalIPv4(address) === address) {
                const matches = byAddress.get(address) ?? new Map<string, ComputerLocationLab>();
                matches.set(lab.id, lab);
                byAddress.set(address, matches);
            }
        }
    }
    return computers.map((computer) => {
        const mac = normalizeMac(computer.macAddress || '');
        // Even an unusable saved MAC must not fall through to a possibly reassigned IP.
        const matches = computer.macAddress
            ? (/^[0-9a-f]{12}$/.test(mac) ? byMac.get(mac) : undefined)
            : byAddress.get(literalIPv4(computer.host) ?? '');
        if (matches?.size !== 1) return computer;
        const lab = matches.values().next().value!;
        return { ...computer, location: lab.name };
    });
}

export async function resolveComputerLocations<T extends Computer>(
    organizationId: string,
    computers: T[],
): Promise<T[]> {
    if (computers.length === 0) return computers;
    try {
        const [directory, firewall] = await Promise.all([
            getOrganizationDevices(organizationId), getFirewallConfigWithLabs(organizationId).catch(() => undefined),
        ]);
        const lookup = createDeviceIdentityLookup(directory.devices);
        return computers.map((computer) => {
            if (computer.macAddress && !/^[0-9a-f]{12}$/.test(normalizeMac(computer.macAddress))) return computer;
            const device = (computer.id ? lookup({ veyonComputerId: computer.id, macAddress: computer.macAddress }) : null)
                ?? (computer.macAddress ? lookup({ macAddress: computer.macAddress })
                    : lookup({ address: literalIPv4(computer.host) }));
            const labId = device?.lab?.id;
            const suffix = labId ? firewall?.labs.find((lab) => lab.id === labId)?.dnsSuffix || firewall?.defaultDnsSuffix : undefined;
            const addresses = [...new Set(device?.addresses.map(literalIPv4).filter((address): address is string => Boolean(address)) ?? [])];
            const lab = labId ? directory.labs?.find((candidate) => candidate.id === labId) : undefined;
            const labAddresses = lab?.subnet ? addresses.filter((address) => addressInSubnet(address, lab.subnet!)) : [];
            const address = labAddresses.length === 1 ? labAddresses[0] : addresses.length === 1 ? addresses[0] : undefined;
            const host = computer.fogHostId != null
                ? address ? connectionHost(computer.host, address) : qualifyFogHostname(computer.host, suffix)
                : computer.host;
            if (!device?.lab && host === computer.host) return computer;
            return { ...computer, host, location: device?.lab?.name ?? computer.location };
        });
    } catch {
        return computers;
    }
}
