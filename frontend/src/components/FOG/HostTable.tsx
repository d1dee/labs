import { ListFogHosts, type FogHost } from '@/api/fog';
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
} from '@mantine/core';
import { useSelection } from '@mantine/hooks';
import {
    IconPlayerPlay,
    IconSearch,
    IconTrash,
    IconX,
} from '@tabler/icons-react';
import { useDeferredValue, useMemo, useState } from 'react';

interface Filters {
    search: string;
    image: string | null;
    status: string | null;
    manufacturer: string | null;
    model: string | null;
}

const EMPTY_FILTERS: Filters = {
    search: '',
    image: null,
    status: null,
    manufacturer: null,
    model: null,
};

function matchesSearch(host: FogHost, term: string): boolean {
    const t = term.toLowerCase();
    return (
        host.name?.toLowerCase().includes(t) ||
        host.macs?.some((m) => m.toLowerCase().includes(t)) ||
        host.imagename?.toLowerCase().includes(t) ||
        host.inventory?.sysman?.toLowerCase().includes(t) ||
        host.inventory?.sysproduct?.toLowerCase().includes(t) ||
        host.inventory?.cpuversion?.toLowerCase().includes(t) ||
        host.ip?.toLowerCase().includes(t) ||
        false
    );
}

function toOptions(
    values: (string | undefined | null)[],
): { value: string; label: string }[] {
    return [...new Set(values.filter(Boolean) as string[])]
        .sort()
        .map((v) => ({ value: v, label: v }));
}

export function HostTable({ allHosts }: { allHosts: ListFogHosts['hosts'] }) {
    const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

    // Deferred: filters drives the expensive memo + table render at low priority.
    // The input itself updates at high priority so the controlled value stays instant.
    const deferredFilters = useDeferredValue(filters);
    const isPending = filters !== deferredFilters;

    const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) =>
        setFilters((prev) => ({ ...prev, [key]: value }));

    // Derive unique option lists from allHosts
    const imageOptions = useMemo(
        () => toOptions(allHosts.map((h) => h.imagename)),
        [allHosts],
    );
    const manufacturerOptions = useMemo(
        () => toOptions(allHosts.map((h) => h.inventory?.sysman)),
        [allHosts],
    );
    const modelOptions = useMemo(
        () => toOptions(allHosts.map((h) => h.inventory?.sysproduct)),
        [allHosts],
    );
    const statusOptions = useMemo(() => {
        const seen = new Set(
            allHosts.map((h) => h.pingstatustext ?? 'unknown'),
        );
        return [...seen].sort().map((v) => ({ value: v, label: v }));
    }, [allHosts]);

    const filteredHosts = useMemo(() => {
        return allHosts.filter((host) => {
            if (filters.search && !matchesSearch(host, filters.search))
                return false;
            if (filters.image && host.imagename !== filters.image) return false;
            if (
                filters.status &&
                (host.pingstatustext ?? 'unknown') !== filters.status
            )
                return false;
            if (
                filters.manufacturer &&
                host.inventory?.sysman !== filters.manufacturer
            )
                return false;
            if (filters.model && host.inventory?.sysproduct !== filters.model)
                return false;
            return true;
        });
    }, [allHosts, filters]);

    const filteredIds = useMemo(
        () => filteredHosts.map((h) => h.id),
        [filteredHosts],
    );

    const [selection, selectionHandlers] = useSelection<number>({
        data: filteredIds,
        resetSelectionOnDataChange: true,
    });

    const hasActiveFilters = Object.values(filters).some(
        (v) => v !== null && v !== '',
    );

    const clearFilters = () => setFilters(EMPTY_FILTERS);

    return (
        <Stack gap='md'>
            <Card p='md' withBorder>
                <Stack>
                    {/* Filter panel */}
                    <Card p='md' withBorder>
                        <Stack gap='sm'>
                            <Group grow align='flex-end'>
                                <TextInput
                                    label='Search'
                                    placeholder='Name, MAC, image, manufacturer, model, IP…'
                                    value={filters.search}
                                    onChange={(e) =>
                                        setFilter(
                                            'search',
                                            e.currentTarget.value,
                                        )
                                    }
                                    leftSection={<IconSearch size={14} />}
                                    rightSection={
                                        filters.search ? (
                                            <ActionIcon
                                                size='xs'
                                                variant='subtle'
                                                onClick={() =>
                                                    setFilter('search', '')
                                                }
                                            >
                                                <IconX size={12} />
                                            </ActionIcon>
                                        ) : undefined
                                    }
                                />
                            </Group>
                            <Group grow align='flex-end'>
                                <Select
                                    label='Image'
                                    placeholder='All images'
                                    data={imageOptions}
                                    value={filters.image}
                                    onChange={(v) => setFilter('image', v)}
                                    clearable
                                    searchable
                                    nothingFoundMessage='No images'
                                />
                                <Select
                                    label='Status'
                                    placeholder='All statuses'
                                    data={statusOptions}
                                    value={filters.status}
                                    onChange={(v) => setFilter('status', v)}
                                    clearable
                                />
                                <Select
                                    label='Manufacturer'
                                    placeholder='All manufacturers'
                                    data={manufacturerOptions}
                                    value={filters.manufacturer}
                                    onChange={(v) =>
                                        setFilter('manufacturer', v)
                                    }
                                    clearable
                                    searchable
                                    nothingFoundMessage='No manufacturers'
                                />
                                <Select
                                    label='Model'
                                    placeholder='All models'
                                    data={modelOptions}
                                    value={filters.model}
                                    onChange={(v) => setFilter('model', v)}
                                    clearable
                                    searchable
                                    nothingFoundMessage='No models'
                                />
                            </Group>
                            {hasActiveFilters && (
                                <Group justify='space-between'>
                                    <Text size='sm' c='dimmed'>
                                        Showing {filteredHosts.length} of{' '}
                                        {allHosts.length} hosts
                                    </Text>
                                    <Button
                                        size='xs'
                                        variant='subtle'
                                        leftSection={<IconX size={12} />}
                                        onClick={clearFilters}
                                    >
                                        Clear filters
                                    </Button>
                                </Group>
                            )}
                        </Stack>
                    </Card>

                    {/* Table */}
                    {allHosts.length > 0 && (
                        <Card p={0} withBorder>
                            <Table.ScrollContainer
                                minWidth='100%'
                                maxHeight={520}
                            >
                                <Table
                                    highlightOnHover
                                    withRowBorders
                                    stickyHeader
                                >
                                    <Table.Thead>
                                        <Table.Tr>
                                            <Table.Th>
                                                <Checkbox
                                                    aria-label='Select all rows'
                                                    checked={selectionHandlers.isAllSelected()}
                                                    indeterminate={
                                                        selectionHandlers.isSomeSelected() &&
                                                        !selectionHandlers.isAllSelected()
                                                    }
                                                    onChange={() => {
                                                        if (
                                                            selectionHandlers.isAllSelected()
                                                        ) {
                                                            selectionHandlers.resetSelection();
                                                        } else {
                                                            selectionHandlers.setSelection(
                                                                filteredIds,
                                                            );
                                                        }
                                                    }}
                                                />
                                            </Table.Th>
                                            <Table.Th>ID</Table.Th>
                                            <Table.Th>Name</Table.Th>
                                            <Table.Th>Image</Table.Th>
                                            <Table.Th>Brand / Model</Table.Th>
                                            <Table.Th>Status</Table.Th>
                                            <Table.Th>Actions</Table.Th>
                                        </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                        {filteredHosts.length === 0 ? (
                                            <Table.Tr>
                                                <Table.Td
                                                    colSpan={7}
                                                    ta='center'
                                                    py='xl'
                                                >
                                                    <Text c='dimmed' size='sm'>
                                                        No hosts match the
                                                        current filters
                                                    </Text>
                                                </Table.Td>
                                            </Table.Tr>
                                        ) : (
                                            filteredHosts.map((host) => (
                                                <Table.Tr
                                                    key={host.id}
                                                    bg={
                                                        selection.includes(
                                                            host.id,
                                                        )
                                                            ? 'var(--mantine-color-blue-light)'
                                                            : undefined
                                                    }
                                                >
                                                    <Table.Td>
                                                        <Checkbox
                                                            aria-label='Select row'
                                                            checked={selection.includes(
                                                                host.id,
                                                            )}
                                                            onChange={() =>
                                                                selectionHandlers.toggle(
                                                                    host.id,
                                                                )
                                                            }
                                                        />
                                                    </Table.Td>
                                                    <Table.Td>
                                                        {host.id}
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <Text
                                                            size='sm'
                                                            fw={500}
                                                        >
                                                            {host.name}
                                                        </Text>
                                                        <Text
                                                            size='sm'
                                                            c='dimmed'
                                                            ff='monospace'
                                                        >
                                                            {host.macs?.[0] ||
                                                                '-'}
                                                        </Text>
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <Text size='sm'>
                                                            {host.imagename ||
                                                                'No image'}
                                                        </Text>
                                                    </Table.Td>
                                                    <Table.Td
                                                        onClick={(e) =>
                                                            e.preventDefault()
                                                        }
                                                    >
                                                        {host.inventory ? (
                                                            <InventoryCard
                                                                host={host}
                                                            />
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
                                                                <ActionIcon color='green'>
                                                                    <IconPlayerPlay
                                                                        size={
                                                                            16
                                                                        }
                                                                    />
                                                                </ActionIcon>
                                                            </Tooltip>
                                                            <Tooltip label='Send Snapin'>
                                                                <ActionIcon color='blue'>
                                                                    <IconPlayerPlay
                                                                        size={
                                                                            16
                                                                        }
                                                                    />
                                                                </ActionIcon>
                                                            </Tooltip>
                                                            <Tooltip label='Delete'>
                                                                <ActionIcon color='red'>
                                                                    <IconTrash
                                                                        size={
                                                                            16
                                                                        }
                                                                    />
                                                                </ActionIcon>
                                                            </Tooltip>
                                                        </Group>
                                                    </Table.Td>
                                                </Table.Tr>
                                            ))
                                        )}
                                    </Table.Tbody>
                                </Table>
                            </Table.ScrollContainer>
                        </Card>
                    )}
                </Stack>
            </Card>
        </Stack>
    );
}

function InventoryCard({ host }: { host: FogHost }) {
    const inventory = host?.inventory;
    return (
        <HoverCard width={320} shadow='md' withArrow>
            <HoverCard.Target>
                <Badge
                    radius={'md'}
                    style={{
                        cursor: 'help',
                    }}
                >
                    {inventory?.sysman || 'Unknown'} /{' '}
                    {inventory?.sysproduct || 'Unknown'}
                </Badge>
            </HoverCard.Target>
            <HoverCard.Dropdown>
                <Stack gap='xs'>
                    <Text size='sm' fw={600}>
                        Inventory
                    </Text>
                    {inventory?.sysman && (
                        <Text size='xs'>
                            <strong>Manufacturer:</strong> {inventory?.sysman}
                        </Text>
                    )}
                    {inventory?.sysproduct && (
                        <Text size='xs'>
                            <strong>Model:</strong> {inventory?.sysproduct}
                        </Text>
                    )}
                    {inventory?.sysversion && (
                        <Text size='xs'>
                            <strong>Version:</strong> {inventory?.sysversion}
                        </Text>
                    )}
                    {inventory?.sysserial && (
                        <Text size='xs'>
                            <strong>Serial:</strong> {inventory?.sysserial}
                        </Text>
                    )}
                    {inventory?.biosvendor && (
                        <Text size='xs'>
                            <strong>BIOS:</strong> {inventory?.biosvendor}{' '}
                            {inventory?.biosversion}
                        </Text>
                    )}
                    {inventory?.cpuman && (
                        <Text size='xs'>
                            <strong>CPU:</strong> {inventory?.cpuman}{' '}
                            {inventory?.cpuversion}
                        </Text>
                    )}
                    {inventory?.mem && (
                        <Text size='xs'>
                            <strong>Memory:</strong> {inventory?.mem}
                        </Text>
                    )}
                    {inventory?.hdmodel && (
                        <Text size='xs'>
                            <strong>HDD:</strong> {inventory?.hdmodel}{' '}
                            {inventory?.hdserial}
                        </Text>
                    )}
                </Stack>
            </HoverCard.Dropdown>
        </HoverCard>
    );
}
