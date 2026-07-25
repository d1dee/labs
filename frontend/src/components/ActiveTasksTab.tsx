import {
    cancelFogTask,
    forceFogTask,
    getFogStatus,
    listActiveFogTasks,
    pauseFogTask,
    restartFogTask,
    type FogActiveTask,
} from '@/api/fog';
import {
    Alert,
    Badge,
    Card,
    Center,
    Group,
    Loader,
    Select,
    SimpleGrid,
    Stack,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { useInterval } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconAlertCircle,
    IconRefresh,
    IconSearch,
    IconTools,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState, type FC } from 'react';
import ActiveTasksTable from './FOG/ActiveTasksTable';

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
        const id = task.stateID ?? task.state?.id ?? 0;
        if (id === 3) {
            stats.running++;
        } else if (id === 1 || id === 2) {
            stats.pending++;
        } else if (id === 4) {
            stats.completed++;
        } else if (id >= 5) {
            stats.failed++;
        } else {
            stats.other++;
        }
    }
    return stats;
};

const ActiveTasksTab: FC = () => {
    const [tasks, setTasks] = useState<FogActiveTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [configured, setConfigured] = useState<boolean | null>(null);

    const [searchQuery, setSearchQuery] = useState('');
    const [stateFilter, setStateFilter] = useState<string | null>(null);
    const [typeFilter, setTypeFilter] = useState<string | null>(null);

    const fetchStatus = useCallback(async () => {
        try {
            const status = await getFogStatus();
            setConfigured(status.configured);
            return status.configured;
        } catch {
            setConfigured(false);
            return false;
        }
    }, []);

    const fetchTasks = useCallback(async () => {
        try {
            setError(null);
            const data = await listActiveFogTasks();

            setTasks(data.tasks || []);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, []);

    const loadAll = useCallback(async () => {
        setLoading(true);
        const ok = await fetchStatus();
        if (ok) {
            await fetchTasks();
        }
        setLoading(false);
    }, [fetchStatus, fetchTasks]);

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    // Auto-refresh every 10 seconds, only while configured
    const interval = useInterval(() => {
        fetchStatus().then((ok) => {
            if (ok) fetchTasks();
        });
    }, 10000);

    useEffect(() => {
        interval.start();
        return interval.stop;
    }, [interval]);

    const stats = useMemo(() => computeStats(tasks), [tasks]);

    const stateOptions = useMemo(() => {
        const states = new Map<string, string>();
        for (const t of tasks) {
            const id = String(t.stateID ?? t.state?.id ?? 0);
            const name = t.state?.name || 'Unknown';
            if (!states.has(id)) states.set(id, name);
        }
        return [...states.entries()].map(([value, label]) => ({
            value,
            label,
        }));
    }, [tasks]);

    const typeOptions = useMemo(() => {
        const types = new Map<string, string>();
        for (const t of tasks) {
            const id = String(t.typeID ?? t.type?.id ?? 0);
            const name = t.typeName || t.type?.name || `Type ${id}`;
            if (!types.has(id)) types.set(id, name);
        }
        return [...types.entries()].map(([value, label]) => ({ value, label }));
    }, [tasks]);

    const filteredTasks = useMemo(() => {
        let result = tasks;
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase();
            result = result.filter(
                (t) =>
                    (t.name || '').toLowerCase().includes(q) ||
                    (t.hostName || t.host?.name || '')
                        .toLowerCase()
                        .includes(q) ||
                    (t.typeName || t.type?.name || '')
                        .toLowerCase()
                        .includes(q),
            );
        }
        if (stateFilter) {
            result = result.filter(
                (t) => String(t.stateID ?? t.state?.id) === stateFilter,
            );
        }
        if (typeFilter) {
            result = result.filter(
                (t) => String(t.typeID ?? t.type?.id) === typeFilter,
            );
        }
        return result;
    }, [tasks, searchQuery, stateFilter, typeFilter]);

    const [actioningTasks, setActioningTasks] = useState<Set<number>>(
        new Set(),
    );

    const handleTaskAction = useCallback(
        async (
            taskId: number,
            action: 'cancel' | 'pause' | 'force' | 'restart',
            extra?: { hostId?: number; taskTypeId?: number },
        ) => {
            setActioningTasks((prev) => new Set(prev).add(taskId));
            try {
                const taskName =
                    tasks.find((t) => t.id === taskId)?.name ||
                    `Task #${taskId}`;
                if (action === 'cancel') {
                    await cancelFogTask(taskId);
                    notifications.show({
                        title: 'Task Cancelled',
                        message: `${taskName} has been cancelled`,
                        color: 'red',
                    });
                } else if (action === 'pause') {
                    await pauseFogTask(taskId);
                    notifications.show({
                        title: 'Task Paused',
                        message: `${taskName} has been paused`,
                        color: 'yellow',
                    });
                } else if (action === 'force') {
                    await forceFogTask(taskId);
                    notifications.show({
                        title: 'Task Force Started',
                        message: `${taskName} has been forced to start immediately`,
                        color: 'green',
                    });
                } else if (action === 'restart') {
                    await restartFogTask(
                        taskId,
                        extra?.hostId,
                        extra?.taskTypeId,
                    );
                    notifications.show({
                        title: 'Task Restarted',
                        message: `${taskName} has been restarted and forced`,
                        color: 'blue',
                    });
                }
                fetchTasks();
            } catch (err) {
                notifications.show({
                    title: 'Action Failed',
                    message: err instanceof Error ? err.message : String(err),
                    color: 'red',
                });
            } finally {
                setActioningTasks((prev) => {
                    const next = new Set(prev);
                    next.delete(taskId);
                    return next;
                });
            }
        },
        [tasks, fetchTasks],
    );

    if (loading && configured === null) {
        return (
            <Center py={60}>
                <Stack align='center' gap='md'>
                    <Loader />
                    <Text>Loading FOG tasks...</Text>
                </Stack>
            </Center>
        );
    }

    if (!configured) {
        return (
            <Alert
                icon={<IconAlertCircle size={18} />}
                title='FOG Not Configured'
                color='yellow'
                mt='md'
            >
                FOG Project is not configured. Configure it in{' '}
                <strong>Settings &rarr; FOG</strong>.
            </Alert>
        );
    }

    return (
        <Stack gap='md'>
            <Group justify='space-between'>
                <Title order={4}>Active FOG Tasks</Title>
                <Badge
                    leftSection={<IconRefresh size={14} />}
                    color='blue'
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                        loadAll();
                    }}
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

            {/* Tasks Table */}
            <Stack gap='md'>
                <div>
                    <Title order={5}>Task Details</Title>
                    <Text size='sm' c='dimmed'>
                        View and manage currently running FOG tasks.
                    </Text>
                </div>
                <Stack gap='md'>
                    <Card withBorder style={{ position: 'relative' }}>
                        <Stack>
                            <Card p='md' withBorder>
                                <Stack gap='sm'>
                                    <Group align='flex-end'>
                                        <TextInput
                                            label='Search'
                                            placeholder='Search tasks...'
                                            leftSection={
                                                <IconSearch size={16} />
                                            }
                                            value={searchQuery}
                                            onChange={(e) =>
                                                setSearchQuery(
                                                    e.currentTarget.value,
                                                )
                                            }
                                            style={{ flex: 1 }}
                                        />
                                        <Select
                                            placeholder='Filter by state'
                                            data={stateOptions}
                                            value={stateFilter}
                                            onChange={setStateFilter}
                                            clearable
                                            style={{ width: 180 }}
                                        />
                                        <Select
                                            placeholder='Filter by type'
                                            data={typeOptions}
                                            value={typeFilter}
                                            onChange={setTypeFilter}
                                            clearable
                                            style={{ width: 180 }}
                                        />
                                    </Group>
                                </Stack>
                            </Card>
                            <Card withBorder p='0'>
                                <Stack gap='md'>
                                    {error && tasks.length === 0 ? (
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
                                    ) : filteredTasks.length === 0 ? (
                                        <Stack align='center' gap='md' py='xl'>
                                            <IconSearch
                                                size={48}
                                                color='var(--mantine-color-gray-5)'
                                            />
                                            <Text c='dimmed' ta='center'>
                                                No tasks match your filters.
                                            </Text>
                                        </Stack>
                                    ) : (
                                        <ActiveTasksTable
                                            loading={loading}
                                            tasks={filteredTasks}
                                            actioningTasks={actioningTasks}
                                            onTaskAction={handleTaskAction}
                                        />
                                    )}
                                </Stack>
                            </Card>
                        </Stack>
                    </Card>
                </Stack>
            </Stack>
        </Stack>
    );
};

export default ActiveTasksTab;
