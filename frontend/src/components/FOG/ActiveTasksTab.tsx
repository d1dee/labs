import {
    listActiveFogTasks,
    type FogActiveTask,
    type FogTaskState,
} from '@/api/fog';
import {
    Badge,
    Card,
    Group,
    Progress,
    SimpleGrid,
    Skeleton,
    Stack,
    Table,
    Text,
    Title,
} from '@mantine/core';
import { useInterval } from '@mantine/hooks';
import {
    IconCheck,
    IconClock,
    IconPlayerPlay,
    IconRefresh,
    IconServer,
    IconTools,
} from '@tabler/icons-react';
import { useEffect, useMemo, useState, type FC } from 'react';

const getStateColor = (state?: FogTaskState): string => {
    if (!state?.name) return 'gray';
    const s = state.name.toLowerCase();
    if (s.includes('run') || s.includes('in progress') || s.includes('in prog'))
        return 'blue';
    if (s.includes('pend') || s.includes('queue')) return 'yellow';
    if (s.includes('complete') || s.includes('done') || s.includes('success'))
        return 'green';
    if (s.includes('fail') || s.includes('error') || s.includes('cancel'))
        return 'red';
    return 'gray';
};

const getStateIcon = (state?: FogTaskState) => {
    if (!state?.name) return IconClock;
    const s = state.name.toLowerCase();
    if (s.includes('run') || s.includes('in progress') || s.includes('in prog'))
        return IconPlayerPlay;
    if (s.includes('pend') || s.includes('queue')) return IconClock;
    if (s.includes('complete') || s.includes('done') || s.includes('success'))
        return IconCheck;
    if (s.includes('fail') || s.includes('error') || s.includes('cancel'))
        return IconRefresh;
    return IconClock;
};

interface TaskStats {
    total: number;
    running: number;
    pending: number;
    completed: number;
    failed: number;
    other: number;
}

const computeStats = (tasks: FogActiveTask[]): TaskStats => {
    const stats: TaskStats = {
        total: tasks.length,
        running: 0,
        pending: 0,
        completed: 0,
        failed: 0,
        other: 0,
    };
    for (const task of tasks) {
        const state = task.state?.name?.toLowerCase() || '';
        if (state.includes('run') || state.includes('in progress') || state.includes('in prog')) {
            stats.running++;
        } else if (state.includes('pend') || state.includes('queue')) {
            stats.pending++;
        } else if (
            state.includes('complete') ||
            state.includes('done') ||
            state.includes('success')
        ) {
            stats.completed++;
        } else if (
            state.includes('fail') ||
            state.includes('error') ||
            state.includes('cancel')
        ) {
            stats.failed++;
        } else {
            stats.other++;
        }
    }
    return stats;
};

const TaskTypeDistribution: FC<{ tasks: FogActiveTask[] }> = ({ tasks }) => {
    const counts = useMemo(() => {
        const map = new Map<string, number>();
        for (const task of tasks) {
            const key =
                task.typeName ||
                task.type?.name ||
                `Type ${task.typeID || '?'}`;
            map.set(key, (map.get(key) || 0) + 1);
        }
        return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    }, [tasks]);

    if (counts.length === 0) return null;

    return (
        <Card withBorder p='md'>
            <Stack gap='sm'>
                <Title order={5}>Task Types</Title>
                {counts.map(([type, count]) => (
                    <Group key={type} justify='space-between'>
                        <Text size='sm'>{type}</Text>
                        <Badge variant='light'>{count}</Badge>
                    </Group>
                ))}
            </Stack>
        </Card>
    );
};

const ActiveTasksTab: FC = () => {
    const [tasks, setTasks] = useState<FogActiveTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [configured, setConfigured] = useState(true);

    const fetchTasks = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await listActiveFogTasks();

            setTasks(data.tasks || []);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (
                msg.includes('not configured') ||
                msg.includes('Failed to fetch')
            ) {
                setConfigured(false);
            }
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTasks();
    }, []);

    // Auto-refresh every 10 seconds
    const interval = useInterval(fetchTasks, 10000);
    useEffect(() => {
        interval.start();
        return interval.stop;
    }, [interval]);

    const stats = useMemo(() => computeStats(tasks), [tasks]);

    if (!configured) {
        return (
            <Card withBorder p='xl'>
                <Stack align='center' gap='md'>
                    <IconServer size={48} color='var(--mantine-color-gray-5)' />
                    <Text c='dimmed' ta='center'>
                        FOG is not configured. Active tasks cannot be displayed.
                    </Text>
                </Stack>
            </Card>
        );
    }

    return (
        <Stack gap='md'>
            <Group justify='space-between'>
                <Title order={4}>Active FOG Tasks</Title>
                <Badge
                    leftSection={<IconRefresh size={14} />}
                    variant='light'
                    color='blue'
                    style={{ cursor: 'pointer' }}
                    onClick={fetchTasks}
                >
                    Refresh
                </Badge>
            </Group>

            {/* Stats Cards */}
            <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }}>
                <Card withBorder p='sm'>
                    <Stack gap={4} align='center'>
                        <Text size='xs' c='dimmed' tt='uppercase' fw={600}>
                            Total
                        </Text>
                        <Title order={3}>{stats.total}</Title>
                    </Stack>
                </Card>
                <Card withBorder p='sm'>
                    <Stack gap={4} align='center'>
                        <Text size='xs' c='dimmed' tt='uppercase' fw={600}>
                            Running
                        </Text>
                        <Title order={3} c='blue'>
                            {stats.running}
                        </Title>
                    </Stack>
                </Card>
                <Card withBorder p='sm'>
                    <Stack gap={4} align='center'>
                        <Text size='xs' c='dimmed' tt='uppercase' fw={600}>
                            Pending
                        </Text>
                        <Title order={3} c='yellow'>
                            {stats.pending}
                        </Title>
                    </Stack>
                </Card>
                <Card withBorder p='sm'>
                    <Stack gap={4} align='center'>
                        <Text size='xs' c='dimmed' tt='uppercase' fw={600}>
                            Completed
                        </Text>
                        <Title order={3} c='green'>
                            {stats.completed}
                        </Title>
                    </Stack>
                </Card>
                <Card withBorder p='sm'>
                    <Stack gap={4} align='center'>
                        <Text size='xs' c='dimmed' tt='uppercase' fw={600}>
                            Failed
                        </Text>
                        <Title order={3} c='red'>
                            {stats.failed}
                        </Title>
                    </Stack>
                </Card>
            </SimpleGrid>

            {/* Task Type Distribution */}
            {tasks.length > 0 && <TaskTypeDistribution tasks={tasks} />}

            {/* Tasks Table */}
            <Card withBorder p='md'>
                <Stack gap='md'>
                    <Title order={5}>Task Details</Title>
                    {loading && tasks.length === 0 ? (
                        <Stack gap='sm'>
                            {Array.from({ length: 5 }).map((_, i) => (
                                <Skeleton key={i} height={40} radius='sm' />
                            ))}
                        </Stack>
                    ) : error && tasks.length === 0 ? (
                        <Text c='red' ta='center'>
                            {error}
                        </Text>
                    ) : tasks.length === 0 ? (
                        <Stack align='center' gap='md' py='xl'>
                            <IconTools
                                size={48}
                                color='var(--mantine-color-gray-5)'
                            />
                            <Text c='dimmed' ta='center'>
                                No active tasks found.
                            </Text>
                        </Stack>
                    ) : (
                        <Table.ScrollContainer minWidth={600}>
                            <Table striped highlightOnHover>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>Task</Table.Th>
                                        <Table.Th>Host</Table.Th>
                                        <Table.Th>Type</Table.Th>
                                        <Table.Th>State</Table.Th>
                                        <Table.Th>Progress</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {tasks.map((task) => {
                                        const StateIcon = getStateIcon(
                                            task.state,
                                        );
                                        const progress =
                                            typeof task.percent === 'number'
                                                ? task.percent
                                                : 0;
                                        const progressLabel =
                                            typeof task.percent === 'number'
                                                ? `${Math.round(task.percent)}%`
                                                : 'N/A';

                                        return (
                                            <Table.Tr key={task.id}>
                                                <Table.Td>
                                                    <Text size='sm' fw={500}>
                                                        {task.name ||
                                                            `Task #${task.id}`}
                                                    </Text>
                                                    <Text size='xs' c='dimmed'>
                                                        ID: {task.id}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Text size='sm'>
                                                        {task.hostName ||
                                                            task.host?.name ||
                                                            `Host #${task.hostID || '?'}`}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Badge
                                                        variant='light'
                                                        size='sm'
                                                    >
                                                        {task.typeName ||
                                                            task.type?.name ||
                                                            `Type ${task.typeID || '?'}`}
                                                    </Badge>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Badge
                                                        leftSection={
                                                            <StateIcon
                                                                size={12}
                                                            />
                                                        }
                                                        color={getStateColor(
                                                            task.state,
                                                        )}
                                                        variant='filled'
                                                        size='sm'
                                                    >
                                                        {task.state?.name ||
                                                            'Unknown'}
                                                    </Badge>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Stack gap={4}>
                                                        <Progress
                                                            value={progress}
                                                            size='lg'
                                                            radius='sm'
                                                            color={getStateColor(
                                                                task.state,
                                                            )}
                                                            striped={task.state
                                                                ?.name
                                                                ?.toLowerCase()
                                                                .includes(
                                                                    'run',
                                                                ) || task.state
                                                                ?.name
                                                                ?.toLowerCase()
                                                                .includes(
                                                                    'in progress',
                                                                ) || task.state
                                                                ?.name
                                                                ?.toLowerCase()
                                                                .includes(
                                                                    'in prog',
                                                                )}
                                                            animated={task.state
                                                                ?.name
                                                                ?.toLowerCase()
                                                                .includes(
                                                                    'run',
                                                                ) || task.state
                                                                ?.name
                                                                ?.toLowerCase()
                                                                .includes(
                                                                    'in progress',
                                                                ) || task.state
                                                                ?.name
                                                                ?.toLowerCase()
                                                                .includes(
                                                                    'in prog',
                                                                )}
                                                        />
                                                        <Text
                                                            size='xs'
                                                            c='dimmed'
                                                            ta='right'
                                                        >
                                                            {progressLabel}
                                                        </Text>
                                                    </Stack>
                                                </Table.Td>
                                            </Table.Tr>
                                        );
                                    })}
                                </Table.Tbody>
                            </Table>
                        </Table.ScrollContainer>
                    )}
                </Stack>
            </Card>
        </Stack>
    );
};

export default ActiveTasksTab;
