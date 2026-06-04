import {
    listFogHosts,
    type FogHost,
    type FogImage,
    type FogSnapin,
} from '@/api/fog';
import {
    ActionIcon,
    Badge,
    Button,
    Card,
    Checkbox,
    Group,
    HoverCard,
    Select,
    Stack,
    Table,
    Text,
    TextInput,
    Tooltip,
    Transition,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlayerPlay, IconSearch, IconTrash } from '@tabler/icons-react';
import { useForm } from '@mantine/form';
import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useState,
} from 'react';

export interface HostTableHandle {
    refresh: () => Promise<void>;
    getSelectedHosts: () => FogHost[];
    clearSelection: () => void;
}

interface HostTableProps {
    onSelectHost: (host: FogHost) => void;
    onDeploy: (host: FogHost) => void;
    onSnapin: (host: FogHost) => void;
    onDelete: (host: FogHost) => void;
    selectedHostId?: number | null;
    deployTaskTypeId?: number | null;
    taskLoading?: boolean;
    onSelectionChange?: (selectedHosts: FogHost[]) => void;

    images?: FogImage[];
    snapins?: FogSnapin[];
    onBulkDeploy?: (hosts: FogHost[]) => void;
    onBulkDelete?: (hosts: FogHost[]) => void;
    onBulkAssignImage?: (hosts: FogHost[], imageId: number) => void;
    onBulkSnapin?: (hosts: FogHost[], snapinId: number) => void;
    onHostsChange?: (hosts: FogHost[]) => void;
}

const HostTable = forwardRef<HostTableHandle, HostTableProps>(
    (
        {
            onSelectHost,
            onDeploy,
            onSnapin,
            onDelete,
            selectedHostId,
            deployTaskTypeId,
            taskLoading,
            onSelectionChange,
            images = [],
            snapins = [],
            onBulkDeploy,
            onBulkDelete,
            onBulkAssignImage,
            onBulkSnapin,
            onHostsChange,
        },
        ref,
    ) => {
        const form = useForm({
            mode: 'uncontrolled',
            initialValues: {
                hosts: [] as FogHost[],
            },
        });

        const [searchName, setSearchName] = useState('');
        const [searchMac, setSearchMac] = useState('');
        const [searching, setSearching] = useState(false);
        const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

        const selectedHosts = useMemo(
            () => form.values.hosts.filter((h) => selectedIds.has(h.id)),
            [form.values.hosts, selectedIds],
        );

        const fetchHosts = async (search?: string) => {
            setSearching(true);
            try {
                const data = await listFogHosts(search);
                form.setFieldValue('hosts', data.hosts);
                onHostsChange?.(data.hosts);
            } catch (err) {
                notifications.show({
                    color: 'red',
                    title: 'Error',
                    message: String(err),
                });
            } finally {
                setSearching(false);
            }
        };

        const handleSearch = () => {
            const term = searchName.trim() || searchMac.trim() || undefined;
            fetchHosts(term);
        };

        useEffect(() => {
            fetchHosts();
        }, []);

        useImperativeHandle(ref, () => ({
            refresh: () => fetchHosts(),
            getSelectedHosts: () => selectedHosts,
            clearSelection: () => {
                setSelectedIds(new Set());
                onSelectionChange?.([]);
            },
        }));

        const toggleSelectAll = () => {
            if (selectedIds.size === form.values.hosts.length && form.values.hosts.length > 0) {
                setSelectedIds(new Set());
                onSelectionChange?.([]);
            } else {
                const all = new Set(form.values.hosts.map((h) => h.id));
                setSelectedIds(all);
                onSelectionChange?.(form.values.hosts);
            }
        };

        const toggleSelectRow = (host: FogHost) => {
            const next = new Set(selectedIds);
            if (next.has(host.id)) {
                next.delete(host.id);
            } else {
                next.add(host.id);
            }
            setSelectedIds(next);
            onSelectionChange?.(form.values.hosts.filter((h) => next.has(h.id)));
        };

        const inventory = (host: FogHost) => host.inventory;

        const rowBg = (host: FogHost) => {
            if (selectedIds.has(host.id)) {
                return 'var(--mantine-color-blue-light)';
            }
            if (selectedHostId === host.id) {
                return 'var(--mantine-color-blue-light)';
            }
            return undefined;
        };

        return (
            <Stack gap='md'>
                <Card p='md' withBorder>
                    <Stack>
                        <Card p='md' withBorder>
                            <Stack gap='sm'>
                                <Group grow>
                                    <TextInput
                                        label='Host Name'
                                        placeholder='Search by name...'
                                        value={searchName}
                                        onChange={(e) =>
                                            setSearchName(e.currentTarget.value)
                                        }
                                        onKeyDown={(e) =>
                                            e.key === 'Enter' && handleSearch()
                                        }
                                    />
                                    <TextInput
                                        label='MAC Address'
                                        placeholder='Search by MAC...'
                                        value={searchMac}
                                        onChange={(e) =>
                                            setSearchMac(e.currentTarget.value)
                                        }
                                        onKeyDown={(e) =>
                                            e.key === 'Enter' && handleSearch()
                                        }
                                    />
                                </Group>
                                <Group justify='flex-end'>
                                    <Button
                                        leftSection={<IconSearch size={14} />}
                                        onClick={handleSearch}
                                        loading={searching}
                                        size='sm'
                                    >
                                        Search
                                    </Button>
                                </Group>
                            </Stack>
                        </Card>
                        {form.values.hosts.length > 0 && (
                            <Card p={0} withBorder>
                                <Table.ScrollContainer
                                    minWidth='100%'
                                    maxHeight={520}
                                    type='native'
                                >
                                    <Table highlightOnHover withRowBorders>
                                        <Table.Thead>
                                            <Table.Tr>
                                                <Table.Th>
                                                    <Checkbox
                                                        aria-label='Select all hosts'
                                                        checked={
                                                            selectedIds.size ===
                                                                form.values
                                                                    .hosts
                                                                    .length &&
                                                            form.values.hosts
                                                                .length > 0
                                                        }
                                                        indeterminate={
                                                            selectedIds.size >
                                                                0 &&
                                                            selectedIds.size <
                                                                form.values
                                                                    .hosts
                                                                    .length
                                                        }
                                                        onChange={
                                                            toggleSelectAll
                                                        }
                                                    />
                                                </Table.Th>
                                                <Table.Th>ID</Table.Th>
                                                <Table.Th>Name</Table.Th>
                                                <Table.Th>MACs</Table.Th>
                                                <Table.Th>Image</Table.Th>
                                                <Table.Th>
                                                    Brand / Model
                                                </Table.Th>
                                                <Table.Th>Status</Table.Th>
                                                <Table.Th>Actions</Table.Th>
                                            </Table.Tr>
                                        </Table.Thead>
                                        <Table.Tbody>
                                            {form.values.hosts.map(
                                                (host, index) => (
                                                    <Table.Tr
                                                        key={host.id}
                                                        bg={rowBg(host)}
                                                        style={{
                                                            cursor: 'pointer',
                                                        }}
                                                        onClick={() =>
                                                            onSelectHost(host)
                                                        }
                                                    >
                                                        <Table.Td
                                                            onClick={(e) =>
                                                                e.stopPropagation()
                                                            }
                                                        >
                                                            <Checkbox
                                                                checked={selectedIds.has(
                                                                    host.id,
                                                                )}
                                                                onChange={() =>
                                                                    toggleSelectRow(
                                                                        host,
                                                                    )
                                                                }
                                                                aria-label={`Select host ${host.name}`}
                                                            />
                                                        </Table.Td>
                                                        <Table.Td>
                                                            {host.id}
                                                        </Table.Td>
                                                        <Table.Td
                                                            onClick={(e) =>
                                                                e.stopPropagation()
                                                            }
                                                        >
                                                            <TextInput
                                                                variant='unstyled'
                                                                size='sm'
                                                                fw={500}
                                                                key={form.key(
                                                                    `hosts.${index}.name`,
                                                                )}
                                                                {...form.getInputProps(
                                                                    `hosts.${index}.name`,
                                                                )}
                                                            />
                                                        </Table.Td>
                                                        <Table.Td>
                                                            <Text
                                                                size='sm'
                                                                ff='monospace'
                                                            >
                                                                {host.macs?.[0]
                                                                    || '-'}
                                                            </Text>
                                                        </Table.Td>
                                                        <Table.Td
                                                            onClick={(e) =>
                                                                e.stopPropagation()
                                                            }
                                                        >
                                                            <Select
                                                                variant='unstyled'
                                                                size='sm'
                                                                placeholder='No image'
                                                                data={images.map(
                                                                    (img) => ({
                                                                        value: String(
                                                                            img.id,
                                                                        ),
                                                                        label: img.name,
                                                                    }),
                                                                )}
                                                                key={form.key(
                                                                    `hosts.${index}.imageID`,
                                                                )}
                                                                {...form.getInputProps(
                                                                    `hosts.${index}.imageID`,
                                                                )}
                                                            />
                                                        </Table.Td>
                                                        <Table.Td
                                                            onClick={(e) =>
                                                                e.stopPropagation()
                                                            }
                                                        >
                                                            {inventory(host) ? (
                                                                <HoverCard
                                                                    width={320}
                                                                    shadow='md'
                                                                    withArrow
                                                                >
                                                                    <HoverCard.Target>
                                                                        <Badge
                                                                            style={{
                                                                                cursor: 'help',
                                                                            }}
                                                                        >
                                                                            {inventory(
                                                                                host,
                                                                            )
                                                                                ?.sysman
                                                                                || 'Unknown'}{' '}
                                                                            /{' '}
                                                                            {inventory(
                                                                                host,
                                                                            )
                                                                                ?.sysproduct
                                                                                || 'Unknown'}
                                                                        </Badge>
                                                                    </HoverCard.Target>
                                                                    <HoverCard.Dropdown>
                                                                        <Stack gap='xs'>
                                                                            <Text
                                                                                size='sm'
                                                                                fw={600}
                                                                            >
                                                                                Inventory
                                                                            </Text>
                                                                            {inventory(
                                                                                host,
                                                                            )
                                                                                ?.sysman && (
                                                                                <Text size='xs'>
                                                                                    <strong>
                                                                                        Manufacturer:
                                                                                    </strong>{' '}
                                                                                    {
                                                                                        inventory(
                                                                                            host,
                                                                                        )
                                                                                            ?.sysman
                                                                                    }
                                                                                </Text>
                                                                            )}
                                                                            {inventory(
                                                                                host,
                                                                            )
                                                                                ?.sysproduct && (
                                                                                <Text size='xs'>
                                                                                    <strong>
                                                                                        Model:
                                                                                    </strong>{' '}
                                                                                    {
                                                                                        inventory(
                                                                                            host,
                                                                                        )
                                                                                            ?.sysproduct
                                                                                    }
                                                                                </Text>
                                                                            )}
                                                                            {inventory(
                                                                                host,
                                                                            )
                                                                                ?.sysversion && (
                                                                                <Text size='xs'>
                                                                                    <strong>
                                                                                        Version:
                                                                                    </strong>{' '}
                                                                                    {
                                                                                        inventory(
                                                                                            host,
                                                                                        )
                                                                                            ?.sysversion
                                                                                    }
                                                                                </Text>
                                                                            )}
                                                                            {inventory(
                                                                                host,
                                                                            )
                                                                                ?.sysserial && (
                                                                                <Text size='xs'>
                                                                                    <strong>
                                                                                        Serial:
                                                                                    </strong>{' '}
                                                                                    {
                                                                                        inventory(
                                                                                            host,
                                                                                        )
                                                                                            ?.sysserial
                                                                                    }
                                                                                </Text>
                                                                            )}
                                                                            {inventory(
                                                                                host,
                                                                            )
                                                                                ?.biosvendor && (
                                                                                <Text size='xs'>
                                                                                    <strong>
                                                                                        BIOS:
                                                                                    </strong>{' '}
                                                                                    {
                                                                                        inventory(
                                                                                            host,
                                                                                        )
                                                                                            ?.biosvendor
                                                                                    }{' '}
                                                                                    {
                                                                                        inventory(
                                                                                            host,
                                                                                        )
                                                                                            ?.biosversion
                                                                                    }
                                                                                </Text>
                                                                            )}
                                                                            {inventory(
                                                                                host,
                                                                            )
                                                                                ?.cpuman && (
                                                                                <Text size='xs'>
                                                                                    <strong>
                                                                                        CPU:
                                                                                    </strong>{' '}
                                                                                    {
                                                                                        inventory(
                                                                                            host,
                                                                                        )
                                                                                            ?.cpuman
                                                                                    }{' '}
                                                                                    {
                                                                                        inventory(
                                                                                            host,
                                                                                        )
                                                                                            ?.cpuversion
                                                                                    }
                                                                                </Text>
                                                                            )}
                                                                            {inventory(
                                                                                host,
                                                                            )
                                                                                ?.mem && (
                                                                                <Text size='xs'>
                                                                                    <strong>
                                                                                        Memory:
                                                                                    </strong>{' '}
                                                                                    {
                                                                                        inventory(
                                                                                            host,
                                                                                        )
                                                                                            ?.mem
                                                                                    }
                                                                                </Text>
                                                                            )}
                                                                            {inventory(
                                                                                host,
                                                                            )
                                                                                ?.hdmodel && (
                                                                                <Text size='xs'>
                                                                                    <strong>
                                                                                        HDD:
                                                                                    </strong>{' '}
                                                                                    {
                                                                                        inventory(
                                                                                            host,
                                                                                        )
                                                                                            ?.hdmodel
                                                                                    }{' '}
                                                                                    {
                                                                                        inventory(
                                                                                            host,
                                                                                        )
                                                                                            ?.hdserial
                                                                                    }
                                                                                </Text>
                                                                            )}
                                                                        </Stack>
                                                                    </HoverCard.Dropdown>
                                                                </HoverCard>
                                                            ) : (
                                                                <Text
                                                                    c='dimmed'
                                                                    size='sm'
                                                                >
                                                                    No inventory
                                                                </Text>
                                                            )}
                                                        </Table.Td>
                                                        <Table.Td>
                                                            <Badge
                                                                color={
                                                                    host.pingstatuscode ===
                                                                    0
                                                                        ? 'green'
                                                                        : host.pingstatuscode ===
                                                                            1
                                                                          ? 'red'
                                                                          : 'gray'
                                                                }
                                                            >
                                                                {host.pingstatustext
                                                                    || 'unknown'}
                                                            </Badge>
                                                        </Table.Td>
                                                        <Table.Td>
                                                            <Group
                                                                justify='flex-end'
                                                                gap='xs'
                                                                onClick={(e) =>
                                                                    e.stopPropagation()
                                                                }
                                                            >
                                                                <Tooltip label='Deploy'>
                                                                    <ActionIcon
                                                                        color='green'
                                                                        disabled={
                                                                            !deployTaskTypeId
                                                                        }
                                                                        loading={
                                                                            taskLoading
                                                                        }
                                                                        onClick={() =>
                                                                            onDeploy(
                                                                                host,
                                                                            )
                                                                        }
                                                                    >
                                                                        <IconPlayerPlay
                                                                            size={16}
                                                                        />
                                                                    </ActionIcon>
                                                                </Tooltip>
                                                                <Tooltip label='Send Snapin'>
                                                                    <ActionIcon
                                                                        color='blue'
                                                                        loading={
                                                                            taskLoading
                                                                        }
                                                                        onClick={() =>
                                                                            onSnapin(
                                                                                host,
                                                                            )
                                                                        }
                                                                    >
                                                                        <IconPlayerPlay
                                                                            size={16}
                                                                        />
                                                                    </ActionIcon>
                                                                </Tooltip>
                                                                <Tooltip label='Delete'>
                                                                    <ActionIcon
                                                                        color='red'
                                                                        onClick={() =>
                                                                            onDelete(
                                                                                host,
                                                                            )
                                                                        }
                                                                    >
                                                                        <IconTrash
                                                                            size={16}
                                                                        />
                                                                    </ActionIcon>
                                                                </Tooltip>
                                                            </Group>
                                                        </Table.Td>
                                                    </Table.Tr>
                                                ),
                                            )}
                                        </Table.Tbody>
                                    </Table>
                                </Table.ScrollContainer>

                                <Transition
                                    mounted={selectedIds.size > 0}
                                    transition='slide-up'
                                    duration={200}
                                    timingFunction='ease'
                                >
                                    {(styles) => (
                                        <Card.Section
                                            withBorder
                                            inheritPadding
                                            py='sm'
                                            style={styles}
                                        >
                                            <Group
                                                justify='space-between'
                                                wrap='nowrap'
                                            >
                                                <Text size='sm' fw={500}>
                                                    {selectedIds.size} host
                                                    {selectedIds.size !== 1
                                                        ? 's'
                                                        : ''}{' '}
                                                    selected
                                                </Text>
                                                <Group gap='xs' wrap='nowrap'>
                                                    {images.length > 0 && (
                                                        <Select
                                                            size='xs'
                                                            placeholder='Assign image...'
                                                            data={images.map(
                                                                (img) => ({
                                                                    value: String(
                                                                        img.id,
                                                                    ),
                                                                    label: img.name,
                                                                }),
                                                            )}
                                                            onChange={(val) => {
                                                                if (
                                                                    val &&
                                                                    onBulkAssignImage
                                                                ) {
                                                                    onBulkAssignImage(
                                                                        selectedHosts,
                                                                        parseInt(
                                                                            val,
                                                                            10,
                                                                        ),
                                                                    );
                                                                }
                                                            }}
                                                            clearable
                                                            style={{
                                                                width: 160,
                                                            }}
                                                        />
                                                    )}
                                                    {snapins.length > 0 && (
                                                        <Select
                                                            size='xs'
                                                            placeholder='Send snapin...'
                                                            data={snapins.map(
                                                                (s) => ({
                                                                    value: String(
                                                                        s.id,
                                                                    ),
                                                                    label: s.name,
                                                                }),
                                                            )}
                                                            onChange={(val) => {
                                                                if (
                                                                    val &&
                                                                    onBulkSnapin
                                                                ) {
                                                                    onBulkSnapin(
                                                                        selectedHosts,
                                                                        parseInt(
                                                                            val,
                                                                            10,
                                                                        ),
                                                                    );
                                                                }
                                                            }}
                                                            clearable
                                                            style={{
                                                                width: 160,
                                                            }}
                                                        />
                                                    )}
                                                    <Button
                                                        size='xs'
                                                        color='green'
                                                        leftSection={
                                                            <IconPlayerPlay
                                                                size={14}
                                                            />
                                                        }
                                                        onClick={() =>
                                                            onBulkDeploy?.(
                                                                selectedHosts,
                                                            )
                                                        }
                                                        disabled={
                                                            !deployTaskTypeId
                                                        }
                                                        loading={taskLoading}
                                                    >
                                                        Deploy
                                                    </Button>
                                                    <Button
                                                        size='xs'
                                                        color='red'
                                                        leftSection={
                                                            <IconTrash
                                                                size={14}
                                                            />
                                                        }
                                                        onClick={() =>
                                                            onBulkDelete?.(
                                                                selectedHosts,
                                                            )
                                                        }
                                                        loading={taskLoading}
                                                    >
                                                        Delete
                                                    </Button>
                                                </Group>
                                            </Group>
                                        </Card.Section>
                                    )}
                                </Transition>
                            </Card>
                        )}
                    </Stack>
                </Card>
            </Stack>
        );
    },
);

HostTable.displayName = 'HostTable';

export default HostTable;
