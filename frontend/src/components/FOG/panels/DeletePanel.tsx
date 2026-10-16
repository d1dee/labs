import type { FogHost } from '@/api/fog';
import { deleteFogHost } from '@/api/fog';
import { useApiStream } from '@/api/useApiStream';
import { Button, Group, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconTrash, IconX } from '@tabler/icons-react';
import { useState } from 'react';

interface Props {
    hosts: FogHost[];
    onDone: (deletedIds: number[]) => void;
}

export function DeletePanel({ hosts, onDone }: Props) {
    const [loading, setLoading] = useState(false);
    const refresh = useApiStream(null, () => {});
    const isBulk = hosts.length > 1;

    const handleDelete = async () => {
        const confirmed = confirm(
            isBulk
                ? `Delete ${hosts.length} selected FOG hosts? This permanently deletes FOG inventory, not just Veyon management.`
                : `Delete FOG host "${hosts[0]?.name}"? This permanently deletes FOG inventory, not just Veyon management.`,
        );
        if (!confirmed) return;

        setLoading(true);
        const results = await Promise.allSettled(
            hosts.map((host) => deleteFogHost(host.id)),
        );
        const succeeded = results.filter(
            (r) => r.status === 'fulfilled',
        ).length;
        const failed = results.filter((r) => r.status === 'rejected').length;

        if (succeeded > 0) {
            refresh();
            notifications.show({
                color: 'green',
                title: 'Hosts Deleted',
                message: `Deleted ${succeeded} host${succeeded !== 1 ? 's' : ''}`,
                icon: <IconCheck size={16} />,
            });
        }
        if (failed > 0) {
            notifications.show({
                color: 'red',
                title: 'Delete Failed',
                message: `Failed to delete ${failed} host${failed !== 1 ? 's' : ''}`,
                icon: <IconX size={16} />,
            });
        }
        setLoading(false);
        const deletedIds = hosts
            .filter((_, i) => results[i].status === 'fulfilled')
            .map((h) => h.id);
        onDone(deletedIds);
    };

    return (
        <Stack gap='sm'>
            <Text size='sm' c='dimmed'>
                {isBulk
                    ? `You are about to permanently delete ${hosts.length} hosts from FOG.`
                    : `You are about to permanently delete "${hosts[0]?.name}" from FOG.`}
            </Text>
            {hosts.length > 0 && (
                <Stack gap={2}>
                    {hosts.slice(0, 10).map((h) => (
                        <Text key={h.id} size='xs' ff='monospace'>
                            {h.id}: {h.name}
                        </Text>
                    ))}
                    {hosts.length > 10 && (
                        <Text size='xs' c='dimmed'>
                            …and {hosts.length - 10} more
                        </Text>
                    )}
                </Stack>
            )}
            <Group>
                <Button
                    size='sm'
                    color='red'
                    leftSection={<IconTrash size={14} />}
                    onClick={handleDelete}
                    loading={loading}
                >
                    {isBulk
                        ? `Delete ${hosts.length} Hosts`
                        : 'Delete Host'}
                </Button>
            </Group>
        </Stack>
    );
}
