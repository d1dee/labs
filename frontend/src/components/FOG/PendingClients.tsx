import { deleteFogHost, updateFogHost, type FogHost } from '@/api/fog';
import {
    Button, Card, Checkbox, Group, Stack, Table, Text, Title,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';

interface Props {
    hosts: FogHost[];
    disabled?: boolean;
    onHostUpdated: (host: FogHost) => void;
    onHostsDeleted: (ids: number[]) => void;
}

export function PendingClients({
    hosts, disabled, onHostUpdated, onHostsDeleted,
}: Props) {
    const [selected, setSelected] = useState<number[]>([]);
    const [busy, setBusy] = useState(false);
    const pending = hosts.filter(
        (host) => String(host.pending) === '1' || host.pending === true,
    );
    const targets = pending.filter((host) => selected.includes(host.id));

    if (!pending.length) return null;

    const run = async (action: 'approve' | 'delete', clients: FogHost[]) => {
        if (busy || disabled || !clients.length) return;
        setBusy(true);
        try {
            const results = await Promise.allSettled(
                clients.map(async (host) => {
                    if (action === 'approve') {
                        const updated = await updateFogHost(host.id, { pending: '0' });
                        return { ...host, ...updated };
                    }
                    const result = await deleteFogHost(host.id);
                    if (!result.success) throw new Error('FOG did not confirm deletion');
                    return host;
                }),
            );
            const succeeded = results.flatMap((result) =>
                result.status === 'fulfilled' ? [result.value] : [],
            );
            const failures = results.flatMap((result, index) =>
                result.status === 'rejected'
                    ? [`${clients[index].name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
                    : [],
            );
            if (action === 'approve') {
                succeeded.forEach((host) => onHostUpdated(host));
            } else if (succeeded.length) {
                onHostsDeleted(succeeded.map((host) => host.id));
            }
            setSelected((current) =>
                current.filter((id) => !succeeded.some((host) => host.id === id)),
            );
            notifications.show({
                color: failures.length ? (succeeded.length ? 'orange' : 'red') : 'green',
                title: action === 'approve' ? 'FOG client approval' : 'FOG client deletion',
                message: `${succeeded.length}/${clients.length} clients ${action === 'approve' ? 'approved' : 'deleted'}.${failures.length ? ` ${failures.join('; ')}` : ''}`,
            });
        } finally {
            setBusy(false);
        }
    };

    const deleteSelected = () => {
        if (!targets.length || busy || disabled) return;
        const clients = targets;
        modals.openConfirmModal({
            title: 'Delete pending FOG clients?',
            children: (
                <Text size='sm'>
                    Permanently delete {clients.map((host) => host.name).join(', ')}
                    {' '}from FOG inventory? This cannot be undone.
                </Text>
            ),
            labels: { confirm: 'Delete clients', cancel: 'Cancel' },
            confirmProps: { color: 'red' },
            onConfirm: () => void run('delete', clients),
        });
    };

    return (
        <Card withBorder radius='lg' p='md'>
            <Stack gap='sm'>
                <Title order={4}>Pending FOG clients ({pending.length})</Title>
                <Text size='sm' c='dimmed'>
                    Review newly registered clients before approving them, or delete unwanted registrations.
                </Text>
                <Group gap='xs'>
                    <Button
                        color='green'
                        leftSection={<IconCheck size={16} />}
                        disabled={disabled || busy || !targets.length}
                        loading={busy}
                        onClick={() => void run('approve', targets)}
                    >
                        Approve selected ({targets.length})
                    </Button>
                    <Button
                        color='red'
                        variant='light'
                        leftSection={<IconTrash size={16} />}
                        disabled={disabled || busy || !targets.length}
                        onClick={deleteSelected}
                    >
                        Delete selected ({targets.length})
                    </Button>
                </Group>
                <Table.ScrollContainer minWidth={480}>
                    <Table>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th w={46}>
                                    <Checkbox
                                        aria-label='Select all pending FOG clients'
                                        disabled={disabled || busy}
                                        checked={targets.length === pending.length}
                                        indeterminate={targets.length > 0 && targets.length < pending.length}
                                        onChange={(event) => setSelected(event.currentTarget.checked ? pending.map((host) => host.id) : [])}
                                    />
                                </Table.Th>
                                <Table.Th>Client</Table.Th>
                                <Table.Th>MAC address</Table.Th>
                                <Table.Th>IP address</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {pending.map((host) => (
                                <Table.Tr key={host.id}>
                                    <Table.Td>
                                        <Checkbox
                                            aria-label={`Select pending client ${host.name}`}
                                            disabled={disabled || busy}
                                            checked={selected.includes(host.id)}
                                            onChange={(event) => {
                                                const checked = event.currentTarget.checked;
                                                setSelected((current) => checked ? [...current, host.id] : current.filter((id) => id !== host.id));
                                            }}
                                        />
                                    </Table.Td>
                                    <Table.Td>{host.name}</Table.Td>
                                    <Table.Td>{host.primac || '-'}</Table.Td>
                                    <Table.Td>{host.ip || '-'}</Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                </Table.ScrollContainer>
            </Stack>
        </Card>
    );
}
