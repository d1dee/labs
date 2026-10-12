import { addressInSubnet } from './mikrotik';
import { normalizeMac } from './veyon-sync';
import { getOrganizationDevices } from './devices';
import { createDeviceIdentityLookup } from '../frontend/src/api/devices';

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

type Computer = { id?: string; host: string; macAddress: string | null; location: string | null };

function literalIPv4(host: string): string | null {
    const address = host.replace(/:\d+$/, '');
    return addressInSubnet(address, address) ? address : null;
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
        const directory = await getOrganizationDevices(organizationId);
        const lookup = createDeviceIdentityLookup(directory.devices);
        return computers.map((computer) => {
            if (computer.macAddress && !/^[0-9a-f]{12}$/.test(normalizeMac(computer.macAddress))) return computer;
            const device = (computer.id ? lookup({ veyonComputerId: computer.id, macAddress: computer.macAddress }) : null)
                ?? (computer.macAddress ? lookup({ macAddress: computer.macAddress })
                    : lookup({ address: literalIPv4(computer.host) }));
            return device?.lab ? { ...computer, location: device.lab.name } : computer;
        });
    } catch {
        return computers;
    }
}
