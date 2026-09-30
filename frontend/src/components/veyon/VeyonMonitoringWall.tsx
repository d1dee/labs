import {
    veyonFramebufferUrl,
    type VeyonCommandAction,
    type VeyonComputer,
} from '@/api/veyon';
import type { LiveState } from '@/components/VeyonManagementTab';
import {
    ActionIcon,
    Alert,
    Box,
    Button,
    Group,
    Modal,
    MultiSelect,
    Paper,
    SegmentedControl,
    SimpleGrid,
    Stack,
    Text,
    ThemeIcon,
    Tooltip,
    type StyleProp,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
    IconAlertCircle,
    IconArrowsMaximize,
    IconArrowsMinimize,
    IconCheck,
    IconEye,
    IconInfoCircle,
    IconLayoutGrid,
    IconLock,
    IconPlayerStop,
    IconRefresh,
    IconUser,
} from '@tabler/icons-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

const MAX_TILES = 16;

// Frames per wall are fetched through one shared scheduler: browsers cap
// HTTP/1.1 at ~6 connections per origin, so unconstrained per-tile polling
// causes head-of-line blocking and stale frames. Five concurrent fetches
// keep the wall saturated while leaving a connection for control-plane calls.
export const FRAME_CONCURRENCY = 5;

const REFRESH_OPTIONS = [
    { value: '1000', label: '1s' },
    { value: '2000', label: '2s' },
    { value: '5000', label: '5s' },
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
    onCommand: (computerId: string, action: VeyonCommandAction) => void | Promise<void>;
}) {
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [columns, setColumns] = useState('auto');
    const [refresh, setRefresh] = useState('1000');
    const [refreshSignal, setRefreshSignal] = useState(0);
    const [capped, setCapped] = useState(false);
    const scheduler = useMemo(() => new FrameScheduler(FRAME_CONCURRENCY), []);

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
        setSelectedIds(base.slice(0, MAX_TILES));
        setCapped(base.length > MAX_TILES);
        setRefreshSignal((current) => current + 1);
    }, [opened]);

    const refreshMs = refresh === 'paused' ? null : Number(refresh);

    const selectedComputers = computers.filter((computer) => selectedIds.includes(computer.id));
    const selectData = useMemo(
        () => computers.map((computer) => ({ value: computer.id, label: computer.name })),
        [computers],
    );
    // Auto columns respond to the viewport: one column on phones up to the
    // sqrt-based maximum (capped at 4) on wide screens.
    const autoColumns = Math.min(
        4,
        Math.max(1, Math.ceil(Math.sqrt(selectedComputers.length))),
    );
    const gridCols: StyleProp<number> =
        columns === 'auto'
            ? {
                  base: 1,
                  sm: Math.min(2, autoColumns),
                  lg: Math.min(3, autoColumns),
                  xl: autoColumns,
              }
            : Number(columns);
    const onlineCount = selectedComputers.filter(
        (computer) => live[computer.id]?.state === 'online',
    ).length;

    const handleOpenViewer = useCallback(
        (computer: VeyonComputer) => onOpenViewer(computer),
        [onOpenViewer],
    );

    const handleCommand = useCallback(
        (computerId: string, action: VeyonCommandAction) => onCommand(computerId, action),
        [onCommand],
    );

    const handleSelectionChange = (value: string[]) => {
        setSelectedIds(value.slice(0, MAX_TILES));
        setCapped(value.length > MAX_TILES);
    };

    const stopSession = () => {
        setRefresh('paused');
        if (document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen().catch(() => undefined);
        }
        onClose();
    };

    return (
        <Modal opened={opened} onClose={onClose} title='Live monitoring wall' fullScreen>
            <Stack gap='md'>
                <Group justify='space-between' wrap='wrap'>
                    <Group gap='xs'>
                        <IconInfoCircle size={16} style={{ color: 'var(--mantine-color-gray-6)' }} />
                        <Text size='sm' c='dimmed'>
                            {selectedComputers.length} visible · {onlineCount} online
                        </Text>
                    </Group>
                    <Group gap='xs'>
                        <ActionIcon
                            variant='light'
                            aria-label='Refresh now'
                            onClick={() => setRefreshSignal((current) => current + 1)}
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

                {capped ? (
                    <Alert color='blue' icon={<IconAlertCircle size={16} />}>
                        The wall shows at most {MAX_TILES} computers. Narrow the selection to
                        monitor the rest.
                    </Alert>
                ) : null}

                <Group justify='space-between' align='flex-end' wrap='wrap'>
                    <MultiSelect
                        label='Monitored computers'
                        placeholder='Pick computers to monitor'
                        data={selectData}
                        renderOption={({ option, checked }) => {
                            const online = live[option.value]?.state === 'online';
                            return (
                                <Group gap='xs' wrap='nowrap' flex='1'>
                                    <Box
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
                                    <Text size='sm'>{option.label}</Text>
                                    <Text size='xs' c='dimmed'>
                                        {online ? 'online' : 'offline'}
                                    </Text>
                                    {checked ? (
                                        <IconCheck
                                            size={14}
                                            style={{ marginInlineStart: 'auto' }}
                                        />
                                    ) : null}
                                </Group>
                            );
                        }}
                        value={selectedIds}
                        onChange={handleSelectionChange}
                        searchable
                        clearable
                        maxDropdownHeight={280}
                        w={{ base: '100%', sm: 320 }}
                        size='sm'
                    />
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

                {selectedComputers.length ? (
                    <SimpleGrid
                        cols={gridCols}
                        spacing={{ base: 'xs', sm: 'sm' }}
                        data-cols={columns === 'auto' ? 'auto' : Number(columns)}
                    >
                        {selectedComputers.map((computer) => (
                            <WallTile
                                key={computer.id}
                                computer={computer}
                                live={live[computer.id]}
                                refreshMs={refreshMs}
                                refreshSignal={refreshSignal}
                                scheduler={scheduler}
                                onOpenViewer={handleOpenViewer}
                                onCommand={handleCommand}
                            />
                        ))}
                    </SimpleGrid>
                ) : (
                    <Stack align='center' py={80} gap='sm'>
                        <ThemeIcon variant='light' color='gray' size={56} radius='xl'>
                            <IconLayoutGrid size={28} />
                        </ThemeIcon>
                        <Text fw={600}>No computers on the wall</Text>
                        <Text size='sm' c='dimmed'>
                            Pick computers above to start live monitoring.
                        </Text>
                    </Stack>
                )}
            </Stack>
        </Modal>
    );
}

const MAX_BACKOFF_MS = 8_000;
const MIN_BACKOFF_MS = 500;
const INITIAL_JITTER_MS = 250;
const FRAME_TIMEOUT_MS = 15_000;
const DEFAULT_FRAME_WIDTH = 640;
const MIN_FRAME_WIDTH = 160;
const MAX_FRAME_WIDTH = 1920;
const FRAME_WIDTH_STEP = 160;

function quantizeFrameWidth(cssWidth: number) {
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const stepped = Math.ceil((cssWidth * scale) / FRAME_WIDTH_STEP) * FRAME_WIDTH_STEP;
    return Math.min(MAX_FRAME_WIDTH, Math.max(MIN_FRAME_WIDTH, stepped));
}

type FrameJob = () => Promise<void>;

interface FrameJobHandle {
    done: Promise<void>;
    cancel: () => void;
}

interface QueuedFrameJob {
    start: () => void;
    settle: () => void;
    cancelled: boolean;
}

class FrameScheduler {
    private active = 0;
    private readonly queue: QueuedFrameJob[] = [];

    constructor(private readonly limit: number) {}

    run(job: FrameJob): FrameJobHandle {
        let settle!: () => void;
        const done = new Promise<void>((resolve) => {
            settle = resolve;
        });
        const entry: QueuedFrameJob = {
            cancelled: false,
            settle,
            start: () => {
                this.active += 1;
                job().finally(() => {
                    this.active -= 1;
                    settle();
                    this.drain();
                });
            },
        };
        if (this.active < this.limit) {
            entry.start();
        } else {
            this.queue.push(entry);
        }
        return {
            done,
            cancel: () => {
                const index = this.queue.indexOf(entry);
                if (index === -1) return;
                entry.cancelled = true;
                this.queue.splice(index, 1);
                settle();
            },
        };
    }

    private drain() {
        while (this.active < this.limit) {
            const next = this.queue.shift();
            if (!next) return;
            if (!next.cancelled) next.start();
        }
    }
}

const TileImage = memo(function TileImage({
    computerId,
    computerName,
    refreshMs,
    refreshSignal,
    scheduler,
    offlineError,
    onImageError,
}: {
    computerId: string;
    computerName: string;
    refreshMs: number | null;
    refreshSignal: number;
    scheduler: FrameScheduler;
    offlineError: string | null;
    onImageError: (failed: boolean) => void;
}) {
    // Frames are fetched as blobs and double-buffered: the previous frame
    // stays visible until the next one is fully downloaded, so the tile
    // never blanks and load latency no longer inflates the refresh period.
    const [objectUrl, setObjectUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const [firstLoadDone, setFirstLoadDone] = useState(false);
    const [frameWidth, setFrameWidth] = useState(DEFAULT_FRAME_WIDTH);

    const boxRef = useRef<HTMLDivElement>(null);
    const mountedRef = useRef(true);
    const timerRef = useRef<number | null>(null);
    const inflightRef = useRef(false);
    const reloadRequestedRef = useRef(false);
    const abortRef = useRef<AbortController | null>(null);
    const jobRef = useRef<FrameJobHandle | null>(null);
    const urlRef = useRef<string | null>(null);
    const failuresRef = useRef(0);
    const refreshMsRef = useRef(refreshMs);
    const frameWidthRef = useRef(DEFAULT_FRAME_WIDTH);
    const firstSignalRef = useRef(true);
    const firstWidthRef = useRef(true);
    const loadFrameRef = useRef<() => void>(() => undefined);

    const clearTimer = useCallback(() => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const scheduleNext = useCallback(
        (startedAt: number) => {
            clearTimer();
            if (!mountedRef.current) return;
            const interval = refreshMsRef.current;
            if (interval === null) return;
            // Fixed-rate scheduling measured from submission so slow frames
            // do not push the period out: each tile is capped at one frame
            // per interval. Failures back off exponentially.
            const delay =
                failuresRef.current > 0
                    ? Math.min(
                          Math.max(interval, MIN_BACKOFF_MS) *
                              2 ** Math.min(failuresRef.current - 1, 2),
                          MAX_BACKOFF_MS,
                      )
                    : Math.max(interval - (performance.now() - startedAt), 0);
            timerRef.current = window.setTimeout(() => {
                timerRef.current = null;
                loadFrameRef.current();
            }, delay);
        },
        [clearTimer],
    );

    const loadFrame = useCallback(() => {
        if (!mountedRef.current || inflightRef.current) return;
        inflightRef.current = true;
        const startedAt = performance.now();
        const handle = scheduler.run(async () => {
            if (!mountedRef.current) return;
            const controller = new AbortController();
            abortRef.current = controller;
            // Manual timeout instead of AbortSignal.any/timeout: works in every
            // browser (and jsdom) and lets us tell stalls from deliberate aborts.
            let timedOut = false;
            const timeout = window.setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, FRAME_TIMEOUT_MS);
            try {
                const response = await fetch(
                    veyonFramebufferUrl(computerId, { width: frameWidthRef.current }),
                    { signal: controller.signal },
                );
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const blob = await response.blob();
                if (!mountedRef.current) return;
                const next = URL.createObjectURL(blob);
                const previous = urlRef.current;
                urlRef.current = next;
                setObjectUrl(next);
                if (previous) URL.revokeObjectURL(previous);
                failuresRef.current = 0;
                setFailed(false);
                setFirstLoadDone(true);
            } catch {
                if (!mountedRef.current) return;
                // Deliberate abort (pause/unmount): not a host failure.
                if (controller.signal.aborted && !timedOut) return;
                failuresRef.current += 1;
                setFirstLoadDone(true);
                // Keep the last good frame visible on transient errors; only
                // surface the overlay when there is nothing to show or the
                // host keeps failing.
                setFailed(urlRef.current === null || failuresRef.current >= 3);
            } finally {
                window.clearTimeout(timeout);
                abortRef.current = null;
            }
        });
        jobRef.current = handle;
        void handle.done.then(() => {
            jobRef.current = null;
            inflightRef.current = false;
            if (!mountedRef.current) return;
            if (reloadRequestedRef.current) {
                reloadRequestedRef.current = false;
                clearTimer();
                loadFrameRef.current();
                return;
            }
            scheduleNext(startedAt);
        });
    }, [computerId, scheduler, scheduleNext, clearTimer]);

    loadFrameRef.current = loadFrame;

    // Request frames at the tile's rendered resolution: small wall tiles skip
    // the encode/transfer/decode cost of oversized JPEGs, while a fullscreened
    // tile upgrades toward full resolution.
    useEffect(() => {
        const element = boxRef.current;
        const ObserverCtor = window.ResizeObserver;
        if (!element || !ObserverCtor) return;
        const observer = new ObserverCtor((entries) => {
            const width = entries[0]?.contentRect.width ?? 0;
            if (!width) return;
            const next = quantizeFrameWidth(width);
            if (next === frameWidthRef.current) return;
            frameWidthRef.current = next;
            setFrameWidth(next);
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (firstWidthRef.current) {
            firstWidthRef.current = false;
            return;
        }
        if (refreshMsRef.current === null) return;
        clearTimer();
        if (inflightRef.current) {
            reloadRequestedRef.current = true;
            return;
        }
        loadFrameRef.current();
    }, [frameWidth, clearTimer]);

    useEffect(() => {
        mountedRef.current = true;
        failuresRef.current = 0;
        // Stagger initial submissions so tiles do not all queue at once.
        timerRef.current = window.setTimeout(
            () => {
                timerRef.current = null;
                loadFrameRef.current();
            },
            Math.floor(Math.random() * INITIAL_JITTER_MS),
        );
        return () => {
            mountedRef.current = false;
            clearTimer();
            jobRef.current?.cancel();
            abortRef.current?.abort();
            if (urlRef.current) URL.revokeObjectURL(urlRef.current);
            urlRef.current = null;
        };
    }, [computerId, clearTimer]);

    useEffect(() => {
        const wasPaused = refreshMsRef.current === null;
        refreshMsRef.current = refreshMs;
        if (refreshMs === null) {
            clearTimer();
            jobRef.current?.cancel();
            abortRef.current?.abort();
            return;
        }
        // Resuming from paused: pull a frame immediately.
        if (wasPaused && !inflightRef.current) {
            clearTimer();
            loadFrameRef.current();
        }
    }, [refreshMs, clearTimer]);

    useEffect(() => {
        if (firstSignalRef.current) {
            firstSignalRef.current = false;
            return;
        }
        clearTimer();
        if (inflightRef.current) {
            reloadRequestedRef.current = true;
            return;
        }
        loadFrameRef.current();
    }, [refreshSignal, clearTimer]);

    useEffect(() => {
        onImageError(failed);
    }, [failed, onImageError]);

    return (
        <Box
            ref={boxRef}
            style={{
                position: 'relative',
                aspectRatio: '16 / 9',
                overflow: 'hidden',
                borderRadius: 'var(--mantine-radius-sm)',
                background: 'var(--mantine-color-dark-8)',
            }}
        >
            <img
                src={objectUrl ?? undefined}
                alt={`Screen of ${computerName}`}
                aria-busy={!firstLoadDone}
                decoding='async'
                style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                }}
            />
            {failed || offlineError !== null ? (
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
                        {offlineError !== null ? offlineError : 'Screen unavailable'}
                    </Text>
                </Box>
            ) : null}
        </Box>
    );
});

const WallTile = memo(function WallTile({
    computer,
    live,
    refreshMs,
    refreshSignal,
    scheduler,
    onOpenViewer,
    onCommand,
}: {
    computer: VeyonComputer;
    live?: LiveState;
    refreshMs: number | null;
    refreshSignal: number;
    scheduler: FrameScheduler;
    onOpenViewer: (computer: VeyonComputer) => void;
    onCommand: (computerId: string, action: VeyonCommandAction) => void | Promise<void>;
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

    const handleImageError = useCallback((failed: boolean) => setImageFailed(failed), []);

    const information = live?.state === 'online' ? live.information : null;
    const online = live?.state === 'online' && !imageFailed;
    const offlineError = live?.state === 'offline' ? live.error : null;

    const toggleFullscreen = async () => {
        try {
            if (document.fullscreenElement) {
                if (document.exitFullscreen) await document.exitFullscreen();
            } else if (tileRef.current?.requestFullscreen) {
                await tileRef.current.requestFullscreen();
            } else {
                notifications.show({
                    color: 'orange',
                    title: 'Fullscreen unavailable',
                    message: 'This browser does not support fullscreen for the monitoring wall.',
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
            withBorder
            radius='md'
            p='xs'
            ref={tileRef}
            tabIndex={0}
            aria-label={`Monitoring tile for ${computer.name}`}
            onKeyDown={(event) => {
                if (event.key === 'Enter') onOpenViewer(computer);
            }}
        >
            <Stack gap='xs'>
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
                            <Text size='sm' fw={600} truncate>
                                {computer.name}
                            </Text>
                            <Text size='xs' c='dimmed' truncate>
                                {computer.location || 'Unassigned'}
                            </Text>
                        </div>
                    </Group>
                    <Group gap={2} wrap='nowrap'>
                        <Tooltip label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
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
                                onClick={() => void onCommand(computer.id, 'screen-lock')}
                            >
                                <IconLock size={15} />
                            </ActionIcon>
                        </Tooltip>
                    </Group>
                </Group>
                <TileImage
                    computerId={computer.id}
                    computerName={computer.name}
                    refreshMs={refreshMs}
                    refreshSignal={refreshSignal}
                    scheduler={scheduler}
                    offlineError={offlineError}
                    onImageError={handleImageError}
                />
                {information?.user.login ? (
                    <Group gap={4} wrap='nowrap'>
                        <IconUser size={13} style={{ flexShrink: 0 }} />
                        <Text size='xs' c='dimmed' truncate>
                            {information.user.fullName || information.user.login}
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
