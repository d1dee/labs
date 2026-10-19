import type { DeviceIdentity, DeviceLab } from '@/api/devices';
import {
    deviceIdentitySearchText,
    useDeviceIdentities,
} from '@/api/useDeviceIdentities';
import { type VeyonCommandAction, type VeyonComputer } from '@/api/veyon';
import { DeviceIdentityDetails } from '@/components/ui/DeviceIdentityDetails';
import {
    useVeyonScreenshots,
    type VeyonScreenshotFrame,
} from '@/components/veyon/useVeyonScreenshots';
import type { LiveState } from '@/components/VeyonManagementTab';
import {
    ActionIcon,
    Box,
    Button,
    Checkbox,
    Group,
    Modal,
    Paper,
    Popover,
    SegmentedControl,
    Select,
    Stack,
    Text,
    TextInput,
    ThemeIcon,
    Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
    IconArrowsMaximize,
    IconArrowsMinimize,
    IconBolt,
    IconEye,
    IconInfoCircle,
    IconKey,
    IconLayoutGrid,
    IconLock,
    IconLockOpen,
    IconPlayerStop,
    IconRefresh,
    IconUser,
} from '@tabler/icons-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

const GRID_GAP = 12;
const ROW_CHROME = 136;
const MAX_ACTIVE = 64;

const REFRESH_OPTIONS = [
    { value: '1000', label: '1s' },
    { value: '2000', label: '2s' },
    { value: '5000', label: '5s' },
    { value: '10000', label: '10s' },
    { value: 'paused', label: 'Paused' },
];

const COLUMN_OPTIONS = [
    { value: 'auto', label: 'Auto' },
    { value: '1', label: '1' },
    { value: '2', label: '2' },
    { value: '3', label: '3' },
    { value: '4', label: '4' },
];

export default function VeyonMonitoringWall({
    opened,
    computers,
    live,
    initialSelection,
    onClose,
    onOpenViewer,
    onCommand,
}: {
    opened: boolean;
    computers: VeyonComputer[];
    live: Record<string, LiveState>;
    initialSelection?: string[];
    onClose: () => void;
    onOpenViewer: (computer: VeyonComputer) => void;
    onCommand: (
        computerId: string,
        action: VeyonCommandAction,
        active?: boolean,
    ) => void | Promise<void>;
}) {
    const identities = useDeviceIdentities();
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [columns, setColumns] = useState('auto');
    const [refresh, setRefresh] = useState('1000');
    const [search, setSearch] = useState('');
    const [selectionSearch, setSelectionSearch] = useState('');
    const [labFilter, setLabFilter] = useState<string | null>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [viewport, setViewport] = useState({ width: 1024, height: 600 });
    const [activeIds, setActiveIds] = useState<string[]>([]);
    const [pinnedId, setPinnedId] = useState<string | null>(null);
    const [viewportElement, setViewportElement] =
        useState<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!opened) return;
        const valid = (initialSelection ?? []).filter((id) =>
            computers.some((computer) => computer.id === id),
        );
        const base = valid.length
            ? valid
            : computers
                  .filter((computer) => live[computer.id]?.state === 'online')
                  .map((computer) => computer.id);
        setSelectedIds([...new Set(base)]);
        setSearch('');
        setSelectionSearch('');
        setLabFilter(null);
        setScrollTop(0);
    }, [opened]);

    const refreshMs = refresh === 'paused' ? null : Number(refresh);

    const selectedSet = new Set(selectedIds);
    const selectedComputers = computers.filter((computer) =>
        selectedSet.has(computer.id),
    );
    const identityQuery = (computer: VeyonComputer) => ({
        veyonComputerId: computer.id,
        macAddress: computer.macAddress,
        address: computer.host,
    });
    const matchesLab = (computer: VeyonComputer) =>
        !labFilter ||
        identities.labFor(identityQuery(computer))?.id === labFilter;
    const matchesSearch = (computer: VeyonComputer, query: string) =>
        [
            computer.name,
            computer.host,
            computer.location ?? '',
            identities.labFor(identityQuery(computer))?.name ?? '',
            deviceIdentitySearchText(
                identities.lookup(identityQuery(computer)),
            ),
        ]
            .join(' ')
            .toLowerCase()
            .includes(query.trim().toLowerCase());
    const filteredComputers = selectedComputers.filter(
        (computer) => matchesLab(computer) && matchesSearch(computer, search),
    );
    const availableColumns =
        viewport.width < 600
            ? 1
            : viewport.width < 900
              ? 2
              : viewport.width < 1200
                ? 3
                : 4;
    const gridColumns =
        columns === 'auto'
            ? Math.min(
                  availableColumns,
                  Math.max(1, Math.ceil(Math.sqrt(filteredComputers.length))),
              )
            : Number(columns);
    const tileWidth = Math.max(
        1,
        (viewport.width - GRID_GAP * (gridColumns - 1)) / gridColumns,
    );
    const rowHeight = Math.ceil(
        (Math.max(1, tileWidth - 22) * 9) / 16 + ROW_CHROME + GRID_GAP,
    );
    const rowCount = Math.ceil(filteredComputers.length / gridColumns);
    const firstRow = Math.min(
        Math.max(0, rowCount - 1),
        Math.floor(scrollTop / rowHeight),
    );
    const endRow = Math.min(
        rowCount,
        Math.ceil((scrollTop + viewport.height) / rowHeight),
    );
    const startBufferedRow = Math.max(0, firstRow - 1);
    const endBufferedRow = Math.min(rowCount, endRow + 1);
    const bufferedComputers = filteredComputers.slice(
        startBufferedRow * gridColumns,
        endBufferedRow * gridColumns,
    );
    const mountedComputers = [...bufferedComputers];
    const pinnedComputer = selectedComputers.find(
        (computer) => computer.id === pinnedId,
    );
    if (
        pinnedComputer &&
        !mountedComputers.some((computer) => computer.id === pinnedId)
    )
        mountedComputers.push(pinnedComputer);
    const visibleComputers = filteredComputers.slice(
        firstRow * gridColumns,
        endRow * gridColumns,
    );
    // Prioritize what is actually visible before overscan when an extreme
    // viewport exceeds the shared stream's active-machine bound.
    const subscriptionKey = [
        ...new Set([
            ...(pinnedComputer ? [pinnedComputer.id] : []),
            ...visibleComputers.map((computer) => computer.id),
            ...bufferedComputers.map((computer) => computer.id),
        ]),
    ]
        .slice(0, MAX_ACTIVE)
        .join(',');

    useEffect(() => {
        if (!opened) {
            setActiveIds([]);
            return;
        }
        const timer = window.setTimeout(
            () =>
                setActiveIds(subscriptionKey ? subscriptionKey.split(',') : []),
            150,
        );
        return () => window.clearTimeout(timer);
    }, [opened, subscriptionKey]);

    useEffect(() => {
        if (!opened || !viewportElement) return;
        const element = viewportElement;
        const measure = () => {
            const width = element.clientWidth;
            const height = element.clientHeight;
            if (width > 0 && height > 0) setViewport({ width, height });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [opened, viewportElement]);

    useEffect(() => {
        if (viewportElement) viewportElement.scrollTop = 0;
        setScrollTop(0);
    }, [search, labFilter, columns, selectedIds, viewportElement]);

    useEffect(() => {
        const pinFullscreen = () =>
            setPinnedId(
                document.fullscreenElement?.getAttribute('data-tile-id') ??
                    null,
            );
        document.addEventListener('fullscreenchange', pinFullscreen);
        return () =>
            document.removeEventListener('fullscreenchange', pinFullscreen);
    }, []);

    const {
        frames,
        connected,
        refreshOnce: refreshGrid,
    } = useVeyonScreenshots(
        opened ? activeIds.filter((id) => id !== pinnedComputer?.id) : [],
        {
            paused: refresh === 'paused',
            minFrameIntervalMs: refreshMs,
            width: gridColumns >= 3 ? 320 : 640,
            quality: gridColumns >= 3 ? 50 : 65,
            priority: 'grid',
        },
    );
    const fullscreen = useVeyonScreenshots(
        opened && pinnedComputer ? [pinnedComputer.id] : [],
        {
            paused: refresh === 'paused',
            minFrameIntervalMs: refreshMs,
            width: 1280,
            quality: 75,
            priority: 'viewer',
        },
    );
    const refreshOnce = () => {
        refreshGrid();
        if (pinnedComputer) fullscreen.refreshOnce();
    };
    const onlineCount = selectedComputers.filter(
        (computer) => live[computer.id]?.state === 'online',
    ).length;

    const handleOpenViewer = useCallback(
        (computer: VeyonComputer) => onOpenViewer(computer),
        [onOpenViewer],
    );

    const handleCommand = useCallback(
        (computerId: string, action: VeyonCommandAction, active = true) =>
            onCommand(computerId, action, active),
        [onCommand],
    );

    const stopSession = () => {
        setRefresh('paused');
        if (document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen().catch(() => undefined);
        }
        onClose();
    };

    return (
        <Modal
            opened={opened}
            onClose={onClose}
            title='Live monitoring wall'
            fullScreen
            styles={{
                content: {
                    height: '100dvh',
                    maxHeight: '100dvh',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                },
                header: { flexShrink: 0 },
                body: {
                    flex: 1,
                    minHeight: 0,
                    display: 'flex',
                    overflow: 'auto',
                },
            }}
        >
            <Stack gap='md' style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                <Group
                    justify='space-between'
                    wrap='wrap'
                    style={{ flexShrink: 0 }}
                >
                    <Group gap='xs'>
                        <IconInfoCircle
                            size={16}
                            style={{ color: 'var(--mantine-color-gray-6)' }}
                        />
                        <Text size='sm' c='dimmed'>
                            {selectedComputers.length} selected · {onlineCount}{' '}
                            online · {visibleComputers.length} visible
                            {refresh === 'paused'
                                ? ' · paused'
                                : !connected &&
                                    !fullscreen.connected &&
                                    selectedComputers.length > 0
                                  ? ' · reconnecting'
                                  : ''}
                        </Text>
                    </Group>
                    <Group gap='xs'>
                        <ActionIcon
                            variant='light'
                            aria-label='Refresh now'
                            onClick={refreshOnce}
                        >
                            <IconRefresh size={16} />
                        </ActionIcon>
                        <Button
                            variant='light'
                            color='red'
                            leftSection={<IconPlayerStop size={16} />}
                            onClick={stopSession}
                        >
                            Stop session
                        </Button>
                    </Group>
                </Group>

                <Group
                    justify='space-between'
                    align='flex-end'
                    wrap='wrap'
                    style={{ flexShrink: 0 }}
                >
                    <Group
                        gap='xs'
                        align='flex-end'
                        w={{ base: '100%', md: 'auto' }}
                        style={{ flex: '1 1 auto', minWidth: 0 }}
                    >
                        <Popover
                            width={320}
                            position='bottom-start'
                            shadow='md'
                            withinPortal={false}
                        >
                            <Popover.Target>
                                <Button
                                    variant='default'
                                    size='sm'
                                    aria-label='Choose monitored computers'
                                    style={{ flexShrink: 0 }}
                                >
                                    {selectedComputers.length} selected
                                </Button>
                            </Popover.Target>
                            <Popover.Dropdown>
                                <Stack gap='sm'>
                                    <TextInput
                                        label='Find computers to select'
                                        value={selectionSearch}
                                        onChange={(event) =>
                                            setSelectionSearch(
                                                event.currentTarget.value,
                                            )
                                        }
                                    />
                                    <Button
                                        variant='subtle'
                                        size='xs'
                                        onClick={() => setSelectedIds([])}
                                    >
                                        Clear selection
                                    </Button>
                                    <Box
                                        style={{
                                            maxHeight: 280,
                                            overflowY: 'auto',
                                        }}
                                    >
                                        <Stack gap='xs'>
                                            {computers
                                                .filter(
                                                    (computer) =>
                                                        matchesLab(computer) &&
                                                        matchesSearch(
                                                            computer,
                                                            selectionSearch,
                                                        ),
                                                )
                                                .map((computer) => (
                                                    <Checkbox
                                                        key={computer.id}
                                                        aria-label={
                                                            computer.name
                                                        }
                                                        label={
                                                            <DeviceIdentityDetails
                                                                identity={identities.lookup(
                                                                    identityQuery(
                                                                        computer,
                                                                    ),
                                                                )}
                                                                hostname={
                                                                    computer.name ||
                                                                    computer.host
                                                                }
                                                                address={
                                                                    computer.host
                                                                }
                                                                lab={identities.labFor(
                                                                    identityQuery(
                                                                        computer,
                                                                    ),
                                                                )}
                                                            />
                                                        }
                                                        checked={selectedSet.has(
                                                            computer.id,
                                                        )}
                                                        onChange={(event) => {
                                                            const checked =
                                                                event
                                                                    .currentTarget
                                                                    .checked;
                                                            setSelectedIds(
                                                                (ids) =>
                                                                    checked
                                                                        ? [
                                                                              ...ids,
                                                                              computer.id,
                                                                          ]
                                                                        : ids.filter(
                                                                              (
                                                                                  id,
                                                                              ) =>
                                                                                  id !==
                                                                                  computer.id,
                                                                          ),
                                                            );
                                                        }}
                                                    />
                                                ))}
                                        </Stack>
                                    </Box>
                                </Stack>
                            </Popover.Dropdown>
                        </Popover>
                        <Button
                            variant='light'
                            size='sm'
                            style={{ flexShrink: 0 }}
                            onClick={() =>
                                setSelectedIds((ids) => [
                                    ...new Set([
                                        ...ids,
                                        ...computers
                                            .filter(matchesLab)
                                            .map((computer) => computer.id),
                                    ]),
                                ])
                            }
                        >
                            Select all
                        </Button>
                        <Select
                            aria-label='Lab'
                            placeholder='All labs'
                            clearable
                            searchable
                            size='sm'
                            value={labFilter}
                            onChange={setLabFilter}
                            data={identities.labs.map((lab) => ({
                                value: lab.id,
                                label: lab.name,
                            }))}
                            miw={180}
                        />
                        <TextInput
                            aria-label='Search computers'
                            placeholder='Search name, host or location...'
                            value={search}
                            onChange={(event) =>
                                setSearch(event.currentTarget.value)
                            }
                            size='sm'
                            style={{ flex: 1, minWidth: 180 }}
                        />
                    </Group>
                    <Stack gap={4}>
                        <Text size='xs' c='dimmed' fw={600}>
                            Columns
                        </Text>
                        <SegmentedControl
                            size='xs'
                            value={columns}
                            onChange={setColumns}
                            data={COLUMN_OPTIONS}
                        />
                    </Stack>
                    <Stack gap={4}>
                        <Text size='xs' c='dimmed' fw={600}>
                            Refresh
                        </Text>
                        <SegmentedControl
                            size='xs'
                            value={refresh}
                            onChange={setRefresh}
                            data={REFRESH_OPTIONS}
                        />
                    </Stack>
                </Group>

                <Box
                    ref={setViewportElement}
                    data-testid='monitoring-viewport'
                    data-selected-count={selectedComputers.length}
                    data-filtered-count={filteredComputers.length}
                    data-visible-count={visibleComputers.length}
                    data-mounted-count={mountedComputers.length}
                    data-active-count={opened ? activeIds.length : 0}
                    data-grid-columns={gridColumns}
                    data-row-height={rowHeight}
                    onScroll={(event) =>
                        setScrollTop(event.currentTarget.scrollTop)
                    }
                    style={{
                        flex: 1,
                        minHeight: 300,
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        position: 'relative',
                    }}
                >
                    {mountedComputers.length ? (
                        <Box
                            data-cols={
                                columns === 'auto' ? 'auto' : Number(columns)
                            }
                            style={{
                                height: rowCount * rowHeight,
                                position: 'relative',
                            }}
                        >
                            {mountedComputers.map((computer) => {
                                const index = filteredComputers.findIndex(
                                    (item) => item.id === computer.id,
                                );
                                return (
                                    <Box
                                        key={computer.id}
                                        style={{
                                            position: 'absolute',
                                            top:
                                                Math.floor(
                                                    Math.max(0, index) /
                                                        gridColumns,
                                                ) * rowHeight,
                                            left:
                                                (Math.max(0, index) %
                                                    gridColumns) *
                                                (tileWidth + GRID_GAP),
                                            width: tileWidth,
                                            height: rowHeight - GRID_GAP,
                                        }}
                                    >
                                        <WallTile
                                            computer={computer}
                                            identity={identities.lookup(
                                                identityQuery(computer),
                                            )}
                                            lab={identities.labFor(
                                                identityQuery(computer),
                                            )}
                                            live={live[computer.id]}
                                            frame={
                                                computer.id ===
                                                pinnedComputer?.id
                                                    ? fullscreen.frames[
                                                          computer.id
                                                      ]
                                                    : frames[computer.id]
                                            }
                                            streaming={
                                                (computer.id ===
                                                pinnedComputer?.id
                                                    ? fullscreen.connected
                                                    : connected) &&
                                                refresh !== 'paused'
                                            }
                                            transportStale={
                                                !(computer.id ===
                                                pinnedComputer?.id
                                                    ? fullscreen.connected
                                                    : connected) &&
                                                refresh !== 'paused'
                                            }
                                            onOpenViewer={handleOpenViewer}
                                            onCommand={handleCommand}
                                        />
                                    </Box>
                                );
                            })}
                        </Box>
                    ) : (
                        <Stack align='center' py={80} gap='sm'>
                            <ThemeIcon
                                variant='light'
                                color='gray'
                                size={56}
                                radius='xl'
                            >
                                <IconLayoutGrid size={28} />
                            </ThemeIcon>
                            <Text fw={600}>
                                {selectedComputers.length
                                    ? 'No matching computers'
                                    : 'No computers on the wall'}
                            </Text>
                            <Text size='sm' c='dimmed'>
                                {selectedComputers.length
                                    ? 'Change the search or lab filter to find a selected computer.'
                                    : 'Pick computers above to start live monitoring.'}
                            </Text>
                        </Stack>
                    )}
                </Box>
            </Stack>
        </Modal>
    );
}

// Double-buffered tile: the previous frame stays visible until the next one
// arrives, and failed polls only mark the frame stale instead of blanking.
const TileImage = memo(function TileImage({
    computerId,
    computerName,
    frame,
    fullscreen,
    transportStale,
    onImageError,
}: {
    computerId: string;
    computerName: string;
    frame: VeyonScreenshotFrame | undefined;
    fullscreen: boolean;
    transportStale: boolean;
    onImageError: (failed: boolean) => void;
}) {
    const [failedImage, setFailedImage] = useState<string | null>(null);
    const hasImage = Boolean(frame?.image);
    const imageFailed = Boolean(frame?.image && failedImage === frame.image);
    // Only surface the full overlay when there is nothing to show or the
    // host keeps failing; a transient failure keeps the last frame with a
    // stale badge instead.
    const failing = (frame?.consecutiveFailures ?? 0) >= 3;
    const overlay =
        !hasImage || failing || imageFailed ? 'Screen unavailable' : null;

    useEffect(() => {
        onImageError(!hasImage || failing || imageFailed);
    }, [hasImage, failing, imageFailed, onImageError]);

    return (
        <Box
            data-computer-id={computerId}
            style={{
                position: 'relative',
                aspectRatio: fullscreen ? undefined : '16 / 9',
                flex: fullscreen ? 1 : undefined,
                minHeight: 0,
                overflow: 'hidden',
                borderRadius: 'var(--mantine-radius-sm)',
                background: 'var(--mantine-color-dark-8)',
            }}
        >
            <img
                src={frame?.image ?? undefined}
                onError={() => setFailedImage(frame?.image ?? null)}
                alt={`Screen of ${computerName}`}
                aria-busy={!hasImage}
                decoding='async'
                style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                }}
            />
            {overlay !== null ? (
                <Box
                    style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 8,
                        background: 'rgba(0, 0, 0, 0.55)',
                    }}
                >
                    <Text size='xs' c='white' ta='center' lineClamp={2}>
                        {overlay}
                    </Text>
                </Box>
            ) : (frame?.stale || transportStale) && hasImage ? (
                <Box
                    style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        padding: '2px 8px',
                        borderRadius: 'var(--mantine-radius-sm)',
                        background: 'rgba(0, 0, 0, 0.55)',
                    }}
                >
                    <Text size='xs' c='white'>
                        Stale
                    </Text>
                </Box>
            ) : null}
        </Box>
    );
});

const WallTile = memo(function WallTile({
    computer,
    identity,
    lab,
    live,
    frame,
    streaming,
    transportStale,
    onOpenViewer,
    onCommand,
}: {
    computer: VeyonComputer;
    identity: DeviceIdentity | null;
    lab: DeviceLab | null;
    live?: LiveState;
    frame: VeyonScreenshotFrame | undefined;
    streaming: boolean;
    transportStale: boolean;
    onOpenViewer: (computer: VeyonComputer) => void;
    onCommand: (
        computerId: string,
        action: VeyonCommandAction,
        active?: boolean,
    ) => void | Promise<void>;
}) {
    const tileRef = useRef<HTMLDivElement>(null);
    const [imageFailed, setImageFailed] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);

    useEffect(() => {
        const handler = () =>
            setIsFullscreen(
                Boolean(document.fullscreenElement) &&
                    document.fullscreenElement === tileRef.current,
            );
        document.addEventListener('fullscreenchange', handler);
        return () => document.removeEventListener('fullscreenchange', handler);
    }, []);

    const handleImageError = useCallback(
        (failed: boolean) => setImageFailed(failed),
        [],
    );

    const information = live?.state === 'online' ? live.information : null;
    const online =
        streaming &&
        Boolean(frame?.image) &&
        !frame?.stale &&
        !frame?.consecutiveFailures &&
        !frame?.lastError &&
        !imageFailed;

    const toggleFullscreen = async () => {
        try {
            if (document.fullscreenElement) {
                if (document.exitFullscreen) await document.exitFullscreen();
            } else if (tileRef.current?.requestFullscreen) {
                await tileRef.current?.requestFullscreen();
            } else {
                notifications.show({
                    color: 'orange',
                    title: 'Fullscreen unavailable',
                    message:
                        'This browser does not support fullscreen for the monitoring wall.',
                });
            }
        } catch {
            notifications.show({
                color: 'red',
                title: 'Fullscreen failed',
                message: `Could not toggle fullscreen for ${computer.name}.`,
            });
        }
    };

    return (
        <Paper
            data-tile-id={computer.id}
            style={{ height: '100%', minWidth: 0, overflow: 'hidden' }}
            withBorder
            radius='md'
            p='xs'
            ref={tileRef}
            tabIndex={0}
            aria-label={`Monitoring tile for ${computer.name}`}
            onKeyDown={(event) => {
                if (
                    event.key === 'Enter' &&
                    event.target === event.currentTarget
                )
                    onOpenViewer(computer);
            }}
        >
            <Stack gap='xs' style={{ height: '100%', minHeight: 0 }}>
                <Group justify='space-between' wrap='nowrap' gap='xs'>
                    <Group gap='xs' wrap='nowrap' style={{ minWidth: 0 }}>
                        <Box
                            aria-hidden
                            style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                flexShrink: 0,
                                background: online
                                    ? 'var(--mantine-color-teal-5)'
                                    : 'var(--mantine-color-gray-5)',
                            }}
                        />
                        <div style={{ minWidth: 0 }}>
                            <DeviceIdentityDetails
                                identity={identity}
                                hostname={computer.name || computer.host}
                                address={computer.host}
                                lab={lab}
                            />
                            {!lab && !identity?.lab ? (
                                <Text size='xs' c='dimmed'>
                                    {computer.location || 'Unassigned'}
                                </Text>
                            ) : null}
                        </div>
                    </Group>
                    <Group gap={2} wrap='nowrap'>
                        <Tooltip
                            label={
                                isFullscreen ? 'Exit fullscreen' : 'Fullscreen'
                            }
                        >
                            <ActionIcon
                                variant='subtle'
                                size='sm'
                                aria-label={`Fullscreen ${computer.name}`}
                                onClick={() => void toggleFullscreen()}
                            >
                                {isFullscreen ? (
                                    <IconArrowsMinimize size={15} />
                                ) : (
                                    <IconArrowsMaximize size={15} />
                                )}
                            </ActionIcon>
                        </Tooltip>
                        <Tooltip label='Open details'>
                            <ActionIcon
                                variant='subtle'
                                size='sm'
                                aria-label={`Open details for ${computer.name}`}
                                onClick={() => onOpenViewer(computer)}
                            >
                                <IconEye size={15} />
                            </ActionIcon>
                        </Tooltip>
                        <Tooltip label='Lock screen'>
                            <ActionIcon
                                variant='subtle'
                                size='sm'
                                color='orange'
                                aria-label={`Lock screen ${computer.name}`}
                                onClick={() =>
                                    void onCommand(computer.id, 'screen-lock')
                                }
                            >
                                <IconLock size={15} />
                            </ActionIcon>
                        </Tooltip>
                        <Tooltip label='Unlock screen'>
                            <ActionIcon
                                variant='subtle'
                                size='sm'
                                color='teal'
                                aria-label={`Unlock screen ${computer.name}`}
                                onClick={() =>
                                    void onCommand(computer.id, 'screen-lock', false)
                                }
                            >
                                <IconLockOpen size={15} />
                            </ActionIcon>
                        </Tooltip>
                        <Tooltip label='Lock input'>
                            <ActionIcon
                                variant='subtle'
                                size='sm'
                                color='orange'
                                aria-label={`Lock input ${computer.name}`}
                                onClick={() =>
                                    void onCommand(computer.id, 'input-lock')
                                }
                            >
                                <IconKey size={15} />
                            </ActionIcon>
                        </Tooltip>
                        <Tooltip label='Unlock input'>
                            <ActionIcon
                                variant='subtle'
                                size='sm'
                                color='teal'
                                aria-label={`Unlock input ${computer.name}`}
                                onClick={() =>
                                    void onCommand(computer.id, 'input-lock', false)
                                }
                            >
                                <IconBolt size={15} />
                            </ActionIcon>
                        </Tooltip>
                    </Group>
                </Group>
                <TileImage
                    computerId={computer.id}
                    computerName={computer.name}
                    frame={frame}
                    fullscreen={isFullscreen}
                    transportStale={transportStale}
                    onImageError={handleImageError}
                />
                {information?.user.login ? (
                    <Group gap={4} wrap='nowrap'>
                        <IconUser size={13} style={{ flexShrink: 0 }} />
                        <Text size='xs' c='dimmed' truncate>
                            {information.user.fullName ||
                                information.user.login}
                        </Text>
                    </Group>
                ) : (
                    <Text size='xs' c='dimmed'>
                        No user logged in
                    </Text>
                )}
            </Stack>
        </Paper>
    );
});
