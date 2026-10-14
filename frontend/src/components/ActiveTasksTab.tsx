import {
    cancelFogTask,
    forceFogTask,
    getFogStatus,
    listActiveFogTasks,
    pauseFogTask,
    restartFogTask,
    type FogActiveTask,
} from '@/api/fog';
import { PageHero } from '@/components/ui/PageHero';
import { useApiStream } from '@/api/useApiStream';
import { deviceIdentitySearchText, useDeviceIdentities } from '@/api/useDeviceIdentities';
import { MobileFilterPanel, MobileFilterToggle, useMobileTableFilters } from '@/components/ui/MobileTableFilters';
import {
    Alert,
    Card,
    Center,
    Flex,
    Group,
    Loader,
    Select,
    Stack,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
    IconAlertCircle,
    IconSearch,
    IconTools,
} from '@tabler/icons-react';
import { useCallback, useMemo, useState, type FC } from 'react';
import ActiveTasksTable, { fogTaskIdentityQuery } from './FOG/ActiveTasksTable';

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
    const identities = useDeviceIdentities();
    const [tasks, setTasks] = useState<FogActiveTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [configured, setConfigured] = useState<boolean | null>(null);

    const [searchQuery, setSearchQuery] = useState('');
    const [stateFilter, setStateFilter] = useState<string | null>(null);
    const [typeFilter, setTypeFilter] = useState<string | null>(null);
    const [labFilter, setLabFilter] = useState<string | null>(null);
    const { opened, toggle, controlsId } = useMobileTableFilters();

    const streamError = (err: Error) => {
        setError(err.message);
        setLoading(false);
    };
    useApiStream<Awaited<ReturnType<typeof getFogStatus>>>('/api/fog/status', (status) => {
        setConfigured(status.configured);
        setError(null);
        if (!status.configured) setLoading(false);
    }, streamError);
    const refresh = useApiStream<Awaited<ReturnType<typeof listActiveFogTasks>>>(
        configured ? '/api/fog/tasks/active' : null,
        (data) => {
            setTasks(data.tasks || []);
            setError(null);
            setLoading(false);
        }, streamError,
    );

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
            const q = searchQuery.trim().toLowerCase();
            result = result.filter(
                (t) =>
                    String(t.id).includes(q) ||
                    (t.name || '').toLowerCase().includes(q) ||
                    (t.hostName || t.host?.name || '')
                        .toLowerCase()
                        .includes(q) ||
                    (t.typeName || t.type?.name || '')
                        .toLowerCase()
                        .includes(q) ||
                    (t.state?.name || 'Unknown').toLowerCase().includes(q) ||
                    deviceIdentitySearchText(identities.lookup(fogTaskIdentityQuery(t))).toLowerCase().includes(q) ||
                    (t.host?.ip || '').toLowerCase().includes(q),
            );
        }
        if (stateFilter) {
            result = result.filter(
                (t) => String(t.stateID ?? t.state?.id ?? 0) === stateFilter,
            );
        }
        if (typeFilter) {
            result = result.filter(
                (t) => String(t.typeID ?? t.type?.id ?? 0) === typeFilter,
            );
        }
        if (labFilter) {
            result = result.filter((task) => identities.labFor({
                ...fogTaskIdentityQuery(task), address: task.host?.ip,
            })?.id === labFilter);
        }
        return result;
    }, [tasks, searchQuery, stateFilter, typeFilter, labFilter, identities.lookup, identities.labFor]);

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
                refresh();
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
        [tasks, refresh],
    );

    if (loading && configured !== false) {
        return (
            <Center py={60}>
                <Stack align='center' gap='md'>
                    <Loader />
                    <Text>Loading FOG tasks...</Text>
                </Stack>
            </Center>
        );
    }

    if (configured === null && error) return <Alert color='red'>{error}</Alert>;

    if (configured === false) {
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
            <PageHero
                eyebrow='Deployment'
                title='Active FOG tasks'
                description='Track and manage currently running deployment tasks across hosts.'
                icon={<IconTools size={25} />}
                metrics={[
                    { label: 'Total', value: stats.total },
                    { label: 'Running', value: stats.running, accent: true },
                    { label: 'Pending', value: stats.pending, color: 'yellow.4' },
                    { label: 'Completed', value: stats.completed, color: 'green.4' },
                ]}
            />

            {/* Tasks Table */}
            {error && <Alert color='red'>{error}</Alert>}
            <Card withBorder radius='lg' p='md'>
                <Stack gap='md'>
                    {identities.warning ? <Text size='xs' c='dimmed' role='status'>{identities.warning}</Text> : null}
                    <Flex direction={{ base: 'column', sm: 'row' }} align={{ base: 'stretch', sm: 'flex-end' }} gap='md'>
                        <Stack gap={0} flex={1} miw={0} style={{ overflowWrap: 'anywhere' }}>
                            <Title order={4}>Task Details</Title>
                            <Text size='sm' c='dimmed'>
                                View and manage currently running FOG tasks.
                            </Text>
                        </Stack>
                        <Group wrap='nowrap' w={{ base: '100%', sm: 300 }} style={{ flexShrink: 0 }}>
                        <TextInput
                            aria-label='Search'
                            placeholder='Search tasks...'
                            leftSection={<IconSearch size={16} />}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.currentTarget.value)}
                            style={{ flex: 1, minWidth: 0 }}
                        />
                        <MobileFilterToggle
                            opened={opened}
                            onToggle={toggle}
                            controlsId={controlsId}
                            label='Toggle task filters'
                        />
                        </Group>
                    </Flex>
                    <MobileFilterPanel id={controlsId} opened={opened}>
                    <Group grow preventGrowOverflow={false} align='flex-end'>
                        <Select
                            miw={{ base: '100%', sm: 180 }}
                            placeholder='All labs'
                            label='Lab'
                            data={identities.labs.map((lab) => ({ value: lab.id, label: lab.name }))}
                            value={labFilter}
                            onChange={setLabFilter}
                            clearable
                            searchable
                            nothingFoundMessage='No labs'
                        />
                        <Select
                            miw={{ base: '100%', sm: 180 }}
                            placeholder='Filter by state'
                            label='State'
                            data={stateOptions}
                            value={stateFilter}
                            onChange={setStateFilter}
                            clearable
                        />
                        <Select
                            miw={{ base: '100%', sm: 180 }}
                            placeholder='Filter by type'
                            label='Type'
                            data={typeOptions}
                            value={typeFilter}
                            onChange={setTypeFilter}
                            clearable
                        />
                    </Group>
                    </MobileFilterPanel>

                    {tasks.length === 0 && !error && (
                        <Text c='dimmed' ta='center'>No active tasks found.</Text>
                    )}
                        <ActiveTasksTable
                            identities={identities}
                            loading={loading}
                            tasks={filteredTasks}
                            filterKey={JSON.stringify([searchQuery, stateFilter, typeFilter, labFilter])}
                            actioningTasks={actioningTasks}
                            onTaskAction={handleTaskAction}
                        />
                </Stack>
            </Card>
        </Stack>
    );
};

export default ActiveTasksTab;
