import type { DeviceIdentity } from '@/api/devices';
import { Stack, Text, Tooltip } from '@mantine/core';

export function DeviceIdentityDetails({ identity }: { identity: DeviceIdentity | null }) {
    if (!identity) return null;
    return (
        <Tooltip label={`Sources: ${identity.sources.join(', ') || 'Unknown'}`}>
            <Stack gap={0} mt={4} style={{ overflowWrap: 'anywhere' }}>
                <Text size='xs' c='dimmed'>Current association</Text>
                {identity.hostname ? <Text size='sm' fw={500}>{identity.hostname}</Text> : null}
                {identity.addresses.length ? <Text size='xs' c='dimmed'>{identity.addresses.join(', ')}</Text> : null}
                {identity.lab ? <Text size='xs' c='dimmed'>{identity.lab.name} / DHCP: {identity.lab.dhcpServer}</Text>
                    : identity.location ? <Text size='xs' c='dimmed'>{identity.location}</Text> : null}
            </Stack>
        </Tooltip>
    );
}
