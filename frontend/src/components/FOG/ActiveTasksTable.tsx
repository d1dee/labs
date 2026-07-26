import { type FogActiveTask, type FogTaskState } from '@/api/fog';
import {
    ActionIcon,
    Badge,
    Button,
    Card,
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

const isTerminalState = (state?: FogTaskState): boolean => {
    const id = state?.id ?? 0;
    return id === 4 || id >= 5;
};

interface ActiveTasksTableProps {
    loading: boolean;
    tasks: FogActiveTask[];
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
    actioningTasks,
    onTaskAction,
}) => {
    const [page, setPage] = useState(1);

    const paginatedTasks = useMemo(
        () => tasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
        [tasks, page],
    );
    const totalPages = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE));

    const taskIds = useMemo(
        () => paginatedTasks.map((t) => t.id),
        [paginatedTasks],
    );

    const [selection, handlers] = useSelection({
        data: taskIds,
        resetSelectionOnDataChange: false,
    });

    const selectedTasks = paginatedTasks.filter((t) =>
        selection.includes(t.id),
    );
    const cancelableIds = selectedTasks
        .filter((t) => !isTerminalState(t.state))
        .map((t) => t.id);
    const forceableIds = selectedTasks
        .filter((t) => {
            const id = t.stateID ?? t.state?.id ?? 0;
            return id === 1 || id === 2;
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
        setPage(1);
    }, [tasks.length]);

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
                            disabled={forceableIds.length === 0}
                            onClick={handleBulkForce}
                        >
                            Force Start ({forceableIds.length})
                        </Button>
                        <Button
                            size='xs'
                            color='red'
                            variant='light'
                            leftSection={<IconTrash size={14} />}
                            disabled={cancelableIds.length === 0}
                            onClick={handleBulkCancel}
                        >
                            Cancel ({cancelableIds.length})
                        </Button>
                    </Group>
                </Group>
            )}
            <Card p={0} withBorder style={{ position: 'relative' }}>
                <Table.ScrollContainer minWidth='100%'>
                    <Table highlightOnHover withRowBorders stickyHeader>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>
                                    <Checkbox
                                        aria-label='Select all tasks'
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
                                <Table.Th>Task</Table.Th>
                                <Table.Th>Host</Table.Th>
                                <Table.Th>Type</Table.Th>
                                <Table.Th>State</Table.Th>
                                <Table.Th>Progress</Table.Th>
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
                                          </Table.Tr>
                                      ),
                                  )
                                : paginatedTasks.map((task) => {
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
                                                            handlers.select(
                                                                task.id,
                                                            )
                                                        }
                                                    />
                                                </Table.Td>
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
                                                              isTerminalState(
                                                                  task.state,
                                                              ) ||
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
                                                              isTerminalState(
                                                                  task.state,
                                                              ) ||
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
            </Card>
            {totalPages > 1 && (
                <Group justify='space-between' align='center'>
                    <Text size='sm' c='dimmed'>
                        {(page - 1) * PAGE_SIZE + 1}–
                        {Math.min(page * PAGE_SIZE, tasks.length)} of{' '}
                        {tasks.length} tasks
                    </Text>
                    <Pagination
                        total={totalPages}
                        value={page}
                        onChange={setPage}
                    />
                </Group>
            )}
        </Stack>
    );
};

export default ActiveTasksTable;
