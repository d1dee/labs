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
    const addressLabel = addresses.length ? addresses.join(', ') : !knownAddresses.length ? emptyAddressLabel : null;
    const labLabel = showLab ? location?.name : null;
    return (
        <Stack gap={2} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            <Text size='sm' fw={500}>{name}</Text>
            {addressLabel || labLabel ? (
                <Text size='xs' c='dimmed'>
                    {addressLabel ? <span>{addressLabel}</span> : null}
                    {addressLabel && labLabel ? ' \u00b7 ' : null}
                    {labLabel ? <span>{labLabel}</span> : null}
                </Text>
            ) : null}
        </Stack>
    );
}
