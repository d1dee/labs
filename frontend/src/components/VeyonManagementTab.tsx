import type { DeviceIdentity, DeviceLab } from '@/api/devices';
import { wakeDevice } from '@/api/device-actions';
import { useSessionContext } from '@/context/SessionContext';
import {
    getFogStatus,
    listFogImages,
    listFogSnapins,
    listFogTaskTypes,
    type FogHost,
    type FogImage,
    type FogSnapin,
    type FogTaskType,
    type ListFogHosts,
} from '@/api/fog';
import { useApiStream } from '@/api/useApiStream';
import {
    deviceIdentitySearchText,
    useDeviceIdentities,
} from '@/api/useDeviceIdentities';
import {
    createVeyonComputer,
    deleteVeyonComputer,
    sendVeyonCommand,
    updateVeyonComputer,
    veyonFramebufferUrl,
    type VeyonCommandAction,
    type VeyonCommandResult,
    type VeyonComputer,
    type VeyonFeature,
    type VeyonInformation,
    type VeyonInformationEvent,
} from '@/api/veyon';
import { InventoryHostDetails } from '@/components/FOG/InventoryDetails';
import { SelectedHostCard } from '@/components/FOG/SelectedHostCard';
import { DeviceIdentityDetails } from '@/components/ui/DeviceIdentityDetails';
import {
    MobileFilterPanel,
    MobileFilterToggle,
    useMobileTableFilters,
} from '@/components/ui/MobileTableFilters';
import { PageHero } from '@/components/ui/PageHero';
import {
    TablePagination,
    useTablePagination,
} from '@/components/ui/TablePagination';
import {
    compareTableValues,
    onSelectionRowClick,
    SortableTh,
    toggleTableSort,
    type SortState,
} from '@/components/ui/tableUtils';
import VeyonMonitoringWall from '@/components/veyon/VeyonMonitoringWall';
import { useVeyonScreenshots } from '@/components/veyon/useVeyonScreenshots';
import {
    ActionIcon,
    Alert,
    Autocomplete,
    Badge,
    Box,
    Button,
    Card,
    Checkbox,
    Flex,
    Group,
    Image,
    Loader,
    Menu,
    Modal,
    MultiSelect,
    Paper,
    PasswordInput,
    ScrollArea,
    Scroller,
    Select,
    Stack,
    Table,
    Tabs,
    Text,
    Textarea,
    TextInput,
    ThemeIcon,
    Title,
    Tooltip,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import {
    IconAlertCircle,
    IconBolt,
    IconBrandWindows,
    IconBrowser,
    IconCheck,
    IconChevronDown,
    IconCloud,
    IconCommand,
    IconDeviceDesktop,
    IconDotsVertical,
    IconEdit,
    IconEye,
    IconInfoCircle,
    IconKey,
    IconLayoutGrid,
    IconLock,
    IconLockOpen,
    IconMessage,
    IconPlus,
    IconPower,
    IconReload,
    IconScreenShare,
    IconTrash,
    IconUser,
    IconUserOff,
    IconX,
} from '@tabler/icons-react';
import {
    startTransition,
    useCallback,
    useDeferredValue,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';

export type LiveState =
    | { state: 'loading' }
    | { state: 'online'; information: VeyonInformation }
    | { state: 'offline'; error: string };

type EditorState = { opened: boolean; computer: VeyonComputer | null };
type ComputerSortKey = 'name' | 'location' | 'user' | 'status';

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function notificationError(error: unknown, details: unknown = error) {
    console.error('Veyon request failed:', details);
    const message = errorMessage(error).replace(/\s+/g, ' ').trim();
    return message.length > 120 ? `${message.slice(0, 117)}...` : message;
}

function reportCommandResults(
    results: VeyonCommandResult[],
    titles: [string, string, string],
    message: string,
    failed = false,
) {
    const failures = results.filter((item) => !item.success);
    const allFailed =
        failed || (failures.length > 0 && failures.length === results.length);
    notifications.show({
        color: allFailed ? 'red' : failures.length ? 'orange' : 'teal',
        title: titles[allFailed ? 2 : failures.length ? 1 : 0],
        message: failures.length
            ? `${message} ${notificationError(`${failures[0].name}: ${failures[0].error || 'Request failed'}`, failures)}${failures.length > 1 ? ` (+${failures.length - 1} more failures)` : ''}`
            : message,
        icon: failures.length ? (
            <IconAlertCircle size={16} />
        ) : (
            <IconCheck size={16} />
        ),
    });
}

function featureUid(feature: VeyonFeature) {
    return feature.uid || feature.id || '';
}

function featureName(feature: VeyonFeature) {
    return (
        feature.displayName ||
        feature.name ||
        featureUid(feature) ||
        'Unknown feature'
    );
}

function identityQuery(computer: VeyonComputer) {
    return {
        veyonComputerId: computer.id.startsWith('fog:')
            ? undefined
            : computer.id,
        fogHostId: computer.fogHostId ?? undefined,
        macAddress: computer.macAddress,
        address: computer.host,
    };
}

function wakeUnavailableReason(identity: DeviceIdentity | null) {
    return !identity ? 'Device identity is unavailable'
        : !identity.lab ? 'A detected lab is required for Wake on LAN'
        : identity.macAddresses.length !== 1 ? 'One unambiguous MAC address is required'
        : null;
}

function fogHostIdFor(
    computer: VeyonComputer,
    identity: DeviceIdentity | null,
) {
    return (
        computer.fogHostId ??
        (identity?.fogHostIds.length === 1 ? identity.fogHostIds[0] : null)
    );
}

export default function ComputersManagementTab() {
    const { user, organizationId } = useSessionContext();
    const wakeScope = `${user?.id ?? ''}:${organizationId ?? ''}`;
    const wakeScopeRef = useRef<string | null>(wakeScope);
    wakeScopeRef.current = wakeScope;
    useEffect(() => {
        wakeScopeRef.current = wakeScope;
        return () => { wakeScopeRef.current = null; };
    }, [wakeScope]);
    const identities = useDeviceIdentities();
    const [configured, setConfigured] = useState<boolean | null>(null);
    const [directory, setComputers] = useState<VeyonComputer[]>([]);
    const [live, setLive] = useState<Record<string, LiveState>>({});
    const [selected, setSelected] = useState<string[]>([]);
    const [bulkWaking, setBulkWaking] = useState(false);
    const [search, setSearch] = useState('');
    const mobileFilters = useMobileTableFilters();
    const [statusFilter, setStatusFilter] = useState<string | null>(null);
    const [locationFilter, setLocationFilter] = useState<string | null>(null);
    const [labFilter, setLabFilter] = useState<string[]>([]);
    const [sessionFilter, setSessionFilter] = useState<string | null>(null);
    const [sort, setSort] = useState<SortState<ComputerSortKey> | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [refreshToken, setRefreshToken] = useState(0);
    const directoryRef = useRef<VeyonComputer[]>([]);
    const commandRefreshTimer = useRef<number | undefined>(undefined);
    const [editor, setEditor] = useState<EditorState>({
        opened: false,
        computer: null,
    });
    const [viewer, setViewer] = useState<VeyonComputer | null>(null);
    const [inventoryComputerId, setInventoryComputerId] = useState<
        string | null
    >(null);
    const [fogHosts, setFogHosts] = useState<FogHost[] | null>(null);
    const [inventoryWarning, setInventoryWarning] = useState<string | null>(
        null,
    );
    const [fogConfigured, setFogConfigured] = useState<boolean | null>(null);
    const [fogError, setFogError] = useState<string | null>(null);
    const [images, setImages] = useState<FogImage[]>([]);
    const [snapins, setSnapins] = useState<FogSnapin[]>([]);
    const [taskTypes, setTaskTypes] = useState<FogTaskType[]>([]);
    const [deploymentErrors, setDeploymentErrors] = useState<
        Record<string, string>
    >({});
    const [wallOpened, setWallOpened] = useState(false);
    // FOG-only rows remain visible even if the live service is unconfigured or down.
    // Their UI-only IDs are never sent to Veyon; only directory IDs are eligible.
    const computers = useMemo(() => {
        const linked = new Set(
            directory.map((computer) =>
                fogHostIdFor(
                    computer,
                    identities.lookup(identityQuery(computer)),
                ),
            ),
        );
        return [
            ...directory,
            ...(fogHosts ?? [])
                .filter((host) => !linked.has(host.id))
                .map(
                    (host): VeyonComputer => ({
                        id: `fog:${host.id}`,
                        name: host.name,
                        host: host.ip || host.name,
                        macAddress: host.primac ?? null,
                        location: null,
                        fogHostId: host.id,
                        createdAt: '',
                        updatedAt: '',
                    }),
                ),
        ];
    }, [directory, fogHosts, identities.lookup]);
    useEffect(() => {
        setSelected((current) => {
            const next = [
                ...new Set(
                    current
                        .map((id) =>
                            id.startsWith('fog:')
                                ? (computers.find(
                                      (computer) =>
                                          `fog:${computer.fogHostId}` === id,
                                  )?.id ?? id)
                                : id,
                        )
                        .filter((id) =>
                            computers.some((computer) => computer.id === id),
                        ),
                ),
            ];
            return next.length === current.length &&
                next.every((id, index) => id === current[index])
                ? current
                : next;
        });
    }, [computers]);
    const veyonIds = new Set(
        configured ? directory.map((computer) => computer.id) : [],
    );
    const veyonSelection = selected.filter((id) => veyonIds.has(id));
    const deferredSearch = useDeferredValue(search.trim().toLowerCase());
    const locationFor = useCallback(
        (computer: VeyonComputer) =>
            identities.labFor(identityQuery(computer))?.name ??
            computer.location,
        [identities.labFor],
    );
    const inventoryComputer = computers.find(
        (computer) => computer.id === inventoryComputerId,
    );
    const inventoryIdentity = inventoryComputer
        ? identities.lookup(identityQuery(inventoryComputer))
        : null;
    const inventoryFogHostId = inventoryComputer
        ? fogHostIdFor(inventoryComputer, inventoryIdentity)
        : null;
    useApiStream<Awaited<ReturnType<typeof getFogStatus>>>(
        '/api/fog/status',
        (status) => {
            setFogConfigured(status.configured);
            setFogError(null);
            if (!status.configured) {
                setFogHosts(null);
                setInventoryWarning(null);
            }
        },
        (error) => setFogError(error.message),
    );
    const refreshFog = useApiStream<ListFogHosts>(
        fogConfigured ? '/api/fog/hosts' : null,
        (data) => {
            setFogHosts(data.hosts);
            setInventoryWarning(data.inventoryWarning ?? null);
            setFogError(null);
        },
        (error) => {
            setFogError(error.message);
        },
    );
    const deploymentStream = (key: string, success: () => void) => {
        success();
        setDeploymentErrors((current) => {
            const next = { ...current };
            delete next[key];
            return next;
        });
    };
    useApiStream<Awaited<ReturnType<typeof listFogImages>>>(
        fogConfigured ? '/api/fog/images' : null,
        (data) => deploymentStream('images', () => setImages(data.images)),
        (error) =>
            setDeploymentErrors((current) => ({
                ...current,
                images: error.message,
            })),
    );
    useApiStream<Awaited<ReturnType<typeof listFogSnapins>>>(
        fogConfigured ? '/api/fog/snapins' : null,
        (data) => deploymentStream('snapins', () => setSnapins(data.snapins)),
        (error) =>
            setDeploymentErrors((current) => ({
                ...current,
                snapins: error.message,
            })),
    );
    useApiStream<Awaited<ReturnType<typeof listFogTaskTypes>>>(
        fogConfigured ? '/api/fog/tasktypes' : null,
        (data) =>
            deploymentStream('task types', () => setTaskTypes(data.tasktypes)),
        (error) =>
            setDeploymentErrors((current) => ({
                ...current,
                'task types': error.message,
            })),
    );
    const fogHostsById = useMemo(
        () => new Map(fogHosts?.map((host) => [String(host.id), host])),
        [fogHosts],
    );
    const selectedFogHosts = (fogHosts ?? []).filter((host) =>
        computers.some(
            (computer) =>
                selected.includes(computer.id) &&
                fogHostIdFor(
                    computer,
                    identities.lookup(identityQuery(computer)),
                ) === host.id,
        ),
    );
    const deployTaskTypeId =
        taskTypes.find((type) => type.name?.toLowerCase().includes('deploy'))
            ?.id ?? null;
    const captureTaskTypeId =
        taskTypes.find((type) => type.name?.toLowerCase().includes('capture'))
            ?.id ?? null;
    useApiStream<{ computers: VeyonComputer[]; inventoryWarning?: string }>(
        configured !== true ? '/api/veyon/computers' : null,
        (data) => {
            setComputers(data.computers);
            setInventoryWarning(data.inventoryWarning ?? null);
            setLoading(false);
        },
        (error) => {
            setLoadError(error.message);
            setLoading(false);
        },
    );
    const handleHostsDeleted = (ids: number[]) => {
        const deleted = new Set(ids);
        const removed = new Set(
            computers
                .filter(
                    (computer) =>
                        computer.fogHostId != null &&
                        deleted.has(computer.fogHostId),
                )
                .map((computer) => computer.id),
        );
        setFogHosts(
            (current) =>
                current?.filter((host) => !deleted.has(host.id)) ?? null,
        );
        setComputers((current) =>
            current.filter((computer) => !removed.has(computer.id)),
        );
        setSelected((current) => current.filter((id) => !removed.has(id)));
        refreshFog();
    };
    const handleHostUpdated = (host: FogHost) => {
        setFogHosts(
            (current) =>
                current?.map((item) => (item.id === host.id ? host : item)) ??
                null,
        );
        refreshFog();
    };

    const filteredComputers = useMemo(() => {
        const rows = computers.filter((computer) => {
            const state = live[computer.id];
            const lab = identities.labFor(identityQuery(computer));
            const user =
                state?.state === 'online' ? state.information.user : null;
            const session = user
                ? user.login
                    ? 'logged-in'
                    : 'no-user'
                : 'unavailable';
            return (
                (!statusFilter ||
                    (state?.state ?? 'offline') === statusFilter) &&
                (!locationFilter ||
                    JSON.stringify(locationFor(computer) || '') ===
                        locationFilter) &&
                (!labFilter.length ||
                    labFilter.includes(lab ? `lab:${lab.id}` : 'unassigned')) &&
                (!sessionFilter || session === sessionFilter) &&
                [
                    computer.name,
                    computer.host,
                    locationFor(computer) ?? '',
                    user?.login ?? '',
                    user?.fullName ?? '',
                    deviceIdentitySearchText(
                        identities.lookup(identityQuery(computer)),
                    ),
                ]
                    .join(' ')
                    .toLowerCase()
                    .includes(deferredSearch)
            );
        });
        if (!sort) return rows;
        const value = (computer: VeyonComputer) => {
            const state = live[computer.id];
            if (sort.key === 'location') return locationFor(computer) || null;
            if (sort.key === 'status') return state?.state ?? 'offline';
            if (sort.key === 'user') {
                return state?.state === 'online' && state.information.user.login
                    ? state.information.user.fullName ||
                          state.information.user.login
                    : null;
            }
            return (
                identities.lookup(identityQuery(computer))?.hostname ||
                computer.name ||
                computer.host
            );
        };
        return rows.sort((a, b) =>
            compareTableValues(value(a), value(b), sort.direction),
        );
    }, [
        computers,
        deferredSearch,
        live,
        statusFilter,
        locationFilter,
        labFilter,
        sessionFilter,
        sort,
        identities.lookup,
        identities.labFor,
        locationFor,
    ]);
    const pagination = useTablePagination(
        filteredComputers,
        JSON.stringify([
            deferredSearch,
            statusFilter,
            locationFilter,
            labFilter,
            sessionFilter,
            sort?.key,
            sort?.direction,
        ]),
    );
    const onlineCount = Object.values(live).filter(
        (value) => value.state === 'online',
    ).length;
    const loggedInCount = Object.values(live).filter(
        (value) =>
            value.state === 'online' && Boolean(value.information.user.login),
    ).length;

    const refreshStatus = useApiStream<{ configured: boolean }>(
        '/api/veyon/status',
        (status) => {
            setConfigured(status.configured);
            if (!status.configured) {
                setLoading(false);
                setLive({});
                setViewer(null);
                setWallOpened(false);
                setLoadError(null);
            }
        },
        (error) => {
            setLoadError(error.message);
            setLoading(false);
        },
    );
    const load = () => {
        refreshStatus();
        setRefreshToken((current) => current + 1);
    };

    useEffect(() => {
        if (!configured) return;
        let cancelled = false;
        let source: EventSource | undefined;
        let retryTimer: number | undefined;
        const connect = async () => {
            try {
                source = new EventSource('/api/veyon/information/stream');
                source.addEventListener('directory', (event) => {
                    if (cancelled) return;
                    const {
                        computers: nextComputers,
                        inventoryWarning: directoryWarning,
                    } = JSON.parse((event as MessageEvent<string>).data) as {
                        computers: VeyonComputer[];
                        inventoryWarning?: string;
                    };
                    setInventoryWarning(directoryWarning ?? null);
                    const previousHosts = new Map(
                        directoryRef.current.map((computer) => [
                            computer.id,
                            computer.host,
                        ]),
                    );
                    directoryRef.current = nextComputers;
                    setComputers(nextComputers);
                    setSelected((current) => [
                        ...new Set(
                            current
                                .map((id) =>
                                    id.startsWith('fog:')
                                        ? (nextComputers.find(
                                              (computer) =>
                                                  `fog:${computer.fogHostId}` ===
                                                  id,
                                          )?.id ?? id)
                                        : id,
                                )
                                .filter(
                                    (id) =>
                                        id.startsWith('fog:') ||
                                        nextComputers.some(
                                            (computer) => computer.id === id,
                                        ),
                                ),
                        ),
                    ]);
                    setLive((current) =>
                        Object.fromEntries(
                            nextComputers.map((computer) => [
                                computer.id,
                                previousHosts.get(computer.id) ===
                                    computer.host && current[computer.id]
                                    ? current[computer.id]
                                    : { state: 'loading' },
                            ]),
                        ),
                    );
                    setLoading(false);
                    setLoadError(null);
                });
                source.addEventListener('information', (event) => {
                    if (cancelled) return;
                    const { computerId, ...state } = JSON.parse(
                        (event as MessageEvent<string>).data,
                    ) as VeyonInformationEvent;
                    startTransition(() =>
                        setLive((current) =>
                            computerId in current
                                ? { ...current, [computerId]: state }
                                : current,
                        ),
                    );
                });
                source.addEventListener('unavailable', (event) => {
                    if (cancelled) return;
                    const { error } = JSON.parse(
                        (event as MessageEvent<string>).data,
                    ) as { error: string };
                    setLoadError(error);
                    setLoading(false);
                });
                source.onerror = () => {
                    if (cancelled) return;
                    setLoadError(
                        'Live status connection interrupted. Reconnecting automatically; displayed statuses may be out of date.',
                    );
                    setLoading(false);
                    if (source?.readyState === EventSource.CLOSED) {
                        window.clearTimeout(retryTimer);
                        retryTimer = window.setTimeout(load, 10_000);
                    }
                };
            } catch (error) {
                if (cancelled) return;
                setLoadError(errorMessage(error));
                setLoading(false);
                retryTimer = window.setTimeout(() => void connect(), 10_000);
            }
        };
        void connect();
        return () => {
            cancelled = true;
            source?.close();
            window.clearTimeout(retryTimer);
        };
    }, [configured, refreshToken]);

    useEffect(() => () => window.clearTimeout(commandRefreshTimer.current), []);

    const runCommand = async (
        action: VeyonCommandAction,
        argumentsValue: Record<string, unknown> = {},
        active = true,
        featureUidValue?: string,
        targetIds?: string[],
    ) => {
        const requested = targetIds ?? selected;
        const targets = requested.filter((id) => veyonIds.has(id));
        if (!targets.length) return;
        if (targets.length !== requested.length) {
            modals.openConfirmModal({
                title: 'Apply Veyon command to eligible targets only?',
                children: (
                    <Text size='sm'>
                        {targets.length} of {requested.length} selected
                        computers are Veyon targets. The remaining{' '}
                        {requested.length - targets.length} will not receive
                        this command.
                    </Text>
                ),
                labels: {
                    confirm: `Apply to ${targets.length} Veyon targets`,
                    cancel: 'Cancel',
                },
                onConfirm: () =>
                    void runCommand(
                        action,
                        argumentsValue,
                        active,
                        featureUidValue,
                        targets,
                    ),
            });
            return;
        }
        try {
            const result = await sendVeyonCommand({
                computerIds: targets,
                action,
                active,
                arguments: argumentsValue,
                featureUid: featureUidValue,
            });
            reportCommandResults(
                result.results,
                [
                    'Command accepted',
                    'Command partially accepted',
                    'Command failed',
                ],
                `${result.results.filter((item) => item.success).length}/${result.results.length} accepted. Completion not verified.`,
            );
            load();
            if (
                ['user-login', 'user-logoff', 'reboot', 'power-down'].includes(
                    action,
                )
            ) {
                window.clearTimeout(commandRefreshTimer.current);
                commandRefreshTimer.current = window.setTimeout(load, 1200);
            }
        } catch (error) {
            notifications.show({
                color: 'red',
                title: 'Command failed',
                message: notificationError(error),
            });
        }
    };

    const confirmCommand = (
        title: string,
        description: string,
        action: VeyonCommandAction,
        color = 'red',
        targetIds?: string[],
    ) => {
        modals.openConfirmModal({
            title,
            children: <Text size='sm'>{description}</Text>,
            labels: { confirm: title, cancel: 'Cancel' },
            confirmProps: { color },
            onConfirm: () =>
                void runCommand(action, {}, true, undefined, targetIds),
        });
    };

    const runCommandRef = useRef(runCommand);
    useEffect(() => {
        runCommandRef.current = runCommand;
    });

    const handleWallOpenViewer = useCallback((computer: VeyonComputer) => {
        setWallOpened(false);
        setViewer(computer);
    }, []);

    const handleWallCommand = useCallback(
        (computerId: string, action: VeyonCommandAction, active = true) =>
            runCommandRef.current(action, {}, active, undefined, [computerId]),
        [],
    );

    const wakeSelection = computers.filter((computer) => selected.includes(computer.id))
        .map((computer) => ({ computer, identity: identities.lookup(identityQuery(computer)) }))
        .filter((target): target is { computer: VeyonComputer; identity: DeviceIdentity } =>
            target.identity !== null && wakeUnavailableReason(target.identity) === null);

    const wakeSelected = () => {
        if (bulkWaking || !wakeSelection.length) return;
        const targets = [...new Map(wakeSelection.map(({ computer, identity }) =>
            [identity.id, { id: identity.id, name: computer.name }])).values()];
        const skipped = selected.length - wakeSelection.length;
        const send = async () => {
            setBulkWaking(true);
            const results: VeyonCommandResult[] = [];
            try {
                // Keep router commands sequential rather than flooding its REST queue.
                for (const target of targets) {
                    try {
                        if (wakeScopeRef.current !== wakeScope) throw new Error('Session changed; wake cancelled');
                        await wakeDevice(target.id);
                        results.push({ ...target, success: true });
                    } catch (error) {
                        results.push({ ...target, success: false, error: errorMessage(error) });
                    }
                }
                reportCommandResults(results,
                    ['Wake packets sent', 'Wake partially completed', 'Wake failed'],
                    `${results.filter((result) => result.success).length}/${results.length} wake packets sent. ${skipped ? `${skipped} skipped. ` : ''}Startup not verified.`);
            } finally {
                setBulkWaking(false);
            }
        };
        if (skipped) {
            modals.openConfirmModal({
                title: 'Wake eligible computers only?',
                children: <Text size='sm'>{wakeSelection.length} of {selected.length} selected computers have a known MAC and detected lab. The remaining {skipped} will be skipped. The server also verifies the lab interface before sending.</Text>,
                labels: { confirm: `Wake ${targets.length} computers`, cancel: 'Cancel' },
                onConfirm: () => void send(),
            });
        } else {
            void send();
        }
    };

    const removeComputer = (computer: VeyonComputer) => {
        modals.openConfirmModal({
            title: 'Remove computer',
            children: (
                <Text size='sm'>
                    Remove {computer.name} from this management directory?
                </Text>
            ),
            labels: { confirm: 'Remove', cancel: 'Cancel' },
            confirmProps: { color: 'red' },
            onConfirm: async () => {
                try {
                    await deleteVeyonComputer(computer.id);
                    setComputers((current) =>
                        current.filter((item) => item.id !== computer.id),
                    );
                    setSelected((current) =>
                        current.filter((id) => id !== computer.id),
                    );
                    load();
                } catch (error) {
                    notifications.show({
                        color: 'red',
                        title: 'Remove failed',
                        message: notificationError(error),
                    });
                }
            },
        });
    };

    return (
        <Stack gap='lg'>
            {configured === false && (
                <Alert color='yellow' title='Veyon is not configured'>
                    Configure Veyon in Settings to enable live sessions and
                    remote commands. FOG deployment remains independent.
                </Alert>
            )}
            {fogError && (
                <Alert color='yellow' title='FOG unavailable'>
                    {fogError} Last-known inventory is retained.
                </Alert>
            )}
            {fogConfigured === false && !fogError && (
                <Alert color='yellow' title='FOG is not configured'>
                    Configure FOG in Settings to enable inventory and
                    deployment. Manual Veyon targets remain available.
                </Alert>
            )}
            {identities.warning ? (
                <Text size='xs' c='dimmed' role='status'>
                    {identities.warning}
                </Text>
            ) : null}
            {loadError ? (
                <Alert
                    color='yellow'
                    title='Live status unavailable'
                    icon={<IconAlertCircle size={18} />}
                >
                    {loadError}
                </Alert>
            ) : null}
            <PageHero
                eyebrow='Computers'
                title='Computer management'
                description='One inventory for live classroom operations and FOG deployment. FOG owns registered computer identities; manual targets are exceptions.'
                icon={<IconScreenShare size={25} />}
                actions={
                    <>
                        <Button
                            variant='light'
                            color='teal'
                            leftSection={<IconLayoutGrid size={16} />}
                            disabled={!configured || directory.length === 0}
                            onClick={() => setWallOpened(true)}
                        >
                            Live monitor
                        </Button>
                        <Button
                            variant='white'
                            color='dark'
                            leftSection={<IconPlus size={16} />}
                            disabled={!configured}
                            onClick={() =>
                                setEditor({ opened: true, computer: null })
                            }
                        >
                            Add manual target
                        </Button>
                    </>
                }
                metrics={[
                    { label: 'Directory', value: computers.length },
                    {
                        label: 'Veyon connected',
                        value: onlineCount,
                        accent: true,
                    },
                    { label: 'Users active', value: loggedInCount },
                    { label: 'Selected', value: selected.length },
                ]}
            />

            <Group justify='space-between'>
                <Text size='sm' role='status'>
                    {selected.length} selected: {veyonSelection.length} Veyon
                    eligible; {selectedFogHosts.length} FOG eligible. Service
                    actions apply only to their eligible targets.
                </Text>
                <Button
                    variant='subtle'
                    size='xs'
                    disabled={!selected.length}
                    onClick={() => setSelected([])}
                >
                    Clear selection
                </Button>
            </Group>
            <Card withBorder radius='lg' p='sm'>
                <Tabs defaultValue='veyon' keepMounted={false}>
                    <Tabs.List aria-label='Computer actions'>
                        <Tabs.Tab value='veyon'>
                            Management ({veyonSelection.length})
                        </Tabs.Tab>
                        <Tabs.Tab value='fog'>
                            Deployment ({selectedFogHosts.length})
                        </Tabs.Tab>
                    </Tabs.List>
                    <Tabs.Panel value='veyon' pt='sm'>
                        <CommandDeck
                            embedded
                            selectedCount={veyonSelection.length}
                            features={Object.values(live).flatMap((value) =>
                                value.state === 'online'
                                    ? value.information.features
                                    : [],
                            )}
                            onCommand={runCommand}
                            onConfirm={confirmCommand}
                            wake={{ count: wakeSelection.length, busy: bulkWaking, onWake: wakeSelected }}
                        />
                    </Tabs.Panel>
                    <Tabs.Panel value='fog' pt='sm'>
                        {Object.entries(deploymentErrors).map(
                            ([key, message]) => (
                                <Alert
                                    key={key}
                                    color='yellow'
                                    title={`FOG ${key} unavailable`}
                                >
                                    {message}
                                </Alert>
                            ),
                        )}
                        {fogConfigured && (
                            <SelectedHostCard
                                embedded
                                key={selected.slice().sort().join(',')}
                                hosts={selectedFogHosts}
                                selectedCount={selected.length}
                                images={images}
                                snapins={snapins}
                                taskTypes={taskTypes}
                                deployTaskTypeId={deployTaskTypeId}
                                captureTaskTypeId={captureTaskTypeId}
                                onHostsDeleted={handleHostsDeleted}
                                onHostUpdated={handleHostUpdated}
                                onClose={() => setSelected([])}
                            />
                        )}
                        {!fogConfigured && (
                            <Text size='sm' c='dimmed'>
                                Configure FOG in Settings to enable deployment
                                actions.
                            </Text>
                        )}
                    </Tabs.Panel>
                </Tabs>
            </Card>

            <Card withBorder radius='lg' p='md'>
                <Stack gap='md'>
                    <Flex
                        direction={{ base: 'column', sm: 'row' }}
                        align={{ base: 'stretch', sm: 'flex-end' }}
                        gap='md'
                    >
                        <Stack
                            gap={0}
                            flex={1}
                            miw={0}
                            style={{ overflowWrap: 'anywhere' }}
                        >
                            <Title order={4}>Computers</Title>
                            <Text size='sm' c='dimmed'>
                                Statuses refresh automatically. Select targets,
                                then apply controls from the command deck.
                            </Text>
                        </Stack>
                        <Group
                            wrap='nowrap'
                            gap='sm'
                            w={{ base: '100%', sm: 300 }}
                            style={{ flexShrink: 0 }}
                        >
                            <TextInput
                                aria-label='Search computers'
                                placeholder='Search name, host, location, user...'
                                value={search}
                                onChange={(event) =>
                                    setSearch(event.currentTarget.value)
                                }
                                style={{ flex: 1, minWidth: 0 }}
                            />
                            <MobileFilterToggle
                                opened={mobileFilters.opened}
                                onToggle={mobileFilters.toggle}
                                controlsId={mobileFilters.controlsId}
                                label='Toggle computer filters'
                            />
                        </Group>
                    </Flex>
                    <MobileFilterPanel
                        opened={mobileFilters.opened}
                        id={mobileFilters.controlsId}
                    >
                        <Group
                            grow
                            preventGrowOverflow={false}
                            align='flex-end'
                        >
                            <Select
                                miw={{ base: '100%', sm: 180 }}
                                label='Status'
                                placeholder='All statuses'
                                clearable
                                value={statusFilter}
                                onChange={setStatusFilter}
                                data={[
                                    { value: 'online', label: 'Online' },
                                    { value: 'offline', label: 'Offline' },
                                    { value: 'loading', label: 'Loading' },
                                ]}
                            />
                            <Select
                                miw={{ base: '100%', sm: 180 }}
                                label='Location'
                                placeholder='All locations'
                                clearable
                                searchable
                                value={locationFilter}
                                onChange={setLocationFilter}
                                data={[
                                    ...new Set(
                                        computers.map(
                                            (computer) =>
                                                locationFor(computer) || '',
                                        ),
                                    ),
                                ]
                                    .sort()
                                    .map((location) => ({
                                        value: JSON.stringify(location),
                                        label: location || 'Unassigned',
                                    }))}
                            />
                            <MultiSelect
                                miw={{ base: '100%', sm: 180 }}
                                label='Lab'
                                placeholder='All labs'
                                clearable
                                searchable
                                value={labFilter}
                                onChange={setLabFilter}
                                clearButtonProps={{
                                    'aria-label': 'Clear lab filter',
                                    'aria-hidden': false,
                                    tabIndex: 0,
                                }}
                                data={[
                                    {
                                        value: 'unassigned',
                                        label: 'Unassigned',
                                    },
                                    ...identities.labs.map((lab) => ({
                                        value: `lab:${lab.id}`,
                                        label: lab.name,
                                    })),
                                ]}
                            />
                            <Select
                                miw={{ base: '100%', sm: 180 }}
                                label='User session'
                                placeholder='All sessions'
                                clearable
                                value={sessionFilter}
                                onChange={setSessionFilter}
                                data={[
                                    { value: 'logged-in', label: 'Logged in' },
                                    {
                                        value: 'no-user',
                                        label: 'No user (online)',
                                    },
                                    {
                                        value: 'unavailable',
                                        label: 'Session unavailable',
                                    },
                                ]}
                            />
                        </Group>
                    </MobileFilterPanel>
                    {computers.length ? (
                        <Table.ScrollContainer minWidth={760}>
                            <Table verticalSpacing='sm' highlightOnHover>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th w={46}>
                                            <Checkbox
                                                aria-label='Select all computers on this page'
                                                checked={
                                                    pagination.pageItems
                                                        .length > 0 &&
                                                    pagination.pageItems.every(
                                                        (computer) =>
                                                            selected.includes(
                                                                computer.id,
                                                            ),
                                                    )
                                                }
                                                indeterminate={
                                                    pagination.pageItems.some(
                                                        (computer) =>
                                                            selected.includes(
                                                                computer.id,
                                                            ),
                                                    ) &&
                                                    !pagination.pageItems.every(
                                                        (computer) =>
                                                            selected.includes(
                                                                computer.id,
                                                            ),
                                                    )
                                                }
                                                onChange={(event) => {
                                                    // Read currentTarget before
                                                    // the state updater runs —
                                                    // React nulls it once the
                                                    // handler returns.
                                                    const checked =
                                                        event.currentTarget
                                                            .checked;
                                                    const visibleIds =
                                                        pagination.pageItems.map(
                                                            (computer) =>
                                                                computer.id,
                                                        );
                                                    setSelected((current) =>
                                                        checked
                                                            ? [
                                                                  ...new Set([
                                                                      ...current,
                                                                      ...visibleIds,
                                                                  ]),
                                                              ]
                                                            : current.filter(
                                                                  (id) =>
                                                                      !visibleIds.includes(
                                                                          id,
                                                                      ),
                                                              ),
                                                    );
                                                }}
                                            />
                                        </Table.Th>
                                        {(
                                            [
                                                ['name', 'Computer'],
                                                ['location', 'Location'],
                                                ['user', 'User session'],
                                                ['status', 'Veyon'],
                                            ] as const
                                        ).map(([key, label]) => (
                                            <SortableTh
                                                key={key}
                                                label={label}
                                                active={sort?.key === key}
                                                direction={
                                                    sort?.direction ?? 'asc'
                                                }
                                                onSort={() =>
                                                    setSort((current) =>
                                                        toggleTableSort(
                                                            current,
                                                            key,
                                                        ),
                                                    )
                                                }
                                            />
                                        ))}
                                        <Table.Th>Reachability (FOG)</Table.Th>
                                        <Table.Th>FOG image</Table.Th>
                                        <Table.Th ta='right'>Actions</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {filteredComputers.length === 0 ? (
                                        <Table.Tr>
                                            <Table.Td colSpan={8}>
                                                <Text ta='center' c='dimmed'>
                                                    No computers match the
                                                    current filters.
                                                </Text>
                                            </Table.Td>
                                        </Table.Tr>
                                    ) : null}
                                    {pagination.pageItems.map((computer) => (
                                        <ComputerRow
                                            key={computer.id}
                                            computer={computer}
                                            identity={identities.lookup(
                                                identityQuery(computer),
                                            )}
                                            fogHost={fogHostsById.get(
                                                String(
                                                    fogHostIdFor(
                                                        computer,
                                                        identities.lookup(
                                                            identityQuery(
                                                                computer,
                                                            ),
                                                        ),
                                                    ),
                                                ),
                                            )}
                                            location={locationFor(computer)}
                                            live={live[computer.id]}
                                            veyonEligible={veyonIds.has(
                                                computer.id,
                                            )}
                                            selected={selected.includes(
                                                computer.id,
                                            )}
                                            onSelected={(checked) =>
                                                setSelected((current) =>
                                                    checked
                                                        ? [
                                                              ...current,
                                                              computer.id,
                                                          ]
                                                        : current.filter(
                                                              (id) =>
                                                                  id !==
                                                                  computer.id,
                                                          ),
                                                )
                                            }
                                            onView={() => setViewer(computer)}
                                            onInventory={() =>
                                                setInventoryComputerId(
                                                    computer.id,
                                                )
                                            }
                                            onEdit={() =>
                                                setEditor({
                                                    opened: true,
                                                    computer,
                                                })
                                            }
                                            onDelete={() =>
                                                removeComputer(computer)
                                            }
                                        />
                                    ))}
                                </Table.Tbody>
                            </Table>
                        </Table.ScrollContainer>
                    ) : (
                        <Stack align='center' py='xl'>
                            <ThemeIcon
                                variant='light'
                                color='gray'
                                size={48}
                                radius='xl'
                            >
                                <IconDeviceDesktop size={25} />
                            </ThemeIcon>
                            <Text fw={600}>No computers registered</Text>
                            <Text size='sm' c='dimmed'>
                                {loading
                                    ? 'Loading inventory...'
                                    : 'Register computers in FOG or add a manual Veyon target.'}
                            </Text>
                        </Stack>
                    )}
                    {!loading ? (
                        <TablePagination
                            pagination={pagination}
                            label='computers'
                            showPageSizeSelector
                        />
                    ) : null}
                </Stack>
            </Card>

            <ComputerEditor
                state={editor}
                onClose={() => setEditor({ opened: false, computer: null })}
                onSaved={(computer) => {
                    setComputers((current) => {
                        const exists = current.some(
                            (item) => item.id === computer.id,
                        );
                        return exists
                            ? current.map((item) =>
                                  item.id === computer.id ? computer : item,
                              )
                            : [...current, computer];
                    });
                    setEditor({ opened: false, computer: null });
                    void load();
                }}
            />
            <Modal
                opened={Boolean(inventoryComputer)}
                onClose={() => setInventoryComputerId(null)}
                title={`Computer: ${inventoryIdentity?.hostname || inventoryComputer?.name || 'Computer'}`}
                size='lg'
            >
                {inventoryComputer && (
                    <Tabs defaultValue='overview'>
                        <Tabs.List>
                            <Tabs.Tab value='overview'>Overview</Tabs.Tab>
                            <Tabs.Tab value='live'>Live session</Tabs.Tab>
                            <Tabs.Tab value='hardware'>Hardware</Tabs.Tab>
                            <Tabs.Tab value='deployment'>Deployment</Tabs.Tab>
                        </Tabs.List>
                        <Tabs.Panel value='overview' pt='md'>
                            <Stack gap='xs'>
                                {inventoryWarning && (
                                    <Alert color='yellow'>
                                        {inventoryWarning}
                                    </Alert>
                                )}
                                <DeviceIdentityDetails
                                    identity={inventoryIdentity}
                                    hostname={inventoryComputer.name}
                                    address={inventoryComputer.host}
                                />
                                <Text size='sm'>
                                    Inventory source:{' '}
                                    {inventoryComputer.fogHostId != null
                                        ? 'FOG (authoritative)'
                                        : 'Manual Veyon target'}
                                </Text>
                                <Text size='sm'>
                                    Veyon ID:{' '}
                                    {veyonIds.has(inventoryComputer.id)
                                        ? inventoryComputer.id
                                        : 'Not managed'}
                                </Text>
                                <Text size='sm'>
                                    FOG ID:{' '}
                                    {inventoryFogHostId ?? 'Not registered'}
                                </Text>
                            </Stack>
                        </Tabs.Panel>
                        <Tabs.Panel value='live' pt='md'>
                            <Stack gap='sm'>
                                <Text size='sm'>
                                    {live[inventoryComputer.id]?.state ===
                                    'online'
                                        ? `Veyon connected. User: ${(live[inventoryComputer.id] as Extract<LiveState, { state: 'online' }>).information.user.login || 'No user logged in'}`
                                        : 'Live session unavailable; this does not establish network reachability.'}
                                </Text>
                                <Button
                                    disabled={
                                        !veyonIds.has(inventoryComputer.id) ||
                                        live[inventoryComputer.id]?.state !==
                                            'online'
                                    }
                                    onClick={() => {
                                        setViewer(inventoryComputer);
                                        setInventoryComputerId(null);
                                    }}
                                >
                                    Open live view
                                </Button>
                            </Stack>
                        </Tabs.Panel>
                        <Tabs.Panel value='hardware' pt='md'>
                            {inventoryFogHostId != null ? (
                                <InventoryHostDetails
                                    key={`${inventoryComputer.id}:${inventoryFogHostId}`}
                                    host={
                                        fogHostsById.get(
                                            String(inventoryFogHostId),
                                        ) ?? {
                                            id: inventoryFogHostId,
                                            name: inventoryComputer.name,
                                        }
                                    }
                                />
                            ) : (
                                <Text size='sm' c='dimmed'>
                                    No unique FOG host is linked to this
                                    computer.
                                </Text>
                            )}
                        </Tabs.Panel>
                        <Tabs.Panel value='deployment' pt='md'>
                            {fogHostsById.get(String(inventoryFogHostId)) ? (
                                <SelectedHostCard
                                    key={inventoryComputer.id}
                                    hosts={[
                                        fogHostsById.get(
                                            String(inventoryFogHostId),
                                        )!,
                                    ]}
                                    images={images}
                                    snapins={snapins}
                                    taskTypes={taskTypes}
                                    deployTaskTypeId={deployTaskTypeId}
                                    captureTaskTypeId={captureTaskTypeId}
                                    onHostsDeleted={(ids) => {
                                        handleHostsDeleted(ids);
                                        setInventoryComputerId(null);
                                    }}
                                    onHostUpdated={handleHostUpdated}
                                    onClose={() => setInventoryComputerId(null)}
                                />
                            ) : (
                                <Text size='sm' c='dimmed'>
                                    This computer is not available in the FOG
                                    inventory.
                                </Text>
                            )}
                        </Tabs.Panel>
                    </Tabs>
                )}
            </Modal>
            <RemoteViewer
                computer={
                    directory.find((computer) => computer.id === viewer?.id) ??
                    null
                }
                live={viewer ? live[viewer.id] : undefined}
                identity={
                    viewer ? identities.lookup(identityQuery(viewer)) : null
                }
                lab={viewer ? identities.labFor(identityQuery(viewer)) : null}
                onClose={() => setViewer(null)}
                onCommand={(action, args, active, uid) =>
                    runCommand(
                        action,
                        args,
                        active,
                        uid,
                        viewer ? [viewer.id] : [],
                    )
                }
                onConfirm={(title, _description, action, color) => {
                    if (viewer)
                        confirmCommand(
                            title,
                            `Apply this action to ${viewer.name}? Unsaved work may be lost.`,
                            action,
                            color,
                            [viewer.id],
                        );
                }}
            />
            <VeyonMonitoringWall
                opened={wallOpened}
                computers={directory}
                live={live}
                initialSelection={selected}
                onClose={() => setWallOpened(false)}
                onOpenViewer={handleWallOpenViewer}
                onCommand={handleWallCommand}
            />
        </Stack>
    );
}

function ComputerRow({
    computer,
    identity,
    fogHost,
    location,
    live,
    veyonEligible,
    selected,
    onSelected,
    onView,
    onInventory,
    onEdit,
    onDelete,
}: {
    computer: VeyonComputer;
    identity: DeviceIdentity | null;
    fogHost?: FogHost;
    location: string | null;
    live?: LiveState;
    veyonEligible: boolean;
    selected: boolean;
    onSelected: (checked: boolean) => void;
    onView: () => void;
    onInventory: () => void;
    onEdit: () => void;
    onDelete: () => void;
}) {
    const [waking, setWaking] = useState(false);
    const information = live?.state === 'online' ? live.information : null;
    const fogHostId = fogHostIdFor(computer, identity);
    const wakeUnavailable = wakeUnavailableReason(identity);
    async function wake() {
        if (!identity || waking) return;
        setWaking(true);
        try {
            const result = await wakeDevice(identity.id);
            notifications.show({ color: 'teal', title: `Wake requested for ${computer.name}`, message: result.message });
        } catch (error) {
            notifications.show({ color: 'red', title: 'Wake request failed', message: notificationError(error) });
        } finally {
            setWaking(false);
        }
    }
    return (
        <Table.Tr
            bg={selected ? 'var(--mantine-color-teal-light)' : undefined}
            style={{ cursor: 'pointer' }}
            onClick={(event) =>
                onSelectionRowClick(event, () => onSelected(!selected))
            }
        >
            <Table.Td>
                <Checkbox
                    aria-label={`Select ${computer.name}`}
                    checked={selected}
                    onChange={(event) =>
                        onSelected(event.currentTarget.checked)
                    }
                />
            </Table.Td>
            <Table.Td>
                <Group gap='sm' wrap='nowrap'>
                    <ThemeIcon
                        variant='light'
                        color={information ? 'teal' : 'gray'}
                    >
                        <IconDeviceDesktop size={17} />
                    </ThemeIcon>
                    <div>
                        <Group gap={6} wrap='nowrap'>
                            <DeviceIdentityDetails
                                identity={
                                    computer.fogHostId != null && identity
                                        ? {
                                              ...identity,
                                              hostname: computer.name,
                                          }
                                        : identity
                                }
                                hostname={computer.name || computer.host}
                                address={computer.host}
                                showLab={false}
                                emptyAddressLabel='IP unavailable'
                            />
                            {computer.fogHostId != null ? (
                                <Tooltip label='FOG authoritative inventory'>
                                    <Box
                                        component='span'
                                        aria-label='FOG authoritative inventory'
                                        style={{
                                            display: 'flex',
                                            color: 'var(--mantine-color-blue-6)',
                                        }}
                                    >
                                        <IconCloud size={14} />
                                    </Box>
                                </Tooltip>
                            ) : null}
                        </Group>
                    </div>
                </Group>
            </Table.Td>
            <Table.Td>
                {location || (
                    <Tooltip
                        label={
                            identity?.addresses.length
                                ? "No unique configured lab matches this computer's IP addresses."
                                : 'No current IP is available to determine the lab.'
                        }
                    >
                        <Text c='dimmed'>Unassigned</Text>
                    </Tooltip>
                )}
            </Table.Td>
            <Table.Td>
                {information?.user.login ? (
                    <div>
                        <Text size='sm' fw={500}>
                            {information.user.fullName ||
                                information.user.login}
                        </Text>
                        <Text size='xs' c='dimmed'>
                            {information.user.login}
                        </Text>
                    </div>
                ) : (
                    <Text size='sm' c='dimmed'>
                        {information ? 'No user' : 'Session unavailable'}
                    </Text>
                )}
            </Table.Td>
            <Table.Td>
                {!veyonEligible ? (
                    <Badge color='gray' variant='outline'>
                        Not managed
                    </Badge>
                ) : live?.state === 'loading' ? (
                    <Loader size='xs' />
                ) : live?.state === 'online' ? (
                    <Badge color='teal' variant='light'>
                        Online
                    </Badge>
                ) : (
                    <Tooltip
                        label={
                            live?.state === 'offline'
                                ? live.error
                                : 'Not checked'
                        }
                    >
                        <Badge color='gray' variant='light'>
                            Unavailable
                        </Badge>
                    </Tooltip>
                )}
            </Table.Td>
            <Table.Td>
                <Tooltip
                    label={
                        fogHost?.pingstatustext ||
                        'FOG port 445 probe; independent of Veyon authentication'
                    }
                >
                    <Text size='sm' c='dimmed'>
                        {fogHost?.pingstatuscode === 0 ||
                        fogHost?.pingstatuscode === 111
                            ? 'Reachable'
                            : fogHost?.pingstatustext
                              ? 'Not reachable'
                              : 'Unknown'}
                    </Text>
                </Tooltip>
            </Table.Td>
            <Table.Td>
                <Text size='sm'>
                    {fogHost?.imagename ||
                        fogHost?.image?.name ||
                        (fogHostId != null
                            ? 'No image assigned'
                            : 'Not registered')}
                </Text>
            </Table.Td>
            <Table.Td>
                <Group justify='flex-end' gap={4} wrap='nowrap'>
                    <Tooltip label='Open live view'>
                        <ActionIcon
                            variant='subtle'
                            aria-label={`View ${computer.name}`}
                            onClick={onView}
                            disabled={!veyonEligible || !information}
                        >
                            <IconEye size={18} />
                        </ActionIcon>
                    </Tooltip>
                    <Tooltip label='Computer details'>
                        <ActionIcon
                            variant='subtle'
                            aria-label={`Inventory for ${computer.name}`}
                            onClick={onInventory}
                        >
                            <IconInfoCircle size={18} />
                        </ActionIcon>
                    </Tooltip>
                    <Menu position='bottom-end' shadow='md'>
                        <Menu.Target>
                            <ActionIcon
                                variant='subtle'
                                color='gray'
                                aria-label={`Actions for ${computer.name}`}
                            >
                                <IconDotsVertical size={18} />
                            </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                            <Menu.Item
                                leftSection={waking ? <Loader size={16} /> : <IconPower size={16} />}
                                onClick={() => void wake()}
                                disabled={waking || Boolean(wakeUnavailable)}
                                title={wakeUnavailable ?? 'Send a wake packet through the lab MikroTik interface'}
                            >
                                {waking ? 'Sending wake packet...' : 'Wake on LAN'}
                            </Menu.Item>
                            <Menu.Item
                                leftSection={<IconEdit size={16} />}
                                onClick={onEdit}
                                disabled={
                                    computer.fogHostId != null || !veyonEligible
                                }
                            >
                                Edit manual target
                            </Menu.Item>
                            <Menu.Item
                                leftSection={<IconTrash size={16} />}
                                color='red'
                                onClick={onDelete}
                                disabled={
                                    computer.fogHostId != null || !veyonEligible
                                }
                            >
                                Remove manual Veyon target
                            </Menu.Item>
                        </Menu.Dropdown>
                    </Menu>
                </Group>
            </Table.Td>
        </Table.Tr>
    );
}

function CommandDeck({
    selectedCount,
    features,
    onCommand,
    onConfirm,
    wake,
    targetName,
    embedded = false,
}: {
    selectedCount: number;
    features: VeyonFeature[];
    onCommand: (
        action: VeyonCommandAction,
        args?: Record<string, unknown>,
        active?: boolean,
        uid?: string,
    ) => Promise<void>;
    onConfirm: (
        title: string,
        description: string,
        action: VeyonCommandAction,
        color?: string,
    ) => void;
    targetName?: string;
    embedded?: boolean;
    wake?: { count: number; busy: boolean; onWake: () => void };
}) {
    const [mode, setMode] = useState<string | null>(null);
    const [text, setText] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [application, setApplication] = useState('');
    const [website, setWebsite] = useState('');
    const [customUid, setCustomUid] = useState('');
    const [customArguments, setCustomArguments] = useState('{}');
    const disabled = selectedCount === 0;
    const uniqueFeatures = [
        ...new Map(
            features.map((feature) => [featureUid(feature), feature]),
        ).values(),
    ].filter((feature) => featureUid(feature));
    const featureNames = useMemo(
        () =>
            new Map(
                uniqueFeatures.map((feature) => [
                    featureUid(feature),
                    featureName(feature),
                ]),
            ),
        [uniqueFeatures],
    );

    const controls = (
        <Stack gap='xs' miw={0}>
            {!targetName ? (
                <Group justify='space-between'>
                    <Stack gap={0}>
                        <Title order={4}>Veyon controls</Title>
                        <Text size='sm' c='dimmed'>
                            {selectedCount
                                ? `${selectedCount} target${selectedCount === 1 ? '' : 's'} armed`
                                : 'Select computers to enable controls'}
                        </Text>
                    </Stack>
                    <Badge
                        variant='dot'
                        color={selectedCount ? 'teal' : 'gray'}
                    >
                        {selectedCount} selected
                    </Badge>
                </Group>
            ) : null}

            <Scroller
                startControlProps={{ 'aria-label': 'Scroll actions left' }}
                endControlProps={{ 'aria-label': 'Scroll actions right' }}
            >
                <Group gap='xs' wrap='nowrap'>
                    <LockControl
                        label='Screen lock'
                        icon={IconLock}
                        unlockIcon={IconLockOpen}
                        disabled={disabled}
                        onLock={() => void onCommand('screen-lock')}
                        onUnlock={() =>
                            void onCommand('screen-lock', {}, false)
                        }
                    />
                    <LockControl
                        label='Input lock'
                        icon={IconKey}
                        unlockIcon={IconBolt}
                        disabled={disabled}
                        onLock={() => void onCommand('input-lock')}
                        onUnlock={() => void onCommand('input-lock', {}, false)}
                    />
                    <ControlButton
                        label='Log off'
                        icon={IconUserOff}
                        disabled={disabled}
                        color='orange'
                        onClick={() =>
                            onConfirm(
                                'Log off users',
                                'Unsaved work may be lost on all selected computers.',
                                'user-logoff',
                                'orange',
                            )
                        }
                    />
                    <ControlButton
                        label='Restart'
                        icon={IconReload}
                        disabled={disabled}
                        color='orange'
                        onClick={() =>
                            onConfirm(
                                'Restart computers',
                                'Restart all selected computers now? Unsaved work may be lost.',
                                'reboot',
                                'orange',
                            )
                        }
                    />
                    <ControlButton
                        label='Shut down'
                        icon={IconPower}
                        disabled={disabled}
                        color='red'
                        onClick={() =>
                            onConfirm(
                                'Shut down computers',
                                'Power down all selected computers now? Unsaved work may be lost.',
                                'power-down',
                            )
                        }
                    />
                    <Menu position='bottom-start' shadow='md'>
                        <Menu.Target>
                            <Button
                                size='sm'
                                variant='default'
                                disabled={disabled && !wake?.count}
                                rightSection={<IconChevronDown size={14} />}
                                style={{ flexShrink: 0 }}
                            >
                                More
                            </Button>
                        </Menu.Target>
                        <Menu.Dropdown>
                            {wake ? (
                                <Menu.Item
                                    leftSection={wake.busy ? <Loader size={16} /> : <IconPower size={16} />}
                                    disabled={wake.busy || !wake.count}
                                    onClick={wake.onWake}
                                    title='Wake selected computers through MikroTik, independently of Veyon'
                                >
                                    {wake.busy ? 'Sending wake packets...' : `Wake on LAN (${wake.count})`}
                                </Menu.Item>
                            ) : null}
                            {(
                                [
                                    ['message', 'Message', IconMessage],
                                    ['login', 'Sign in', IconUser],
                                    ['program', 'Program', IconCommand],
                                    ['website', 'Website', IconBrowser],
                                    ['plugin', 'Plugin', IconBrandWindows],
                                ] as const
                            ).map(([value, label, Icon]) => (
                                <Menu.Item
                                    key={value}
                                    leftSection={<Icon size={16} />}
                                    disabled={disabled}
                                    onClick={() => setMode(value)}
                                >
                                    {label}
                                </Menu.Item>
                            ))}
                        </Menu.Dropdown>
                    </Menu>
                </Group>
            </Scroller>

            {mode && !disabled ? (
                <Stack gap='xs'>
                    <Group justify='flex-end'>
                        <ActionIcon
                            variant='subtle'
                            color='gray'
                            aria-label='Close command panel'
                            onClick={() => setMode(null)}
                        >
                            <IconX size={16} />
                        </ActionIcon>
                    </Group>
                    {mode === 'message' ? (
                        <CommandForm
                            title='Send a text message'
                            icon={IconMessage}
                        >
                            <Textarea
                                label='Message'
                                value={text}
                                onChange={(event) =>
                                    setText(event.currentTarget.value)
                                }
                                minRows={3}
                                placeholder='Message shown on selected screens'
                            />
                            <Button
                                disabled={disabled || !text.trim()}
                                onClick={() =>
                                    void onCommand('text-message', {
                                        text: text.trim(),
                                    })
                                }
                            >
                                Send message
                            </Button>
                        </CommandForm>
                    ) : null}
                    {mode === 'login' ? (
                        <CommandForm title='Log in a user' icon={IconUser}>
                            <TextInput
                                label='Username'
                                value={username}
                                onChange={(event) =>
                                    setUsername(event.currentTarget.value)
                                }
                            />
                            <PasswordInput
                                label='Password'
                                value={password}
                                onChange={(event) =>
                                    setPassword(event.currentTarget.value)
                                }
                            />
                            <Button
                                disabled={disabled || !username || !password}
                                onClick={() =>
                                    void onCommand('user-login', {
                                        username,
                                        password,
                                    })
                                }
                            >
                                Log in
                            </Button>
                        </CommandForm>
                    ) : null}
                    {mode === 'program' ? (
                        <CommandForm
                            title='Run program or system command'
                            icon={IconCommand}
                        >
                            <TextInput
                                label='Executable and arguments'
                                description='Resolved and executed by the Veyon client session'
                                value={application}
                                onChange={(event) =>
                                    setApplication(event.currentTarget.value)
                                }
                                placeholder='notepad.exe C:\Course\notes.txt'
                            />
                            <Button
                                disabled={disabled || !application.trim()}
                                onClick={() =>
                                    void onCommand('start-app', {
                                        applications: [application.trim()],
                                    })
                                }
                            >
                                Run program
                            </Button>
                        </CommandForm>
                    ) : null}
                    {mode === 'website' ? (
                        <CommandForm title='Open website' icon={IconBrowser}>
                            <TextInput
                                type='url'
                                label='Website URL'
                                value={website}
                                onChange={(event) =>
                                    setWebsite(event.currentTarget.value)
                                }
                                placeholder='https://example.edu/lesson'
                            />
                            <Button
                                disabled={disabled || !website.trim()}
                                onClick={() =>
                                    void onCommand('open-website', {
                                        websiteUrls: [website.trim()],
                                    })
                                }
                            >
                                Open website
                            </Button>
                        </CommandForm>
                    ) : null}
                    {mode === 'plugin' ? (
                        <CommandForm
                            title='Installed Veyon feature'
                            icon={IconBrandWindows}
                        >
                            <Autocomplete
                                label='Feature UID'
                                data={uniqueFeatures.map((feature) =>
                                    featureUid(feature),
                                )}
                                value={customUid}
                                onChange={setCustomUid}
                                placeholder='Select or enter an advertised feature UID'
                                renderOption={({ option }) => (
                                    <Stack gap={0}>
                                        <Text size='sm'>
                                            {featureNames.get(option.value) ??
                                                option.value}
                                        </Text>
                                        <Text
                                            size='xs'
                                            c='dimmed'
                                            ff='monospace'
                                        >
                                            {option.value}
                                        </Text>
                                    </Stack>
                                )}
                                filter={({ options, search }) => {
                                    const query = search.toLowerCase().trim();
                                    if (!query) return options;
                                    // Runtime options are parsed combobox items
                                    // ({ value, label }), not the raw strings.
                                    return options.filter((option) => {
                                        const uid =
                                            typeof option === 'string'
                                                ? option
                                                : String(
                                                      (
                                                          option as {
                                                              value?: unknown;
                                                          }
                                                      ).value ?? '',
                                                  );
                                        return (
                                            uid.toLowerCase().includes(query) ||
                                            (featureNames.get(uid) ?? '')
                                                .toLowerCase()
                                                .includes(query)
                                        );
                                    });
                                }}
                            />
                            <Textarea
                                label='Arguments (JSON)'
                                value={customArguments}
                                onChange={(event) =>
                                    setCustomArguments(
                                        event.currentTarget.value,
                                    )
                                }
                                minRows={3}
                                styles={{ input: { fontFamily: 'monospace' } }}
                            />
                            <Group>
                                {[true, false].map((active) => (
                                    <Button
                                        key={String(active)}
                                        variant={active ? 'filled' : 'light'}
                                        color={active ? 'teal' : 'red'}
                                        disabled={disabled || !customUid}
                                        onClick={() => {
                                            try {
                                                const args = JSON.parse(
                                                    customArguments,
                                                ) as Record<string, unknown>;
                                                void onCommand(
                                                    'custom-feature',
                                                    args,
                                                    active,
                                                    customUid,
                                                );
                                            } catch {
                                                notifications.show({
                                                    color: 'red',
                                                    title: 'Invalid JSON',
                                                    message:
                                                        'Feature arguments must be a JSON object.',
                                                });
                                            }
                                        }}
                                    >
                                        {active
                                            ? 'Start feature'
                                            : 'Stop feature'}
                                    </Button>
                                ))}
                            </Group>
                        </CommandForm>
                    ) : null}
                </Stack>
            ) : null}
        </Stack>
    );
    return targetName || embedded ? (
        controls
    ) : (
        <Card withBorder radius='lg' p='sm' miw={0}>
            {controls}
        </Card>
    );
}

function LockControl({
    label,
    icon: Icon,
    unlockIcon: UnlockIcon,
    disabled,
    onLock,
    onUnlock,
}: {
    label: string;
    icon: typeof IconLock;
    unlockIcon: typeof IconLock;
    disabled: boolean;
    onLock: () => void;
    onUnlock: () => void;
}) {
    return (
        <Menu position='bottom-start' shadow='md'>
            <Menu.Target>
                <Button
                    size='sm'
                    variant='light'
                    color='teal'
                    disabled={disabled}
                    leftSection={<Icon size={16} />}
                    rightSection={<IconChevronDown size={14} />}
                    style={{ flexShrink: 0 }}
                >
                    {label}
                </Button>
            </Menu.Target>
            <Menu.Dropdown>
                <Menu.Item leftSection={<Icon size={16} />} onClick={onLock}>
                    Lock
                </Menu.Item>
                <Menu.Item
                    leftSection={<UnlockIcon size={16} />}
                    onClick={onUnlock}
                >
                    Unlock
                </Menu.Item>
            </Menu.Dropdown>
        </Menu>
    );
}

function ControlButton({
    label,
    icon: Icon,
    onClick,
    disabled,
    color = 'teal',
}: {
    label: string;
    icon: typeof IconLock;
    onClick: () => void;
    disabled: boolean;
    color?: string;
}) {
    return (
        <Button
            size='sm'
            variant='light'
            color={color}
            disabled={disabled}
            onClick={onClick}
            style={{ flexShrink: 0 }}
            leftSection={<Icon size={16} />}
        >
            {label}
        </Button>
    );
}

function CommandForm({
    title,
    icon: Icon,
    children,
}: {
    title: string;
    icon: typeof IconCommand;
    children: ReactNode;
}) {
    return (
        <Paper bg='var(--mantine-color-default-hover)' p='md' radius='md'>
            <Stack gap='sm'>
                <Group gap='xs'>
                    <Icon size={18} />
                    <Text fw={600}>{title}</Text>
                </Group>
                {children}
            </Stack>
        </Paper>
    );
}

function ComputerEditor({
    state,
    onClose,
    onSaved,
}: {
    state: EditorState;
    onClose: () => void;
    onSaved: (computer: VeyonComputer) => void;
}) {
    const [name, setName] = useState('');
    const [host, setHost] = useState('');
    const [location, setLocation] = useState('');
    const [macAddress, setMacAddress] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setName(state.computer?.name ?? '');
        setHost(state.computer?.host ?? '');
        setLocation(state.computer?.location ?? '');
        setMacAddress(state.computer?.macAddress ?? '');
    }, [state.computer, state.opened]);

    const save = async () => {
        setSaving(true);
        try {
            const input = {
                name: name.trim(),
                host: host.trim(),
                location: location.trim(),
                macAddress: macAddress.trim(),
            };
            onSaved(
                state.computer
                    ? await updateVeyonComputer(state.computer.id, input)
                    : await createVeyonComputer(input),
            );
            notifications.show({
                color: 'teal',
                title: 'Computer saved',
                message: `${input.name} is ready for Veyon management.`,
            });
        } catch (error) {
            notifications.show({
                color: 'red',
                title: 'Save failed',
                message: notificationError(error),
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            opened={state.opened}
            onClose={onClose}
            title={state.computer ? 'Edit computer' : 'Add computer'}
            centered
        >
            <Stack>
                {state.computer?.fogHostId != null ? (
                    <Alert
                        color='blue'
                        icon={<IconCloud size={16} />}
                        title='Managed by FOG'
                    >
                        FOG owns this computer identity. Update its host record
                        in FOG; the manual Veyon editor cannot override it.
                    </Alert>
                ) : null}
                <TextInput
                    label='Display name'
                    value={name}
                    onChange={(event) => setName(event.currentTarget.value)}
                    required
                    data-autofocus
                />
                <TextInput
                    label='Host address'
                    description='Hostname/IP and optional Veyon session port'
                    placeholder='lab-pc-01.example.edu:11100'
                    value={host}
                    onChange={(event) => setHost(event.currentTarget.value)}
                    required
                />
                <TextInput
                    label='Location'
                    placeholder='Lab A'
                    value={location}
                    onChange={(event) => setLocation(event.currentTarget.value)}
                />
                <TextInput
                    label='MAC address'
                    description='Optional device identity address'
                    placeholder='00:11:22:33:44:55'
                    value={macAddress}
                    onChange={(event) =>
                        setMacAddress(event.currentTarget.value)
                    }
                />
                <Group justify='flex-end'>
                    <Button variant='default' onClick={onClose}>
                        Cancel
                    </Button>
                    <Button
                        loading={saving}
                        disabled={!name.trim() || !host.trim()}
                        onClick={() => void save()}
                    >
                        Save computer
                    </Button>
                </Group>
            </Stack>
        </Modal>
    );
}

function RemoteViewer({
    computer,
    live,
    identity,
    lab,
    onClose,
    onCommand,
    onConfirm,
}: {
    computer: VeyonComputer | null;
    live?: LiveState;
    identity: DeviceIdentity | null;
    lab: DeviceLab | null;
    onClose: () => void;
    onCommand: (
        action: VeyonCommandAction,
        args?: Record<string, unknown>,
        active?: boolean,
        uid?: string,
    ) => Promise<void>;
    onConfirm: (
        title: string,
        description: string,
        action: VeyonCommandAction,
        color?: string,
    ) => void;
}) {
    const information = live?.state === 'online' ? live.information : null;
    const error = live?.state === 'offline' ? live.error : '';
    const [failedImage, setFailedImage] = useState<string | null>(null);

    // One backend polling worker per machine feeds this view; the browser
    // never polls Veyon directly and failed polls keep the last frame.
    const { frames, connected } = useVeyonScreenshots(
        computer ? [computer.id] : [],
        {
            minFrameIntervalMs: 10_000,
            width: 1280,
            quality: 75,
            priority: 'viewer',
        },
    );
    const frame = computer ? frames[computer.id] : undefined;

    useEffect(() => {
        setFailedImage(null);
    }, [computer?.id]);

    if (!computer) return null;
    const failed = Boolean(frame?.consecutiveFailures || frame?.lastError);
    const stale = Boolean(
        frame?.image && (frame.stale || failed || !connected),
    );
    const unavailable = Boolean(
        (!frame?.image && error) ||
        (frame?.image && failedImage === frame.image),
    );
    const status = unavailable
        ? 'Unavailable'
        : stale
          ? 'Stale'
          : failed
            ? 'Unavailable'
            : !connected
              ? 'Connecting'
              : !frame?.image
                ? 'Waiting'
                : 'Live';
    const staleSeconds =
        frame?.lastUpdated != null
            ? Math.max(0, Math.round((Date.now() - frame.lastUpdated) / 1000))
            : null;
    return (
        <Modal
            opened
            onClose={onClose}
            closeButtonProps={{ 'aria-label': 'Close' }}
            title={`Remote view · ${identity?.hostname || computer.name || computer.host}`}
            size='calc(100vw - 48px)'
            centered
        >
            <Stack>
                <DeviceIdentityDetails
                    identity={identity}
                    hostname={computer.name || computer.host}
                    address={computer.host}
                    lab={lab}
                />
                <Group justify='space-between'>
                    <Group gap='xs'>
                        <Badge
                            color={
                                status === 'Unavailable'
                                    ? 'red'
                                    : stale
                                      ? 'orange'
                                      : status === 'Live'
                                        ? 'teal'
                                        : 'gray'
                            }
                            variant='dot'
                        >
                            {status}
                        </Badge>
                        {stale && frame?.image ? (
                            <Tooltip
                                label={
                                    frame.lastError ??
                                    'Last screenshot is being kept while retries back off'
                                }
                            >
                                <Text size='sm' c='dimmed'>
                                    {staleSeconds != null
                                        ? `last frame ${staleSeconds}s ago`
                                        : 'last frame kept'}
                                </Text>
                            </Tooltip>
                        ) : null}
                        {information?.user.login ? (
                            <Text size='sm' c='dimmed'>
                                {information.user.fullName ||
                                    information.user.login}
                            </Text>
                        ) : null}
                        {information ? (
                            <Group
                                gap='sm'
                                style={{ overflowWrap: 'anywhere' }}
                            >
                                <Text size='xs' c='dimmed'>
                                    Session {information.session.sessionId}
                                </Text>
                                <Text size='xs' c='dimmed'>
                                    {information.session.sessionHostName ||
                                        computer.host}
                                </Text>
                                <Text size='xs' c='dimmed'>
                                    Uptime{' '}
                                    {information.session.sessionUptime >= 0
                                        ? `${Math.floor(information.session.sessionUptime / 60)} min`
                                        : 'unavailable'}
                                </Text>
                            </Group>
                        ) : null}
                        <Tooltip label='Use the command deck for controls. Direct pointer and keyboard input are not supported.'>
                            <Text size='xs' c='dimmed'>
                                Read-only preview
                            </Text>
                        </Tooltip>
                    </Group>
                    <Group gap='xs'>
                        <Button
                            component='a'
                            href={veyonFramebufferUrl(computer.id, {
                                download: true,
                            })}
                            variant='light'
                        >
                            Screenshot
                        </Button>
                    </Group>
                </Group>
                {error ? <Alert color='red'>{error}</Alert> : null}
                <CommandDeck
                    key={computer.id}
                    selectedCount={1}
                    targetName={computer.name}
                    features={information?.features ?? []}
                    onCommand={onCommand}
                    onConfirm={onConfirm}
                />
                <ScrollArea
                    bg='dark.9'
                    style={{ borderRadius: 'var(--mantine-radius-md)' }}
                >
                    <Image
                        src={frame?.image ?? undefined}
                        onError={() => setFailedImage(frame?.image ?? null)}
                        alt={`Live screen of ${computer.name}`}
                        fit='contain'
                        mah='72vh'
                        fallbackSrc='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="800" height="450"%3E%3Crect width="100%25" height="100%25" fill="%23252b32"/%3E/svg%3E'
                    />
                </ScrollArea>
            </Stack>
        </Modal>
    );
}
