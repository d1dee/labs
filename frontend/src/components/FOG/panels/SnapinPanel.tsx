import type { FogHost, FogSnapin } from '@/api/fog';
import { createFogSnapinTask } from '@/api/fog';
import { Button, Group, Select, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconX } from '@tabler/icons-react';
import { useState } from 'react';

interface Props {
    hosts: FogHost[];
    snapins: FogSnapin[];
    onDone: () => void;
}

export function SnapinPanel({ hosts, snapins, onDone }: Props) {
    const [selectedSnapinId, setSelectedSnapinId] = useState<string | null>(
        null,
    );
    const [loading, setLoading] = useState(false);

    const isBulk = hosts.length > 1;
    const selectedSnapin = snapins.find(
        (s) => String(s.id) === selectedSnapinId,
    );

    const handleSend = async () => {
        if (!selectedSnapinId) return;
        const snapinId = parseInt(selectedSnapinId, 10);
        setLoading(true);

        const results = await Promise.allSettled(
            hosts.map((host) => createFogSnapinTask(host.id, snapinId)),
        );
        const succeeded = results.filter(
            (r) => r.status === 'fulfilled',
        ).length;
        const failed = results.filter((r) => r.status === 'rejected').length;

        if (succeeded > 0) {
            notifications.show({
                color: 'green',
                title: 'Snapin Sent',
                message: `Sent to ${succeeded} host${succeeded !== 1 ? 's' : ''}`,
                icon: <IconCheck size={16} />,
            });
        }
        if (failed > 0) {
            notifications.show({
                color: 'red',
                title: 'Snapin Failed',
                message: `Failed for ${failed} host${failed !== 1 ? 's' : ''}`,
                icon: <IconX size={16} />,
            });
        }
        setLoading(false);
        onDone();
    };

    return (
        <Stack gap='sm'>
            <Text size='sm' c='dimmed'>
                {isBulk
                    ? `Send a snapin to all ${hosts.length} selected hosts.`
                    : `Send a snapin to ${hosts[0]?.name}.`}
            </Text>
            <Select
                label='Select snapin'
                placeholder='Choose snapin…'
                data={snapins.map((s) => ({
                    value: String(s.id),
                    label: s.name,
                }))}
                value={selectedSnapinId}
                onChange={setSelectedSnapinId}
                clearable
                searchable
                nothingFoundMessage='No snapins found'
            />
            {selectedSnapin?.description && (
                <Text size='xs' c='dimmed'>
                    {selectedSnapin.description}
                </Text>
            )}
            <Group>
                <Button
                    size='sm'
                    color='blue'
                    onClick={handleSend}
                    disabled={!selectedSnapinId}
                    loading={loading}
                >
                    Send Snapin
                </Button>
            </Group>
        </Stack>
    );
}
