import type { FogHost, FogImage, FogSnapin, FogTaskType } from '@/api/fog';
import {
    ActionIcon,
    Badge,
    Button,
    Card,
    Group,
    Menu,
    ScrollArea,
    Stack,
    Text,
    Title,
} from '@mantine/core';
import {
    IconChevronDown,
    IconDatabase,
    IconDots,
    IconPlayerPlay,
    IconTrash,
    IconX,
} from '@tabler/icons-react';
import { useState } from 'react';
import { DeletePanel } from './panels/DeletePanel';
import { ImagePanel } from './panels/ImagePanel';
import { SnapinPanel } from './panels/SnapinPanel';
import { TaskPanel } from './panels/TaskPanel';

export interface SelectedHostCardProps {
    /** The currently selected host(s) */
    hosts: FogHost[];
    images: FogImage[];
    snapins: FogSnapin[];
    taskTypes: FogTaskType[];
    deployTaskTypeId: number | null;
    captureTaskTypeId: number | null;
    /** Called when hosts were deleted so the parent can remove them */
    onHostsDeleted: (deletedIds: number[]) => void;
    /** Called when a single host was updated so parent can refresh its copy */
    onHostUpdated: (host: FogHost) => void;
    /** Called to dismiss/clear the selection */
    onClose: () => void;
}

export function SelectedHostCard({
    hosts,
    images,
    snapins,
    taskTypes,
    deployTaskTypeId,
    captureTaskTypeId,
    onHostsDeleted,
    onHostUpdated,
    onClose,
}: SelectedHostCardProps) {
    /** Which action panel is currently active (null = hidden) */
    const [activeAction, setActiveAction] = useState<string | null>(null);

    const hasHosts = hosts.length > 0;
    const isBulk = hosts.length > 1;

    // Toggle active action (opens if different/closed, closes if same)
    const handleToggleAction = (action: string) => {
        if (!hasHosts) return;
        setActiveAction((prev) => (prev === action ? null : action));
    };

    // Pre-resolve the deploy and capture task types from the reference list
    const deployTaskType = deployTaskTypeId
        ? taskTypes.find((t) => t.id === deployTaskTypeId)
        : undefined;

    const captureTaskType = captureTaskTypeId
        ? taskTypes.find((t) => t.id === captureTaskTypeId)
        : undefined;

    /** Task types not directly surfaced as top-level buttons or capture */
    const extraTaskTypes = taskTypes.filter(
        (tt) => tt.id !== deployTaskTypeId && tt.id !== captureTaskTypeId,
    );

    // Resolve the active task type if the current active action is a task
    const activeTaskType = activeAction?.startsWith('task-')
        ? taskTypes.find((t) => `task-${t.id}` === activeAction)
        : undefined;

    // Determine the title of the active panel
    let panelTitle = '';
    if (activeAction === 'image') panelTitle = 'Image Assignment';
    else if (activeAction === 'snapin') panelTitle = 'Send Snapin';
    else if (activeAction === 'delete') panelTitle = 'Delete Hosts';
    else if (activeTaskType) panelTitle = `Run Task: ${activeTaskType.name}`;

    // ──────────────────────────────────────────────
    //  Header summary
    // ──────────────────────────────────────────────
    const headerTitle = !hasHosts
        ? 'Select hosts to enable actions'
        : isBulk
          ? `${hosts.length} hosts selected`
          : hosts[0].name;
    const headerSub = !hasHosts
        ? ''
        : isBulk
          ? hosts
                .slice(0, 3)
                .map((h) => h.name)
                .join(', ') +
            (hosts.length > 3 ? `, +${hosts.length - 3} more` : '')
          : hosts[0].imagename
            ? `Image: ${hosts[0].imagename}`
            : 'No image assigned';

    return (
        <Card withBorder p='sm'>
            <Stack gap='xs'>
                {/* ── Header ── */}
                <Group justify='space-between' wrap='nowrap'>
                    <Stack gap={0} style={{ minWidth: 0 }}>
                        <Title order={4}>
                            Command deck
                        </Title>
                        <Text size='sm' c='dimmed' truncate title={headerSub}>
                            {headerTitle}
                        </Text>
                    </Stack>
                    <Group gap='xs' wrap='nowrap'>
                        {hasHosts && !isBulk && (
                            <Badge size='sm' variant='outline'>
                                ID: {hosts[0].id}
                            </Badge>
                        )}
                        <ActionIcon
                            variant='subtle'
                            color='gray'
                            onClick={onClose}
                            disabled={!hasHosts}
                            aria-label='Dismiss selection'
                        >
                            <IconX size={16} />
                        </ActionIcon>
                    </Group>
                </Group>

                {/* ── Action buttons toolbar ── */}
                <Group gap='xs' wrap='wrap'>
                    {deployTaskType && (
                        <Button
                            size='sm'
                            disabled={!hasHosts}
                            variant={
                                activeAction === `task-${deployTaskType.id}`
                                    ? 'filled'
                                    : 'light'
                            }
                            color='green'
                            leftSection={<IconPlayerPlay size={14} />}
                            onClick={() =>
                                handleToggleAction(`task-${deployTaskType.id}`)
                            }
                        >
                            Deploy
                        </Button>
                    )}

                    <Button
                        size='sm'
                        disabled={!hasHosts}
                        variant={activeAction === 'snapin' ? 'filled' : 'light'}
                        color='indigo'
                        leftSection={<IconPlayerPlay size={14} />}
                        onClick={() => handleToggleAction('snapin')}
                    >
                        Snapin
                    </Button>

                    <Button
                        size='sm'
                        disabled={!hasHosts}
                        variant={activeAction === 'image' ? 'filled' : 'light'}
                        color='blue'
                        leftSection={<IconDatabase size={14} />}
                        onClick={() => handleToggleAction('image')}
                    >
                        Image
                    </Button>

                    {/* Three-dot menu for all other actions hidden away */}
                    <Menu
                        shadow='md'
                        width={220}
                        position='bottom-start'
                        withinPortal
                    >
                        <Menu.Target>
                            <Button
                                size='sm'
                                disabled={!hasHosts}
                                variant='default'
                                aria-label='More actions'
                                leftSection={<IconDots size={16} />}
                                rightSection={<IconChevronDown size={14} />}
                            >
                                More
                            </Button>
                        </Menu.Target>
                        <Menu.Dropdown>
                            <Menu.Label>Actions</Menu.Label>
                            <Menu.Item
                                disabled={!hasHosts}
                                color='red'
                                leftSection={<IconTrash size={14} />}
                                onClick={() => handleToggleAction('delete')}
                            >
                                Delete
                            </Menu.Item>

                            {captureTaskType && (
                                <Menu.Item
                                    disabled={!hasHosts}
                                    leftSection={<IconPlayerPlay size={14} />}
                                    onClick={() =>
                                        handleToggleAction(
                                            `task-${captureTaskType.id}`,
                                        )
                                    }
                                >
                                    Capture
                                </Menu.Item>
                            )}

                            {extraTaskTypes.length > 0 && <Menu.Divider />}
                            {extraTaskTypes.length > 0 && (
                                <Menu.Label>Other Tasks</Menu.Label>
                            )}
                            {extraTaskTypes.length > 0 && (
                                <ScrollArea.Autosize mah={200}>
                                    {extraTaskTypes.map((tt) => (
                                        <Menu.Item
                                            key={tt.id}
                                            disabled={!hasHosts}
                                            leftSection={<IconPlayerPlay size={14} />}
                                            onClick={() =>
                                                handleToggleAction(`task-${tt.id}`)
                                            }
                                        >
                                            {tt.name}
                                        </Menu.Item>
                                    ))}
                                </ScrollArea.Autosize>
                            )}
                        </Menu.Dropdown>
                    </Menu>
                </Group>

                {/* ── Active Action Panel ── */}
                {hasHosts && activeAction && (
                    <Card p='sm' mt='xs' withBorder>
                        <Group justify='space-between' mb='sm'>
                            <Text fw={600} size='sm'>
                                {panelTitle}
                            </Text>
                            <ActionIcon
                                size='xs'
                                variant='subtle'
                                color='gray'
                                onClick={() => setActiveAction(null)}
                                aria-label='Close panel'
                            >
                                <IconX size={12} />
                            </ActionIcon>
                        </Group>

                        {activeAction === 'image' && (
                            <ImagePanel
                                hosts={hosts}
                                images={images}
                                onDone={(updated) => {
                                    setActiveAction(null);
                                    if (updated) onHostUpdated(updated);
                                }}
                                onImageAssigned={(updatedHosts) => {
                                    updatedHosts.forEach((h) =>
                                        onHostUpdated(h),
                                    );
                                }}
                            />
                        )}
                        {activeAction === 'snapin' && (
                            <SnapinPanel
                                hosts={hosts}
                                snapins={snapins}
                                onDone={() => setActiveAction(null)}
                            />
                        )}
                        {activeAction === 'delete' && (
                            <DeletePanel
                                hosts={hosts}
                                onDone={(deletedIds) => {
                                    setActiveAction(null);
                                    onHostsDeleted(deletedIds);
                                }}
                            />
                        )}
                        {activeTaskType && (
                            <TaskPanel
                                key={activeAction}
                                hosts={hosts}
                                taskType={activeTaskType}
                                onDone={() => setActiveAction(null)}
                            />
                        )}
                    </Card>
                )}
            </Stack>
        </Card>
    );
}
