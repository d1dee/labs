import { type FogActiveTask, type FogTaskState } from '@/api/fog';
import { compareTableValues, SortableTh, toggleTableSort, type SortState } from '@/components/ui/tableUtils';
import {
    ActionIcon,
    Badge,
    Button,
    Box,
    Checkbox,
    Group,
    Pagination,
    Progress,
    Skeleton,
    Stack,
    Table,
    Text,
} from '@mantine/core';
import { useSelection } from '@mantine/hooks';
import {
    IconCheck,
    IconClock,
    IconPlayerPlay,
    IconRefresh,
    IconTrash,
} from '@tabler/icons-react';
import { useEffect, useMemo, useState, type FC } from 'react';

const getStateColor = (state?: FogTaskState): string => {
    const id = state?.id ?? 0;
    if (id === 3) return 'blue'; // In-Progress
    if (id === 1 || id === 2) return 'yellow'; // Queued / Checked In
    if (id === 4) return 'green'; // Complete
    if (id >= 5) return 'red'; // Failed / Cancelled
    return 'gray';
};

const getStateIcon = (state?: FogTaskState) => {
    const id = state?.id ?? 0;
    if (id === 3) return IconPlayerPlay; // In-Progress
    if (id === 1 || id === 2) return IconClock; // Queued / Checked In
    if (id === 4) return IconCheck; // Complete
    if (id >= 5) return IconRefresh; // Failed / Cancelled
    return IconClock;
};

const isTerminalState = (task: FogActiveTask): boolean => {
    const id = task.stateID ?? task.state?.id ?? 0;
    return id === 4 || id >= 5;
};

interface ActiveTasksTableProps {
    loading: boolean;
    tasks: FogActiveTask[];
    filterKey?: string;
    actioningTasks: Set<number>;
    onTaskAction: (
        taskId: number,
        action: 'cancel' | 'pause' | 'force' | 'restart',
        extra?: { hostId?: number; taskTypeId?: number },
    ) => void;
}

const PAGE_SIZE = 20;

const ActiveTasksTable: FC<ActiveTasksTableProps> = ({
    loading,
    tasks,
    filterKey = '',
    actioningTasks,
    onTaskAction,
}) => {
    const [page, setPage] = useState(1);
    const [sort, setSort] = useState<SortState<'id' | 'task' | 'host' | 'type' | 'state' | 'progress'> | null>(null);
    const [previousFilterKey, setPreviousFilterKey] = useState(filterKey);
    if (previousFilterKey !== filterKey) {
        setPreviousFilterKey(filterKey);
        setPage(1);
    }
    const totalPages = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);
    const sortedTasks = useMemo(() => {
        if (!sort) return tasks;
        const value = (task: FogActiveTask) => {
            switch (sort.key) {
                case 'id': return Number(task.id);
                case 'task': return task.name || `Task #${task.id}`;
                case 'host': return task.hostName || task.host?.name || `Host #${task.hostID || '?'}`;
                case 'type': return task.typeName || task.type?.name || `Type ${task.typeID || '?'}`;
                case 'state': return task.state?.name || 'Unknown';
                case 'progress': {
                    const percent = task.percent == null || String(task.percent).trim() === ''
                        ? NaN : parseFloat(String(task.percent));
                    return Number.isFinite(percent) ? percent : null;
                }
            }
        };
        return [...tasks].sort((a, b) => compareTableValues(value(a), value(b), sort.direction));
    }, [tasks, sort]);

    const paginatedTasks = useMemo(
        () => sortedTasks.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
        [sortedTasks, currentPage],
    );

    const taskIds = useMemo(
        () => paginatedTasks.map((t) => t.id),
        [paginatedTasks],
    );

    const [selection, handlers] = useSelection({
        data: taskIds,
        resetSelectionOnDataChange: false,
    });
    useEffect(() => {
        const retained = selection.filter((id) => taskIds.includes(id));
        if (retained.length !== selection.length) handlers.setSelection(retained);
    }, [taskIds, selection, handlers]);

    const selectedTasks = paginatedTasks.filter((t) =>
        selection.includes(t.id),
    );
    const cancelableIds = selectedTasks
        .filter((t) => !isTerminalState(t) && !actioningTasks.has(t.id))
        .map((t) => t.id);
    const forceableIds = selectedTasks
        .filter((t) => {
            const id = t.stateID ?? t.state?.id ?? 0;
            return (id === 1 || id === 2) && !actioningTasks.has(t.id);
        })
        .map((t) => t.id);

    const handleBulkCancel = () => {
        cancelableIds.forEach((id) => onTaskAction(id, 'cancel'));
        handlers.resetSelection();
    };

    const handleBulkForce = () => {
        forceableIds.forEach((id) => onTaskAction(id, 'force'));
        handlers.resetSelection();
    };

    useEffect(() => {
        setPage((current) => Math.min(current, totalPages));
    }, [totalPages]);

    return (
        <Stack gap='md'>
            {selectedTasks.length > 0 && (
                <Group justify='space-between' align='center'>
                    <Text size='sm' c='dimmed'>
                        {selectedTasks.length} task
                        {selectedTasks.length !== 1 ? 's' : ''} selected
                    </Text>
                    <Group gap='xs'>
                        <Button
                            size='xs'
                            color='blue'
                            variant='light'
                            leftSection={<IconPlayerPlay size={14} />}
                            disabled={loading || forceableIds.length === 0}
                            onClick={handleBulkForce}
                        >
                            Force Start ({forceableIds.length})
                        </Button>
                        <Button
                            size='xs'
                            color='red'
                            variant='light'
                            leftSection={<IconTrash size={14} />}
                            disabled={loading || cancelableIds.length === 0}
                            onClick={handleBulkCancel}
                        >
                            Cancel ({cancelableIds.length})
                        </Button>
                    </Group>
                </Group>
            )}
            <Box pos='relative'>
                <Table.ScrollContainer minWidth={900}>
                    <Table verticalSpacing='sm' highlightOnHover withRowBorders stickyHeader>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>
                                    <Checkbox
                                        aria-label='Select all tasks'
                                        disabled={loading || taskIds.length === 0}
                                        checked={handlers.isAllSelected()}
                                        indeterminate={handlers.isSomeSelected()}
                                        onChange={() => {
                                            if (handlers.isAllSelected()) {
                                                handlers.resetSelection();
                                            } else {
                                                handlers.setSelection(taskIds);
                                            }
                                        }}
                                    />
                                </Table.Th>
                                {([
                                    ['id', 'ID'], ['task', 'Task'], ['host', 'Host'],
                                    ['type', 'Type'], ['state', 'State'], ['progress', 'Progress'],
                                ] as const).map(([key, label]) => (
                                    <SortableTh key={key} label={label} active={sort?.key === key}
                                        direction={sort?.direction ?? 'asc'} onSort={() => {
                                            setSort(toggleTableSort(sort, key));
                                            setPage(1);
                                            handlers.resetSelection();
                                        }} />
                                ))}
                                <Table.Th>Actions</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {loading
                                ? Array.from({ length: PAGE_SIZE }).map(
                                      (_, i) => (
                                          <Table.Tr key={i}>
                                              <Table.Td>
                                                  <Stack gap={4}>
                                                      <Skeleton
                                                          height={16}
                                                          width='60%'
                                                      />
                                                      <Skeleton
                                                          height={12}
                                                          width='40%'
                                                      />
                                                  </Stack>
                                              </Table.Td>
                                              <Table.Td>
                                                  <Skeleton
                                                      height={16}
                                                      width={32}
                                                  />
                                              </Table.Td>

                                              <Table.Td>
                                                  <Skeleton
                                                      height={16}
                                                      width='50%'
                                                  />
                                              </Table.Td>
                                              <Table.Td>
                                                  <Skeleton
                                                      height={20}
                                                      width='70%'
                                                      radius='md'
                                                  />
                                              </Table.Td>
                                              <Table.Td>
                                                  <Skeleton
                                                      height={20}
                                                      width={64}
                                                      radius='xl'
                                                  />
                                              </Table.Td>
                                              <Table.Td>
                                                  <Skeleton
                                                      height={24}
                                                      width={80}
                                                  />
                                              </Table.Td>
                                              <Table.Td><Skeleton height={24} width={80} /></Table.Td>
                                              <Table.Td><Skeleton height={24} width={80} /></Table.Td>
                                          </Table.Tr>
                                      ),
                                  )
                                : paginatedTasks.length === 0 ? (
                                    <Table.Tr><Table.Td colSpan={8} ta='center' py='xl'>
                                        <Text c='dimmed' size='sm'>No tasks match your filters.</Text>
                                    </Table.Td></Table.Tr>
                                ) : paginatedTasks.map((task) => {
                                      const StateIcon = getStateIcon(
                                          task.state,
                                      );
                                      const progress =
                                          task.percent !== undefined
                                              ? parseFloat(
                                                    String(task.percent),
                                                ) || 0
                                              : 0;
                                      const progressLabel =
                                          task.percent !== undefined
                                              ? `${Math.round(progress)}%`
                                              : 'N/A';

                                        return (
                                            <Table.Tr
                                                key={task.id}
                                                bg={
                                                    selection.includes(task.id)
                                                        ? 'var(--mantine-color-blue-light)'
                                                        : undefined
                                                }
                                            >
                                                <Table.Td>
                                                    <Checkbox
                                                        aria-label='Select task'
                                                        checked={selection.includes(
                                                            task.id,
                                                        )}
                                                        onChange={() =>
                                                            handlers.toggle(
                                                                task.id,
                                                            )
                                                        }
                                                    />
                                                </Table.Td>
                                                <Table.Td>{task.id}</Table.Td>
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
                                              <Table.Td>
                                                  <Group gap='xs' wrap='nowrap'>
                                                      <ActionIcon
                                                          variant='subtle'
                                                          color='blue'
                                                          size='sm'
                                                          loading={actioningTasks.has(
                                                              task.id,
                                                          )}
                                                          disabled={
                                                              isTerminalState(task) ||
                                                              actioningTasks.has(
                                                                  task.id,
                                                              )
                                                          }
                                                          onClick={() => {
                                                              const stateId =
                                                                  task.stateID ??
                                                                  task.state
                                                                      ?.id ??
                                                                  0;
                                                              if (
                                                                  stateId ===
                                                                      1 ||
                                                                  stateId === 2
                                                              ) {
                                                                  onTaskAction(
                                                                      task.id,
                                                                      'force',
                                                                  );
                                                              } else if (
                                                                  stateId === 3
                                                              ) {
                                                                  onTaskAction(
                                                                      task.id,
                                                                      'restart',
                                                                      {
                                                                          hostId: task.hostID,
                                                                          taskTypeId:
                                                                              task.typeID,
                                                                      },
                                                                  );
                                                              }
                                                          }}
                                                      >
                                                          {(task.stateID ??
                                                              task.state?.id ??
                                                              0) === 3 ? (
                                                              <IconRefresh
                                                                  size={16}
                                                              />
                                                          ) : (
                                                              <IconPlayerPlay
                                                                  size={16}
                                                              />
                                                          )}
                                                      </ActionIcon>

                                                      <ActionIcon
                                                          variant='subtle'
                                                          color='red'
                                                          size='sm'
                                                          loading={actioningTasks.has(
                                                              task.id,
                                                          )}
                                                          disabled={
                                                              isTerminalState(task) ||
                                                              actioningTasks.has(
                                                                  task.id,
                                                              )
                                                          }
                                                          onClick={() =>
                                                              onTaskAction(
                                                                  task.id,
                                                                  'cancel',
                                                              )
                                                          }
                                                      >
                                                          <IconTrash
                                                              size={16}
                                                          />
                                                      </ActionIcon>
                                                  </Group>
                                              </Table.Td>
                                          </Table.Tr>
                                      );
                                  })}
                        </Table.Tbody>
                    </Table>
                </Table.ScrollContainer>
            </Box>
            {totalPages > 1 && (
                <Group justify='space-between' align='center'>
                    <Text size='sm' c='dimmed'>
                        {(currentPage - 1) * PAGE_SIZE + 1}–
                        {Math.min(currentPage * PAGE_SIZE, tasks.length)} of{' '}
                        {tasks.length} tasks
                    </Text>
                    <Pagination
                        total={totalPages}
                        value={currentPage}
                        onChange={setPage}
                    />
                </Group>
            )}
        </Stack>
    );
};

export default ActiveTasksTable;
