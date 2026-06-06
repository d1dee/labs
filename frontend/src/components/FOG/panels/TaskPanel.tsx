import type { FogHost, FogTaskType } from '@/api/fog';
import { createFogTask } from '@/api/fog';
import { Button, Group, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconPlayerPlay, IconX } from '@tabler/icons-react';
import { useState } from 'react';

interface Props {
    hosts: FogHost[];
    taskType: FogTaskType;
    onDone: () => void;
}

export function TaskPanel({ hosts, taskType, onDone }: Props) {
    const [loading, setLoading] = useState(false);
    const isBulk = hosts.length > 1;

    const handleRun = async () => {
        setLoading(true);
        const results = await Promise.allSettled(
            hosts.map((host) => createFogTask(host.id, taskType.id)),
        );
        const succeeded = results.filter(
            (r) => r.status === 'fulfilled',
        ).length;
        const failed = results.filter((r) => r.status === 'rejected').length;

        if (succeeded > 0) {
            notifications.show({
                color: 'green',
                title: `${taskType.name} Started`,
                message: `Task created for ${succeeded} host${succeeded !== 1 ? 's' : ''}`,
                icon: <IconCheck size={16} />,
            });
        }
        if (failed > 0) {
            notifications.show({
                color: 'red',
                title: `${taskType.name} Failed`,
                message: `Failed for ${failed} host${failed !== 1 ? 's' : ''}`,
                icon: <IconX size={16} />,
            });
        }
        setLoading(false);
        onDone();
    };

    return (
        <Stack gap='sm'>
            {taskType.description && (
                <Text size='sm' c='dimmed'>
                    {taskType.description}
                </Text>
            )}
            <Text size='sm'>
                {isBulk
                    ? `Run "${taskType.name}" on ${hosts.length} selected hosts.`
                    : `Run "${taskType.name}" on ${hosts[0]?.name}.`}
            </Text>
            <Group>
                <Button
                    size='sm'
                    color='teal'
                    leftSection={<IconPlayerPlay size={14} />}
                    onClick={handleRun}
                    loading={loading}
                >
                    Run {taskType.name}
                </Button>
            </Group>
        </Stack>
    );
}
