import { listFogHosts, type FogHost } from '@/api/fog';
import {
    ActionIcon,
    Badge,
    Button,
    Card,
    Checkbox,
    Group,
    HoverCard,
    Stack,
    Table,
    Text,
    TextInput,
    Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
    IconPlayerPlay,
    IconSearch,
    IconTrash,
} from '@tabler/icons-react';
import {
    forwardRef,
    useEffect,
    useImperativeHandle,
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
        },
        ref,
    ) => {
        const [hosts, setHosts] = useState<FogHost[]>([]);
        const [searchName, setSearchName] = useState('');
        const [searchMac, setSearchMac] = useState('');
        const [searching, setSearching] = useState(false);
        const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

        const fetchHosts = async (search?: string) => {
            setSearching(true);
            try {
                const data = await listFogHosts(search);
                setHosts(data.hosts);
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
            const term =
                searchName.trim() || searchMac.trim() || undefined;
            fetchHosts(term);
        };

        useEffect(() => {
            fetchHosts();
        }, []);

        useImperativeHandle(ref, () => ({
            refresh: () => fetchHosts(),
            getSelectedHosts: () =>
                hosts.filter((h) => selectedIds.has(h.id)),
            clearSelection: () => {
                setSelectedIds(new Set());
                onSelectionChange?.([]);
            },
        }));

        const toggleSelectAll = () => {
            if (selectedIds.size === hosts.length && hosts.length > 0) {
                setSelectedIds(new Set());
                onSelectionChange?.([]);
            } else {
                const all = new Set(hosts.map((h) => h.id));
                setSelectedIds(all);
                onSelectionChange?.(hosts);
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
            onSelectionChange?.(hosts.filter((h) => next.has(h.id)));
        };

        const inventory = (host: FogHost) => host.inventory;

        return (
            <Stack gap='md'>
                <Card withBorder p='md'>
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

                {hosts.length > 0 && (
                    <Card withBorder p={0}>
                        <Table highlightOnHover>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>
                                        <Checkbox
                                            checked={
                                                selectedIds.size ===
                                                    hosts.length &&
                                                hosts.length > 0
                                            }
                                            indeterminate={
                                                selectedIds.size > 0 &&
                                                selectedIds.size <
                                                    hosts.length
                                            }
                                            onChange={toggleSelectAll}
                                            aria-label='Select all hosts'
                                        />
                                    </Table.Th>
                                    <Table.Th>ID</Table.Th>
                                    <Table.Th>Name</Table.Th>
                                    <Table.Th>MACs</Table.Th>
                                    <Table.Th>Image</Table.Th>
                                    <Table.Th>Brand / Model</Table.Th>
                                    <Table.Th>Status</Table.Th>
                                    <Table.Th
                                        style={{ textAlign: 'right' }}
                                    >
                                        Actions
                                    </Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {hosts.map((host) => (
                                    <Table.Tr
                                        key={host.id}
                                        style={{
                                            cursor: 'pointer',
                                            background:
                                                selectedHostId === host.id
                                                    ? 'var(--mantine-color-blue-light)'
                                                    : undefined,
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
                                                    toggleSelectRow(host)
                                                }
                                                aria-label={`Select host ${host.name}`}
                                            />
                                        </Table.Td>
                                        <Table.Td>{host.id}</Table.Td>
                                        <Table.Td>
                                            <Text fw={500}>
                                                {host.name}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td>
                                            <Text
                                                size='sm'
                                                ff='monospace'
                                            >
                                                {host.macs?.[0] || '-'}
                                            </Text>
                                        </Table.Td>
                                        <Table.Td>
                                            {host.imagename || (
                                                <Text
                                                    c='dimmed'
                                                    size='sm'
                                                >
                                                    No image
                                                </Text>
                                            )}
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
                                                                cursor:
                                                                    'help',
                                                            }}
                                                        >
                                                            {inventory(
                                                                host,
                                                            )?.sysman ||
                                                                'Unknown'}{' '}
                                                            /{' '}
                                                            {inventory(
                                                                host,
                                                            )?.sysproduct ||
                                                                'Unknown'}
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
                                                            )?.sysman && (
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
                                                            )?.sysproduct && (
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
                                                            )?.sysversion && (
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
                                                            )?.sysserial && (
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
                                                            )?.biosvendor && (
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
                                                            )?.cpuman && (
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
                                                            )?.mem && (
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
                                                            )?.hdmodel && (
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
                                                    host.pingstatuscode === 0
                                                        ? 'green'
                                                        : host.pingstatuscode ===
                                                            1
                                                          ? 'red'
                                                          : 'gray'
                                                }
                                            >
                                                {host.pingstatustext ||
                                                    'unknown'}
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
                                                        loading={taskLoading}
                                                        onClick={() =>
                                                            onDeploy(host)
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
                                                        loading={taskLoading}
                                                        onClick={() =>
                                                            onSnapin(host)
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
                                                            onDelete(host)
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
                                ))}
                            </Table.Tbody>
                        </Table>
                    </Card>
                )}
            </Stack>
        );
    },
);

HostTable.displayName = 'HostTable';

export default HostTable;
