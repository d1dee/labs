import type { FogHost, FogImage, FogSnapin, FogTaskType } from '@/api/fog';
import {
    ActionIcon,
    Badge,
    Button,
    Card,
    Divider,
    Group,
    Menu,
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

    if (hosts.length === 0) return null;

    const isBulk = hosts.length > 1;

    // Toggle active action (opens if different/closed, closes if same)
    const handleToggleAction = (action: string) => {
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
        (tt) =>
            tt.id !== deployTaskTypeId && tt.id !== captureTaskTypeId,
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
    const headerTitle = isBulk
        ? `${hosts.length} hosts selected`
        : hosts[0].name;
    const headerSub = isBulk
        ? hosts
              .slice(0, 3)
              .map((h) => h.name)
              .join(', ') +
          (hosts.length > 3 ? `, +${hosts.length - 3} more` : '')
        : hosts[0].imagename
          ? `Image: ${hosts[0].imagename}`
          : 'No image assigned';

    return (
        <Card withBorder p='md'>
            <Stack gap='md'>
                {/* ── Header ── */}
                <Group justify='space-between' wrap='nowrap'>
                    <div style={{ minWidth: 0 }}>
                        <Title order={5} style={{ wordBreak: 'break-word' }}>
                            {headerTitle}
                        </Title>
                        <Text size='sm' c='dimmed' truncate>
                            {headerSub}
                        </Text>
                    </div>
                    <Group gap='xs' wrap='nowrap'>
                        {!isBulk && (
                            <Badge size='lg' variant='outline'>
                                ID: {hosts[0].id}
                            </Badge>
                        )}
                        <ActionIcon
                            variant='subtle'
                            color='gray'
                            onClick={onClose}
                            aria-label='Dismiss selection'
                        >
                            <IconX size={16} />
                        </ActionIcon>
                    </Group>
                </Group>

                <Divider />

                {/* ── Action buttons toolbar ── */}
                <Group gap='xs' wrap='wrap'>
                    {deployTaskType && (
                        <Button
                            size='sm'
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
                        variant={activeAction === 'snapin' ? 'filled' : 'light'}
                        color='indigo'
                        leftSection={<IconPlayerPlay size={14} />}
                        onClick={() => handleToggleAction('snapin')}
                    >
                        Snapin
                    </Button>

                    <Button
                        size='sm'
                        variant={activeAction === 'image' ? 'filled' : 'light'}
                        color='blue'
                        leftSection={<IconDatabase size={14} />}
                        onClick={() => handleToggleAction('image')}
                    >
                        Image
                    </Button>

                    {/* Three-dot menu for all other actions hidden away */}
                    <Menu shadow='md' width={220} position='bottom-start'>
                        <Menu.Target>
                            <Button
                                size='sm'
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
                                color='red'
                                leftSection={<IconTrash size={14} />}
                                onClick={() => handleToggleAction('delete')}
                            >
                                Delete
                            </Menu.Item>
                            {captureTaskType && (
                                <Menu.Item
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
                            {extraTaskTypes.map((tt) => (
                                <Menu.Item
                                    key={tt.id}
                                    leftSection={<IconPlayerPlay size={14} />}
                                    onClick={() =>
                                        handleToggleAction(`task-${tt.id}`)
                                    }
                                >
                                    {tt.name}
                                </Menu.Item>
                            ))}
                        </Menu.Dropdown>
                    </Menu>
                </Group>

                {/* ── Active Action Panel ── */}
                {activeAction && (
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

                {/* ── Single-host details ── */}
                {!isBulk && (
                    <Stack gap='xs'>
                        <Divider label='Host details' labelPosition='left' />
                        <Group grow align='flex-start'>
                            <Stack gap={4}>
                                <Text
                                    size='xs'
                                    fw={600}
                                    tt='uppercase'
                                    c='dimmed'
                                >
                                    MAC Addresses
                                </Text>
                                {hosts[0].macs && hosts[0].macs.length > 0 ? (
                                    hosts[0].macs.map((mac) => (
                                        <Text
                                            key={mac}
                                            size='sm'
                                            ff='monospace'
                                        >
                                            {mac}
                                        </Text>
                                    ))
                                ) : (
                                    <Text size='sm' c='dimmed'>
                                        —
                                    </Text>
                                )}
                            </Stack>
                            <Stack gap={4}>
                                <Text
                                    size='xs'
                                    fw={600}
                                    tt='uppercase'
                                    c='dimmed'
                                >
                                    Description
                                </Text>
                                <Text size='sm'>
                                    {hosts[0].description || '—'}
                                </Text>
                            </Stack>
                            {hosts[0].ip && (
                                <Stack gap={4}>
                                    <Text
                                        size='xs'
                                        fw={600}
                                        tt='uppercase'
                                        c='dimmed'
                                    >
                                        IP
                                    </Text>
                                    <Text size='sm' ff='monospace'>
                                        {hosts[0].ip}
                                    </Text>
                                </Stack>
                            )}
                        </Group>
                    </Stack>
                )}
            </Stack>
        </Card>
    );
}
