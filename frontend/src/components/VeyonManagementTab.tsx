import {
    createVeyonComputer,
    deleteVeyonComputer,
    getVeyonInformation,
    getVeyonStatus,
    listVeyonComputers,
    powerOnVeyonComputer,
    sendVeyonCommand,
    setVeyonDemo,
    updateVeyonComputer,
    veyonFramebufferUrl,
    type VeyonCommandAction,
    type VeyonComputer,
    type VeyonFeature,
    type VeyonInformation,
} from '@/api/veyon';
import VeyonMonitoringWall from '@/components/veyon/VeyonMonitoringWall';
import VeyonSyncModal from '@/components/veyon/VeyonSyncModal';
import {
    ActionIcon,
    Alert,
    Autocomplete,
    Badge,
    Box,
    Button,
    Card,
    Checkbox,
    Divider,
    Group,
    Image,
    Loader,
    Menu,
    Modal,
    Paper,
    PasswordInput,
    ScrollArea,
    Select,
    SegmentedControl,
    SimpleGrid,
    Stack,
    Table,
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
    IconCloud,
    IconCloudDownload,
    IconCommand,
    IconDeviceDesktop,
    IconDotsVertical,
    IconEdit,
    IconEye,
    IconKey,
    IconLayoutGrid,
    IconLock,
    IconLockOpen,
    IconMessage,
    IconPlus,
    IconPower,
    IconRefresh,
    IconReload,
    IconScreenShare,
    IconTrash,
    IconUser,
    IconUserOff,
} from '@tabler/icons-react';
import {
    startTransition,
    type ReactNode,
    useCallback,
    useDeferredValue,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

export type LiveState =
    | { state: 'loading' }
    | { state: 'online'; information: VeyonInformation }
    | { state: 'offline'; error: string };

type EditorState = { opened: boolean; computer: VeyonComputer | null };

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function featureUid(feature: VeyonFeature) {
    return feature.uid || feature.id || '';
}

function featureName(feature: VeyonFeature) {
    return feature.displayName || feature.name || featureUid(feature) || 'Unknown feature';
}

async function loadInformationInBatches(computers: VeyonComputer[]) {
    const entries: Array<[string, LiveState]> = [];
    for (let index = 0; index < computers.length; index += 6) {
        const batch = computers.slice(index, index + 6);
        const results = await Promise.all(
            batch.map(async (computer): Promise<[string, LiveState]> => {
                try {
                    return [
                        computer.id,
                        { state: 'online', information: await getVeyonInformation(computer.id) },
                    ];
                } catch (error) {
                    return [computer.id, { state: 'offline', error: errorMessage(error) }];
                }
            }),
        );
        entries.push(...results);
    }
    return entries;
}

export default function VeyonManagementTab() {
    const [configured, setConfigured] = useState<boolean | null>(null);
    const [computers, setComputers] = useState<VeyonComputer[]>([]);
    const [live, setLive] = useState<Record<string, LiveState>>({});
    const [selected, setSelected] = useState<string[]>([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [editor, setEditor] = useState<EditorState>({ opened: false, computer: null });
    const [viewer, setViewer] = useState<VeyonComputer | null>(null);
    const [syncOpened, setSyncOpened] = useState(false);
    const [wallOpened, setWallOpened] = useState(false);
    const deferredSearch = useDeferredValue(search.trim().toLowerCase());

    const filteredComputers = useMemo(
        () =>
            computers.filter((computer) =>
                [computer.name, computer.host, computer.location ?? '']
                    .join(' ')
                    .toLowerCase()
                    .includes(deferredSearch),
            ),
        [computers, deferredSearch],
    );
    const onlineCount = Object.values(live).filter((value) => value.state === 'online').length;
    const loggedInCount = Object.values(live).filter(
        (value) => value.state === 'online' && Boolean(value.information.user.login),
    ).length;

    const load = async () => {
        setLoading(true);
        try {
            const status = await getVeyonStatus();
            setConfigured(status.configured);
            if (!status.configured) return;
            const response = await listVeyonComputers();
            setComputers(response.computers);
            setSelected((current) =>
                current.filter((id) => response.computers.some((computer) => computer.id === id)),
            );
            setLive(
                Object.fromEntries(response.computers.map((computer) => [computer.id, { state: 'loading' }])),
            );
            const entries = await loadInformationInBatches(response.computers);
            startTransition(() => setLive(Object.fromEntries(entries)));
        } catch (error) {
            notifications.show({ color: 'red', title: 'Veyon unavailable', message: errorMessage(error) });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const runCommand = async (
        action: VeyonCommandAction,
        argumentsValue: Record<string, unknown> = {},
        active = true,
        featureUidValue?: string,
        targetIds?: string[],
    ) => {
        const targets = targetIds ?? selected;
        if (!targets.length) return;
        try {
            const result = await sendVeyonCommand({
                computerIds: targets,
                action,
                active,
                arguments: argumentsValue,
                featureUid: featureUidValue,
            });
            const failures = result.results.filter((item) => !item.success);
            notifications.show({
                color: failures.length ? 'orange' : 'teal',
                title: failures.length ? 'Command partially completed' : 'Command completed',
                message: failures.length
                    ? failures.map((item) => `${item.name}: ${item.error}`).join('; ')
                    : `${result.results.length} computer${result.results.length === 1 ? '' : 's'} updated.`,
                icon: failures.length ? <IconAlertCircle size={16} /> : <IconCheck size={16} />,
            });
            if (['user-login', 'user-logoff', 'reboot', 'power-down'].includes(action)) {
                window.setTimeout(() => void load(), 1200);
            }
        } catch (error) {
            notifications.show({ color: 'red', title: 'Command failed', message: errorMessage(error) });
        }
    };

    const confirmCommand = (
        title: string,
        description: string,
        action: VeyonCommandAction,
        color = 'red',
    ) => {
        modals.openConfirmModal({
            title,
            children: <Text size='sm'>{description}</Text>,
            labels: { confirm: title, cancel: 'Cancel' },
            confirmProps: { color },
            onConfirm: () => void runCommand(action),
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
        (computerId: string, action: VeyonCommandAction) =>
            runCommandRef.current(action, {}, true, undefined, [computerId]),
        [],
    );

    const removeComputer = (computer: VeyonComputer) => {
        modals.openConfirmModal({
            title: 'Remove computer',
            children: <Text size='sm'>Remove {computer.name} from this management directory?</Text>,
            labels: { confirm: 'Remove', cancel: 'Cancel' },
            confirmProps: { color: 'red' },
            onConfirm: async () => {
                try {
                    await deleteVeyonComputer(computer.id);
                    setComputers((current) => current.filter((item) => item.id !== computer.id));
                    setSelected((current) => current.filter((id) => id !== computer.id));
                } catch (error) {
                    notifications.show({ color: 'red', title: 'Remove failed', message: errorMessage(error) });
                }
            },
        });
    };

    if (loading && configured === null) {
        return (
            <Stack align='center' py={80} gap='sm'>
                <Loader color='teal' />
                <Text c='dimmed'>Opening secure Veyon console...</Text>
            </Stack>
        );
    }

    if (!configured) {
        return (
            <Alert color='yellow' title='Veyon is not configured' icon={<IconAlertCircle size={18} />}>
                Configure and verify a Veyon WebAPI proxy in Settings → Veyon before managing computers.
            </Alert>
        );
    }

    return (
        <Stack gap='lg'>
            <Paper
                p={{ base: 'md', md: 'xl' }}
                radius='lg'
                style={{
                    color: 'white',
                    background:
                        'linear-gradient(125deg, var(--mantine-color-dark-8) 0%, var(--mantine-color-teal-9) 145%)',
                    overflow: 'hidden',
                }}
            >
                <Group justify='space-between' align='flex-start'>
                    <Group align='flex-start'>
                        <ThemeIcon size={46} radius='md' color='teal' variant='light'>
                            <IconScreenShare size={25} />
                        </ThemeIcon>
                        <div>
                            <Text tt='uppercase' size='xs' fw={700} c='teal.2' lts={1.4}>
                                Veyon operations desk
                            </Text>
                            <Title order={2} c='white'>Computer management</Title>
                            <Text c='gray.4' size='sm' maw={620}>
                                Monitor active sessions and dispatch classroom controls through the organization proxy.
                            </Text>
                        </div>
                    </Group>
                    <Group gap='xs'>
                        <Button
                            variant='light'
                            color='teal'
                            leftSection={<IconCloudDownload size={16} />}
                            onClick={() => setSyncOpened(true)}
                        >
                            Sync with FOG
                        </Button>
                        <Button
                            variant='light'
                            color='teal'
                            leftSection={<IconLayoutGrid size={16} />}
                            disabled={computers.length === 0}
                            onClick={() => setWallOpened(true)}
                        >
                            Live monitor
                        </Button>
                        <Button
                            variant='white'
                            color='dark'
                            leftSection={<IconPlus size={16} />}
                            onClick={() => setEditor({ opened: true, computer: null })}
                        >
                            Add computer
                        </Button>
                        <ActionIcon
                            variant='light'
                            color='gray'
                            size='lg'
                            aria-label='Refresh computers'
                            onClick={() => void load()}
                            loading={loading}
                        >
                            <IconRefresh size={18} />
                        </ActionIcon>
                    </Group>
                </Group>
                <SimpleGrid cols={{ base: 2, sm: 4 }} mt='xl'>
                    <Metric label='Directory' value={computers.length} />
                    <Metric label='Online' value={onlineCount} accent />
                    <Metric label='Users active' value={loggedInCount} />
                    <Metric label='Selected' value={selected.length} />
                </SimpleGrid>
            </Paper>

            <Card withBorder radius='lg' p='md'>
                <Stack gap='md'>
                    <Group justify='space-between' align='flex-end'>
                        <div>
                            <Title order={4}>Live computers</Title>
                            <Text size='sm' c='dimmed'>
                                Select targets first, then apply controls from the command deck.
                            </Text>
                        </div>
                        <TextInput
                            placeholder='Filter name, host, room...'
                            value={search}
                            onChange={(event) => setSearch(event.currentTarget.value)}
                            w={{ base: '100%', sm: 300 }}
                        />
                    </Group>
                    {computers.length ? (
                        <Table.ScrollContainer minWidth={760}>
                            <Table verticalSpacing='sm' highlightOnHover>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th w={46}>
                                            <Checkbox
                                                aria-label='Select all visible computers'
                                                checked={
                                                    filteredComputers.length > 0 &&
                                                    filteredComputers.every((computer) => selected.includes(computer.id))
                                                }
                                                indeterminate={
                                                    filteredComputers.some((computer) => selected.includes(computer.id)) &&
                                                    !filteredComputers.every((computer) => selected.includes(computer.id))
                                                }
                                                onChange={(event) => {
                                                    // Read currentTarget before
                                                    // the state updater runs —
                                                    // React nulls it once the
                                                    // handler returns.
                                                    const checked =
                                                        event.currentTarget.checked;
                                                    const visibleIds = filteredComputers.map((computer) => computer.id);
                                                    setSelected((current) =>
                                                        checked
                                                            ? [...new Set([...current, ...visibleIds])]
                                                            : current.filter((id) => !visibleIds.includes(id)),
                                                    );
                                                }}
                                            />
                                        </Table.Th>
                                        <Table.Th>Computer</Table.Th>
                                        <Table.Th>Location</Table.Th>
                                        <Table.Th>User session</Table.Th>
                                        <Table.Th>Status</Table.Th>
                                        <Table.Th ta='right'>Actions</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {filteredComputers.map((computer) => (
                                        <ComputerRow
                                            key={computer.id}
                                            computer={computer}
                                            live={live[computer.id]}
                                            selected={selected.includes(computer.id)}
                                            onSelected={(checked) =>
                                                setSelected((current) =>
                                                    checked
                                                        ? [...current, computer.id]
                                                        : current.filter((id) => id !== computer.id),
                                                )
                                            }
                                            onView={() => setViewer(computer)}
                                            onEdit={() => setEditor({ opened: true, computer })}
                                            onDelete={() => removeComputer(computer)}
                                        />
                                    ))}
                                </Table.Tbody>
                            </Table>
                        </Table.ScrollContainer>
                    ) : (
                        <Stack align='center' py='xl'>
                            <ThemeIcon variant='light' color='gray' size={48} radius='xl'>
                                <IconDeviceDesktop size={25} />
                            </ThemeIcon>
                            <Text fw={600}>No computers registered</Text>
                            <Text size='sm' c='dimmed'>Add a target reachable by the Veyon proxy.</Text>
                        </Stack>
                    )}
                </Stack>
            </Card>

            <CommandDeck
                selectedCount={selected.length}
                selectedComputers={computers.filter((computer) => selected.includes(computer.id))}
                features={Object.values(live).flatMap((value) =>
                    value.state === 'online' ? value.information.features : [],
                )}
                onCommand={runCommand}
                onConfirm={confirmCommand}
                onPowerOn={async () => {
                    const targets = computers.filter(
                        (computer) => selected.includes(computer.id) && computer.macAddress,
                    );
                    const results = await Promise.allSettled(
                        targets.map((computer) => powerOnVeyonComputer(computer.id)),
                    );
                    const failures = results.filter((result) => result.status === 'rejected').length;
                    notifications.show({
                        color: failures ? 'orange' : 'teal',
                        title: failures ? 'Wake-on-LAN partially sent' : 'Wake-on-LAN sent',
                        message: `${targets.length - failures} of ${targets.length} packets dispatched.`,
                    });
                }}
            />

            <ComputerEditor
                state={editor}
                onClose={() => setEditor({ opened: false, computer: null })}
                onSaved={(computer) => {
                    setComputers((current) => {
                        const exists = current.some((item) => item.id === computer.id);
                        return exists
                            ? current.map((item) => (item.id === computer.id ? computer : item))
                            : [...current, computer];
                    });
                    setEditor({ opened: false, computer: null });
                    void load();
                }}
            />
            <RemoteViewer computer={viewer} onClose={() => setViewer(null)} />
            <VeyonSyncModal
                opened={syncOpened}
                onClose={() => setSyncOpened(false)}
                onApplied={() => void load()}
            />
            <VeyonMonitoringWall
                opened={wallOpened}
                computers={computers}
                live={live}
                initialSelection={selected}
                onClose={() => setWallOpened(false)}
                onOpenViewer={handleWallOpenViewer}
                onCommand={handleWallCommand}
            />
        </Stack>
    );
}

function Metric({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
    return (
        <Box style={{ borderLeft: `2px solid ${accent ? 'var(--mantine-color-teal-4)' : 'rgba(255,255,255,.18)'}` }} pl='sm'>
            <Text size='xs' c='gray.4' tt='uppercase' lts={0.8}>{label}</Text>
            <Text size='xl' fw={700} c={accent ? 'teal.2' : 'white'}>{value}</Text>
        </Box>
    );
}

function ComputerRow({
    computer,
    live,
    selected,
    onSelected,
    onView,
    onEdit,
    onDelete,
}: {
    computer: VeyonComputer;
    live?: LiveState;
    selected: boolean;
    onSelected: (checked: boolean) => void;
    onView: () => void;
    onEdit: () => void;
    onDelete: () => void;
}) {
    const information = live?.state === 'online' ? live.information : null;
    return (
        <Table.Tr bg={selected ? 'var(--mantine-color-teal-light)' : undefined}>
            <Table.Td>
                <Checkbox
                    aria-label={`Select ${computer.name}`}
                    checked={selected}
                    onChange={(event) => onSelected(event.currentTarget.checked)}
                />
            </Table.Td>
            <Table.Td>
                <Group gap='sm' wrap='nowrap'>
                    <ThemeIcon variant='light' color={information ? 'teal' : 'gray'}>
                        <IconDeviceDesktop size={17} />
                    </ThemeIcon>
                    <div>
                        <Group gap={6} wrap='nowrap'>
                            <Text fw={600} size='sm'>{computer.name}</Text>
                            {computer.fogHostId != null ? (
                                <Tooltip label='Synced from FOG'>
                                    <Box
                                        component='span'
                                        aria-label='Synced from FOG'
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
                        <Text size='xs' c='dimmed'>{computer.host}</Text>
                    </div>
                </Group>
            </Table.Td>
            <Table.Td>{computer.location || <Text c='dimmed'>Unassigned</Text>}</Table.Td>
            <Table.Td>
                {information?.user.login ? (
                    <div>
                        <Text size='sm' fw={500}>{information.user.fullName || information.user.login}</Text>
                        <Text size='xs' c='dimmed'>{information.user.login}</Text>
                    </div>
                ) : (
                    <Text size='sm' c='dimmed'>No user</Text>
                )}
            </Table.Td>
            <Table.Td>
                {live?.state === 'loading' ? (
                    <Loader size='xs' />
                ) : live?.state === 'online' ? (
                    <Badge color='teal' variant='light'>Online</Badge>
                ) : (
                    <Tooltip label={live?.state === 'offline' ? live.error : 'Not checked'}>
                        <Badge color='gray' variant='light'>Offline</Badge>
                    </Tooltip>
                )}
            </Table.Td>
            <Table.Td>
                <Group justify='flex-end' gap={4} wrap='nowrap'>
                    <Tooltip label='Open live view'>
                        <ActionIcon variant='subtle' aria-label={`View ${computer.name}`} onClick={onView} disabled={!information}>
                            <IconEye size={18} />
                        </ActionIcon>
                    </Tooltip>
                    <Menu position='bottom-end' shadow='md'>
                        <Menu.Target>
                            <ActionIcon variant='subtle' color='gray' aria-label={`Actions for ${computer.name}`}>
                                <IconDotsVertical size={18} />
                            </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                            <Menu.Item leftSection={<IconEdit size={16} />} onClick={onEdit}>Edit target</Menu.Item>
                            <Menu.Item leftSection={<IconTrash size={16} />} color='red' onClick={onDelete}>Remove target</Menu.Item>
                        </Menu.Dropdown>
                    </Menu>
                </Group>
            </Table.Td>
        </Table.Tr>
    );
}

function CommandDeck({
    selectedCount,
    selectedComputers,
    features,
    onCommand,
    onConfirm,
    onPowerOn,
}: {
    selectedCount: number;
    selectedComputers: VeyonComputer[];
    features: VeyonFeature[];
    onCommand: (action: VeyonCommandAction, args?: Record<string, unknown>, active?: boolean, uid?: string) => Promise<void>;
    onConfirm: (title: string, description: string, action: VeyonCommandAction, color?: string) => void;
    onPowerOn: () => Promise<void>;
}) {
    const [mode, setMode] = useState('message');
    const [text, setText] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [application, setApplication] = useState('');
    const [website, setWebsite] = useState('');
    const [customUid, setCustomUid] = useState('');
    const [customArguments, setCustomArguments] = useState('{}');
    const [demoSource, setDemoSource] = useState<string | null>(null);
    const [demoWindowed, setDemoWindowed] = useState('fullscreen');
    const disabled = selectedCount === 0;
    const uniqueFeatures = [...new Map(features.map((feature) => [featureUid(feature), feature])).values()].filter(
        (feature) => featureUid(feature),
    );
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

    return (
        <Card withBorder radius='lg' p={{ base: 'md', md: 'lg' }}>
            <Stack gap='lg'>
                <Group justify='space-between'>
                    <div>
                        <Title order={4}>Command deck</Title>
                        <Text size='sm' c='dimmed'>
                            {selectedCount ? `${selectedCount} target${selectedCount === 1 ? '' : 's'} armed` : 'Select computers to enable controls'}
                        </Text>
                    </div>
                    <Badge size='lg' variant='dot' color={selectedCount ? 'teal' : 'gray'}>{selectedCount} selected</Badge>
                </Group>

                <SimpleGrid cols={{ base: 2, sm: 4, lg: 8 }} spacing='xs'>
                    <ControlButton label='Lock screens' icon={IconLock} disabled={disabled} onClick={() => void onCommand('screen-lock')} />
                    <ControlButton label='Unlock' icon={IconLockOpen} disabled={disabled} onClick={() => void onCommand('screen-lock', {}, false)} />
                    <ControlButton label='Lock input' icon={IconKey} disabled={disabled} onClick={() => void onCommand('input-lock')} />
                    <ControlButton label='Unlock input' icon={IconBolt} disabled={disabled} onClick={() => void onCommand('input-lock', {}, false)} />
                    <ControlButton label='Wake' icon={IconPower} disabled={disabled || !selectedComputers.some((computer) => computer.macAddress)} onClick={() => void onPowerOn()} />
                    <ControlButton label='Log off' icon={IconUserOff} disabled={disabled} color='orange' onClick={() => onConfirm('Log off users', 'Unsaved work may be lost on all selected computers.', 'user-logoff', 'orange')} />
                    <ControlButton label='Restart' icon={IconReload} disabled={disabled} color='orange' onClick={() => onConfirm('Restart computers', 'Restart all selected computers now? Unsaved work may be lost.', 'reboot', 'orange')} />
                    <ControlButton label='Shut down' icon={IconPower} disabled={disabled} color='red' onClick={() => onConfirm('Shut down computers', 'Power down all selected computers now? Unsaved work may be lost.', 'power-down')} />
                </SimpleGrid>

                <Divider />
                <SegmentedControl
                    value={mode}
                    onChange={setMode}
                    fullWidth
                    data={[
                        { value: 'message', label: 'Message' },
                        { value: 'login', label: 'Sign in' },
                        { value: 'program', label: 'Program' },
                        { value: 'website', label: 'Website' },
                        { value: 'plugin', label: 'Plugin' },
                        { value: 'demo', label: 'Demo' },
                    ]}
                />
                {mode === 'message' ? (
                    <CommandForm title='Send a text message' icon={IconMessage}>
                        <Textarea label='Message' value={text} onChange={(event) => setText(event.currentTarget.value)} minRows={3} placeholder='Message shown on selected screens' />
                        <Button disabled={disabled || !text.trim()} onClick={() => void onCommand('text-message', { text: text.trim() })}>Send message</Button>
                    </CommandForm>
                ) : null}
                {mode === 'login' ? (
                    <CommandForm title='Log in a user' icon={IconUser}>
                        <TextInput label='Username' value={username} onChange={(event) => setUsername(event.currentTarget.value)} />
                        <PasswordInput label='Password' value={password} onChange={(event) => setPassword(event.currentTarget.value)} />
                        <Button disabled={disabled || !username || !password} onClick={() => void onCommand('user-login', { username, password })}>Log in</Button>
                    </CommandForm>
                ) : null}
                {mode === 'program' ? (
                    <CommandForm title='Run program or system command' icon={IconCommand}>
                        <TextInput label='Executable and arguments' description='Resolved and executed by the Veyon client session' value={application} onChange={(event) => setApplication(event.currentTarget.value)} placeholder='notepad.exe C:\Course\notes.txt' />
                        <Button disabled={disabled || !application.trim()} onClick={() => void onCommand('start-app', { applications: [application.trim()] })}>Run program</Button>
                    </CommandForm>
                ) : null}
                {mode === 'website' ? (
                    <CommandForm title='Open website' icon={IconBrowser}>
                        <TextInput type='url' label='Website URL' value={website} onChange={(event) => setWebsite(event.currentTarget.value)} placeholder='https://example.edu/lesson' />
                        <Button disabled={disabled || !website.trim()} onClick={() => void onCommand('open-website', { websiteUrls: [website.trim()] })}>Open website</Button>
                    </CommandForm>
                ) : null}
                {mode === 'plugin' ? (
                    <CommandForm title='Installed Veyon feature' icon={IconBrandWindows}>
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
                                    <Text size='xs' c='dimmed' ff='monospace'>
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
                        <Textarea label='Arguments (JSON)' value={customArguments} onChange={(event) => setCustomArguments(event.currentTarget.value)} minRows={3} styles={{ input: { fontFamily: 'monospace' } }} />
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
                                    {active ? 'Start feature' : 'Stop feature'}
                                </Button>
                            ))}
                        </Group>
                    </CommandForm>
                ) : null}
                {mode === 'demo' ? (
                    <CommandForm title='Broadcast a computer screen' icon={IconScreenShare}>
                        <Select
                            label='Source computer'
                            description='Select at least one additional destination computer'
                            data={selectedComputers.map((computer) => ({
                                value: computer.id,
                                label: computer.name,
                            }))}
                            value={demoSource}
                            onChange={setDemoSource}
                            placeholder='Choose broadcast source'
                            searchable
                        />
                        <SegmentedControl
                            value={demoWindowed}
                            onChange={setDemoWindowed}
                            data={[
                                { value: 'fullscreen', label: 'Full screen' },
                                { value: 'window', label: 'Window' },
                            ]}
                        />
                        <Group>
                            <Button
                                disabled={disabled || !demoSource || selectedCount < 2}
                                onClick={async () => {
                                    if (!demoSource) return;
                                    try {
                                        const result = await setVeyonDemo({
                                            sourceComputerId: demoSource,
                                            computerIds: selectedComputers.map(
                                                (computer) => computer.id,
                                            ),
                                            windowed: demoWindowed === 'window',
                                            active: true,
                                        });
                                        notifications.show({
                                            color: result.failed ? 'orange' : 'teal',
                                            title: 'Demonstration started',
                                            message: `${result.targets - result.failed} clients connected.`,
                                        });
                                    } catch (error) {
                                        notifications.show({
                                            color: 'red',
                                            title: 'Demo failed',
                                            message: errorMessage(error),
                                        });
                                    }
                                }}
                            >
                                Start broadcast
                            </Button>
                            <Button
                                variant='light'
                                color='red'
                                disabled={disabled || !demoSource}
                                onClick={async () => {
                                    if (!demoSource) return;
                                    try {
                                        await setVeyonDemo({
                                            sourceComputerId: demoSource,
                                            computerIds: selectedComputers.map(
                                                (computer) => computer.id,
                                            ),
                                            windowed: demoWindowed === 'window',
                                            active: false,
                                        });
                                        notifications.show({
                                            color: 'teal',
                                            title: 'Demonstration stopped',
                                            message: 'Selected clients returned to monitoring mode.',
                                        });
                                    } catch (error) {
                                        notifications.show({
                                            color: 'red',
                                            title: 'Stop failed',
                                            message: errorMessage(error),
                                        });
                                    }
                                }}
                            >
                                Stop broadcast
                            </Button>
                        </Group>
                    </CommandForm>
                ) : null}
            </Stack>
        </Card>
    );
}

function ControlButton({ label, icon: Icon, onClick, disabled, color = 'teal' }: { label: string; icon: typeof IconLock; onClick: () => void; disabled: boolean; color?: string }) {
    return (
        <Button h={72} variant='light' color={color} disabled={disabled} onClick={onClick} styles={{ label: { flexDirection: 'column', gap: 5 } }}>
            <Icon size={20} />
            <Text size='xs' fw={600}>{label}</Text>
        </Button>
    );
}

function CommandForm({ title, icon: Icon, children }: { title: string; icon: typeof IconCommand; children: ReactNode }) {
    return (
        <Paper bg='var(--mantine-color-default-hover)' p='md' radius='md'>
            <Stack gap='sm'>
                <Group gap='xs'><Icon size={18} /><Text fw={600}>{title}</Text></Group>
                {children}
            </Stack>
        </Paper>
    );
}

function ComputerEditor({ state, onClose, onSaved }: { state: EditorState; onClose: () => void; onSaved: (computer: VeyonComputer) => void }) {
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
            const input = { name: name.trim(), host: host.trim(), location: location.trim(), macAddress: macAddress.trim() };
            onSaved(state.computer ? await updateVeyonComputer(state.computer.id, input) : await createVeyonComputer(input));
            notifications.show({ color: 'teal', title: 'Computer saved', message: `${input.name} is ready for Veyon management.` });
        } catch (error) {
            notifications.show({ color: 'red', title: 'Save failed', message: errorMessage(error) });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal opened={state.opened} onClose={onClose} title={state.computer ? 'Edit computer' : 'Add computer'} centered>
            <Stack>
                {state.computer?.fogHostId != null ? (
                    <Alert color='blue' icon={<IconCloud size={16} />} title='Managed by FOG sync'>
                        This computer is linked to a FOG host. Its display name is managed by FOG
                        synchronization and will be renamed on the next sync; all fields remain
                        editable.
                    </Alert>
                ) : null}
                <TextInput label='Display name' value={name} onChange={(event) => setName(event.currentTarget.value)} required data-autofocus />
                <TextInput label='Host address' description='Hostname/IP and optional Veyon session port' placeholder='lab-pc-01.example.edu:11100' value={host} onChange={(event) => setHost(event.currentTarget.value)} required />
                <TextInput label='Location' placeholder='Lab A' value={location} onChange={(event) => setLocation(event.currentTarget.value)} />
                <TextInput label='MAC address' description='Required only for Wake-on-LAN' placeholder='00:11:22:33:44:55' value={macAddress} onChange={(event) => setMacAddress(event.currentTarget.value)} />
                <Group justify='flex-end'><Button variant='default' onClick={onClose}>Cancel</Button><Button loading={saving} disabled={!name.trim() || !host.trim()} onClick={() => void save()}>Save computer</Button></Group>
            </Stack>
        </Modal>
    );
}

function RemoteViewer({ computer, onClose }: { computer: VeyonComputer | null; onClose: () => void }) {
    const [imageUrl, setImageUrl] = useState('');
    const [information, setInformation] = useState<VeyonInformation | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!computer) return;
        let active = true;
        const refresh = () => {
            if (active) setImageUrl(veyonFramebufferUrl(computer.id, { width: 1280 }));
        };
        getVeyonInformation(computer.id).then(setInformation).catch((value) => setError(errorMessage(value)));
        refresh();
        const interval = window.setInterval(refresh, 1500);
        return () => {
            active = false;
            window.clearInterval(interval);
            setInformation(null);
            setError('');
        };
    }, [computer]);

    if (!computer) return null;
    return (
        <Modal opened onClose={onClose} title={`Remote view · ${computer.name}`} size='calc(100vw - 48px)' centered>
            <Stack>
                <Group justify='space-between'>
                    <Group gap='xs'>
                        <Badge color={error ? 'red' : 'teal'} variant='dot'>{error ? 'Unavailable' : 'Live · 1.5 s'}</Badge>
                        {information?.user.login ? <Text size='sm' c='dimmed'>{information.user.fullName || information.user.login}</Text> : null}
                    </Group>
                    <Group gap='xs'>
                        <Button component='a' href={veyonFramebufferUrl(computer.id, { download: true })} variant='light'>Screenshot</Button>
                    </Group>
                </Group>
                {error ? <Alert color='red'>{error}</Alert> : null}
                <ScrollArea bg='dark.9' style={{ borderRadius: 'var(--mantine-radius-md)' }}>
                    <Image src={imageUrl} alt={`Live screen of ${computer.name}`} fit='contain' mah='72vh' fallbackSrc='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="800" height="450"%3E%3Crect width="100%25" height="100%25" fill="%23252b32"/%3E%3C/svg%3E' />
                </ScrollArea>
                {information ? (
                    <SimpleGrid cols={{ base: 1, sm: 3 }}>
                        <SessionField label='Session ID' value={String(information.session.sessionId)} />
                        <SessionField label='Session host' value={information.session.sessionHostName || computer.host} />
                        <SessionField label='Uptime' value={`${Math.floor(information.session.sessionUptime / 60)} minutes`} />
                    </SimpleGrid>
                ) : null}
                <Text size='xs' c='dimmed'>The Veyon WebAPI exposes framebuffer images but no pointer or keyboard endpoint, so this view is read-only.</Text>
            </Stack>
        </Modal>
    );
}

function SessionField({ label, value }: { label: string; value: string }) {
    return <Paper withBorder p='xs'><Text size='xs' c='dimmed'>{label}</Text><Text size='sm' fw={600}>{value}</Text></Paper>;
}
