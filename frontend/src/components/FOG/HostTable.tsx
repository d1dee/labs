import type { FogHost, ListFogHosts } from '@/api/fog';
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
import {
    IconPlayerPlay,
    IconSearch,
    IconTrash,
    IconX,
} from '@tabler/icons-react';
import { useDeferredValue, useMemo, useState } from 'react';

/** Build a O(1) lookup set from the selectedIds array */
function useSelectedSet(selectedIds: number[]): Set<number> {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => new Set(selectedIds), [selectedIds]);
}

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

export interface HostTableProps {
    allHosts: ListFogHosts['hosts'];
    selectedIds: number[];
    onSelectionChange: (ids: number[]) => void;
    onDeploy?: (host: FogHost) => void;
    onSnapin?: (host: FogHost) => void;
    onDelete?: (host: FogHost) => void;
    loading?: boolean;
}

export function HostTable({
    allHosts,
    selectedIds,
    onSelectionChange,
    onDeploy,
    onSnapin,
    onDelete,
    loading = false,
}: HostTableProps) {
    const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

    const deferredFilters = useDeferredValue(filters);
    const isPending = filters !== deferredFilters;

    // O(1) selected-id lookup — rebuilt only when selectedIds reference changes
    const selectedSet = useSelectedSet(selectedIds);

    const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) =>
        setFilters((prev) => ({ ...prev, [key]: value }));

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
            if (
                deferredFilters.search &&
                !matchesSearch(host, deferredFilters.search)
            )
                return false;
            if (
                deferredFilters.image &&
                host.imagename !== deferredFilters.image
            )
                return false;
            if (
                deferredFilters.status &&
                (host.pingstatustext ?? 'unknown') !== deferredFilters.status
            )
                return false;
            if (
                deferredFilters.manufacturer &&
                host.inventory?.sysman !== deferredFilters.manufacturer
            )
                return false;
            if (
                deferredFilters.model &&
                host.inventory?.sysproduct !== deferredFilters.model
            )
                return false;
            return true;
        });
    }, [allHosts, deferredFilters]);

    const filteredIds = useMemo(
        () => filteredHosts.map((h) => h.id),
        [filteredHosts],
    );

    const isAllSelected =
        filteredIds.length > 0 &&
        filteredIds.every((id) => selectedSet.has(id));
    const isSomeSelected =
        filteredIds.some((id) => selectedSet.has(id)) && !isAllSelected;

    const toggleAll = () => {
        if (isAllSelected) {
            // Deselect all filtered ids — use a set for O(n) total
            const filteredSet = new Set(filteredIds);
            onSelectionChange(selectedIds.filter((id) => !filteredSet.has(id)));
        } else {
            // Select all filtered ids (merge with existing)
            const merged = [...new Set([...selectedIds, ...filteredIds])];
            onSelectionChange(merged);
        }
    };

    const toggleOne = (id: number) => {
        if (selectedSet.has(id)) {
            onSelectionChange(selectedIds.filter((i) => i !== id));
        } else {
            onSelectionChange([...selectedIds, id]);
        }
    };

    const hasActiveFilters = Object.values(filters).some(
        (v) => v !== null && v !== '',
    );
    const clearFilters = () => setFilters(EMPTY_FILTERS);

    return (
        <Stack gap='md'>
            <Card p='md' withBorder style={{ position: 'relative' }}>
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
                                        {isPending && ' …'}
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
                            {selectedIds.length > 0 && (
                                <Text size='sm' c='blue' fw={500}>
                                    {selectedIds.length} host
                                    {selectedIds.length !== 1 ? 's' : ''}{' '}
                                    selected
                                </Text>
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
                                                    checked={isAllSelected}
                                                    indeterminate={
                                                        isSomeSelected
                                                    }
                                                    onChange={toggleAll}
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
                                                        selectedSet.has(host.id)
                                                            ? 'var(--mantine-color-blue-light)'
                                                            : undefined
                                                    }
                                                    style={{
                                                        cursor: 'pointer',
                                                    }}
                                                    onClick={() =>
                                                        toggleOne(host.id)
                                                    }
                                                >
                                                    <Table.Td
                                                        onClick={(e) =>
                                                            e.stopPropagation()
                                                        }
                                                    >
                                                        <Checkbox
                                                            aria-label='Select row'
                                                            checked={selectedSet.has(
                                                                host.id,
                                                            )}
                                                            onChange={() =>
                                                                toggleOne(
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
                                                            e.stopPropagation()
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
                                                                <ActionIcon
                                                                    color='green'
                                                                    onClick={() =>
                                                                        onDeploy?.(
                                                                            host,
                                                                        )
                                                                    }
                                                                >
                                                                    <IconPlayerPlay
                                                                        size={
                                                                            16
                                                                        }
                                                                    />
                                                                </ActionIcon>
                                                            </Tooltip>
                                                            <Tooltip label='Send Snapin'>
                                                                <ActionIcon
                                                                    color='blue'
                                                                    onClick={() =>
                                                                        onSnapin?.(
                                                                            host,
                                                                        )
                                                                    }
                                                                >
                                                                    <IconPlayerPlay
                                                                        size={
                                                                            16
                                                                        }
                                                                    />
                                                                </ActionIcon>
                                                            </Tooltip>
                                                            <Tooltip label='Delete'>
                                                                <ActionIcon
                                                                    color='red'
                                                                    onClick={() =>
                                                                        onDelete?.(
                                                                            host,
                                                                        )
                                                                    }
                                                                >
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
