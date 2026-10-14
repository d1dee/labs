import type { DeviceIdentity, DeviceLab } from '@/api/devices';
import { normalizeDeviceHost } from '@/api/devices';
import { addressInRange } from '@/api/network';
import { Stack, Text } from '@mantine/core';

export function DeviceIdentityDetails({ identity, hostname, address, lab, showLab = true, emptyAddressLabel }: {
    identity?: DeviceIdentity | null;
    hostname?: string | null;
    address?: string | null;
    lab?: DeviceLab | null;
    showLab?: boolean;
    emptyAddressLabel?: string;
}) {
    if (!identity && !hostname && !address) return null;
    const name = identity?.hostname || hostname || address || 'Unknown host';
    const knownAddresses = [...new Set(identity ? identity.addresses : (address ? [address] : []))]
        .map(normalizeDeviceHost).filter((ip) => addressInRange(ip, ip) || ip.includes(':'));
    const addresses = knownAddresses.filter((ip) => normalizeDeviceHost(ip) !== normalizeDeviceHost(name));
    const location = lab ?? identity?.lab;
    return (
        <Stack gap={2} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            <Text size='sm' fw={500}>{name}</Text>
            {addresses.length ? <Text size='xs' c='dimmed'>{addresses.join(', ')}</Text> : null}
            {!knownAddresses.length && emptyAddressLabel ? <Text size='xs' c='dimmed'>{emptyAddressLabel}</Text> : null}
            {showLab && location ? <Text size='xs' c='dimmed'>{location.name}</Text> : null}
        </Stack>
    );
}
