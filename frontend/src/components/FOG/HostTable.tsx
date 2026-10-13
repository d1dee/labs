import type { FogHost, ListFogHosts } from '@/api/fog';
import { deviceIdentitySearchText, useDeviceIdentities } from '@/api/useDeviceIdentities';
import { compareTableValues, SortableTh, toggleTableSort, type SortState } from '@/components/ui/tableUtils';
import {
    ActionIcon,
    Badge,
    Box,
    Card,
    Checkbox,
    Group,
    HoverCard,
    Loader,
    Menu,
    Modal,
    Overlay,
    Pagination,
    Skeleton,
    Stack,
    Table,
    Text,
    Tooltip,
} from '@mantine/core';
import { useDisclosure, useSelection } from '@mantine/hooks';
import {
    IconDotsVertical,
    IconInfoCircle,
    IconPlayerPlay,
    IconTrash,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { HostFilterPanel, useHostFilters } from './HostFilterPanel';

export interface HostTableProps {
    allHosts: ListFogHosts['hosts'];
    setSelectedIds: React.Dispatch<React.SetStateAction<number[]>>;

    onDeploy?: (host: FogHost) => void;
    onSnapin?: (host: FogHost) => void;
    onDelete?: (host: FogHost) => void;
    loading?: boolean;
}

export function HostTable({
    allHosts,
    onDeploy,
    onSnapin,
    onDelete,
    setSelectedIds,
    loading,
}: HostTableProps) {
    const identities = useDeviceIdentities();
    const identitySearchText = useCallback((host: FogHost) =>
        deviceIdentitySearchText(identities.lookup({ fogHostId: host.id, macAddress: host.primac || host.macs?.[0] })), [identities.lookup]);
    const {
        filters,
        deferredFilters,
        setFilter,
        clearFilters,
        isPending,
        filteredHosts,
        hasActiveFilters,
        imageOptions,
        statusOptions,
        manufacturerOptions,
        modelOptions,
    } = useHostFilters(allHosts, identitySearchText);

    const [page, setPage] = useState(1);
    const [sort, setSort] = useState<SortState<'id' | 'name' | 'image' | 'inventory' | 'status'> | null>(null);
    const [previousFilters, setPreviousFilters] = useState(deferredFilters);
    if (previousFilters !== deferredFilters) {
        setPreviousFilters(deferredFilters);
        setPage(1);
    }
    const PAGE_SIZE = 20;
    const totalPages = Math.max(1, Math.ceil(filteredHosts.length / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);
    const sortedHosts = useMemo(() => {
        if (!sort) return filteredHosts;
        const value = (host: FogHost) => {
            switch (sort.key) {
                case 'id': return Number(host.id);
                case 'name': return host.name;
                case 'image': return host.imagename || null;
                case 'inventory': return host.inventory
                    ? `${host.inventory.sysman || 'Unknown'} / ${host.inventory.sysproduct || 'Unknown'}`
                    : null;
                case 'status': return host.pingstatustext || 'unknown';
            }
        };
        return [...filteredHosts].sort((a, b) => compareTableValues(value(a), value(b), sort.direction));
    }, [filteredHosts, sort]);

    const paginatedHosts = useMemo(
        () => sortedHosts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
        [sortedHosts, currentPage],
    );

    const hostIds = useMemo(
        () => paginatedHosts.map((v) => v.id),
        [paginatedHosts],
    );

    const [selection, handlers] = useSelection({
        data: hostIds,
        resetSelectionOnDataChange: false,
    });

    const [inventoryHost, setInventoryHost] = useState<FogHost | null>(null);
    const [inventoryOpened, { open: openInventory, close: closeInventory }] =
        useDisclosure(false);
    const liveInventoryHost = allHosts.find((host) => host.id === inventoryHost?.id) ?? inventoryHost;

    useEffect(() => {
        const retained = selection.filter((id) => hostIds.includes(id));
        if (retained.length !== selection.length) handlers.setSelection(retained);
    }, [hostIds, selection, handlers]);

    useEffect(() => {
        setSelectedIds(loading || isPending ? [] : selection.filter((id) => hostIds.includes(id)));
    }, [selection.join(), hostIds, setSelectedIds, loading, isPending]);

    useEffect(() => {
        setPage((current) => Math.min(current, totalPages));
    }, [totalPages]);

    return (
            <Card withBorder radius='lg' p='md'>
                <Stack gap='md'>
                    {identities.warning ? <Text size='xs' c='dimmed' role='status'>{identities.warning}</Text> : null}
                    <HostFilterPanel
                        filters={filters}
                        setFilter={setFilter}
                        clearFilters={clearFilters}
                        hasActiveFilters={hasActiveFilters}
                        isPending={isPending}
                        filteredCount={filteredHosts.length}
                        totalCount={allHosts.length}
                        selectedCount={selection.length}
                        imageOptions={imageOptions}
                        statusOptions={statusOptions}
                        manufacturerOptions={manufacturerOptions}
                        modelOptions={modelOptions}
                    />

                    {/* Table */}

                    <Box pos='relative'>
                        {loading && (
                            <Overlay
                                color='var(--mantine-color-body)'
                                backgroundOpacity={0.6}
                                center
                                radius='sm'
                            >
                                <Loader />
                            </Overlay>
                        )}
                        <Table.ScrollContainer minWidth={760}>
                            <Table verticalSpacing='sm' highlightOnHover withRowBorders stickyHeader>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>
                                            <Checkbox
                                                aria-label='Select all rows'
                                                disabled={loading || isPending || hostIds.length === 0}
                                                checked={handlers.isAllSelected()}
                                                indeterminate={handlers.isSomeSelected()}
                                                onChange={() => {
                                                    if (
                                                        handlers.isAllSelected()
                                                    ) {
                                                        handlers.resetSelection();
                                                    } else {
                                                        handlers.setSelection(
                                                            hostIds,
                                                        );
                                                    }
                                                }}
                                            />
                                        </Table.Th>
                                        {([
                                            ['id', 'ID'], ['name', 'Name'], ['image', 'Image'],
                                            ['inventory', 'Brand / Model'], ['status', 'Status'],
                                        ] as const).map(([key, label]) => (
                                            <SortableTh key={key} label={label} active={sort?.key === key}
                                                direction={sort?.direction ?? 'asc'} onSort={() => {
                                                    setSort(toggleTableSort(sort, key));
                                                    setPage(1);
                                                    handlers.resetSelection();
                                                }} />
                                        ))}
                                        <Table.Th>Actions</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>

                                <Table.Tbody>
                                    {isPending || loading ? (
                                        Array.from({ length: PAGE_SIZE }).map(
                                            (_, i) => (
                                                <Table.Tr key={i}>
                                                    <Table.Td>
                                                        <Skeleton
                                                            height={16}
                                                            width={16}
                                                        />
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <Skeleton
                                                            height={16}
                                                            width={32}
                                                        />
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <Stack gap={4}>
                                                            <Skeleton
                                                                height={16}
                                                                width='60%'
                                                            />
                                                            <Skeleton
                                                                height={12}
                                                                width='40%'
                                                            />
                                                        </Stack>
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <Skeleton
                                                            height={16}
                                                            width='50%'
                                                        />
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <Skeleton
                                                            height={20}
                                                            width='70%'
                                                            radius='md'
                                                        />
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <Skeleton
                                                            height={20}
                                                            width={64}
                                                            radius='xl'
                                                        />
                                                    </Table.Td>
                                                    <Table.Td>
                                                        <Skeleton
                                                            height={24}
                                                            width={80}
                                                        />
                                                    </Table.Td>
                                                </Table.Tr>
                                            ),
                                        )
                                    ) : paginatedHosts.length === 0 ? (
                                        <Table.Tr>
                                            <Table.Td
                                                colSpan={7}
                                                ta='center'
                                                py='xl'
                                            >
                                                <Text c='dimmed' size='sm'>
                                                    No hosts match the current
                                                    filters
                                                </Text>
                                            </Table.Td>
                                        </Table.Tr>
                                    ) : (
                                        paginatedHosts.map((host) => (
                                            <Table.Tr
                                                key={host.id}
                                                bg={
                                                    selection.includes(host.id)
                                                        ? 'var(--mantine-color-blue-light)'
                                                        : undefined
                                                }
                                                style={{
                                                    cursor: 'pointer',
                                                }}
                                                onClick={() =>
                                                    handlers.toggle(host.id)
                                                }
                                            >
                                                <Table.Td
                                                    onClick={(e) =>
                                                        e.stopPropagation()
                                                    }
                                                >
                                                    <Checkbox
                                                        aria-label='Select row'
                                                        checked={selection.includes(
                                                            host.id,
                                                        )}
                                                        onChange={() =>
                                                            handlers.toggle(
                                                                host.id,
                                                            )
                                                        }
                                                    />
                                                </Table.Td>
                                                <Table.Td>{host.id}</Table.Td>
                                                <Table.Td>
                                                    <Text size='sm' fw={500}>
                                                        {host.name}
                                                    </Text>
                                                    <Text
                                                        size='sm'
                                                        c='dimmed'
                                                        ff='monospace'
                                                    >
                                                        {host.macs?.[0] || '-'}
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
                                                        visibleFrom='sm'
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
                                                                    size={16}
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
                                                                    size={16}
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
                                                                    size={16}
                                                                />
                                                            </ActionIcon>
                                                        </Tooltip>
                                                    </Group>
                                                    <Box hiddenFrom='sm'>
                                                        <Menu position='bottom-end'>
                                                            <Menu.Target>
                                                                <ActionIcon
                                                                    variant='subtle'
                                                                    onClick={(
                                                                        e,
                                                                    ) =>
                                                                        e.stopPropagation()
                                                                    }
                                                                >
                                                                    <IconDotsVertical
                                                                        size={16}
                                                                    />
                                                                </ActionIcon>
                                                            </Menu.Target>
                                                            <Menu.Dropdown>
                                                                <Menu.Item
                                                                    leftSection={
                                                                        <IconInfoCircle
                                                                            size={16}
                                                                        />
                                                                    }
                                                                    onClick={() => {
                                                                        setInventoryHost(
                                                                            host,
                                                                        );
                                                                        openInventory();
                                                                    }}
                                                                >
                                                                    Inventory
                                                                </Menu.Item>
                                                                <Menu.Item
                                                                    leftSection={
                                                                        <IconPlayerPlay
                                                                            size={16}
                                                                            color='green'
                                                                        />
                                                                    }
                                                                    onClick={() =>
                                                                        onDeploy?.(
                                                                            host,
                                                                        )
                                                                    }
                                                                >
                                                                    Deploy
                                                                </Menu.Item>
                                                                <Menu.Item
                                                                    leftSection={
                                                                        <IconPlayerPlay
                                                                            size={16}
                                                                            color='blue'
                                                                        />
                                                                    }
                                                                    onClick={() =>
                                                                        onSnapin?.(
                                                                            host,
                                                                        )
                                                                    }
                                                                >
                                                                    Send Snapin
                                                                </Menu.Item>
                                                                <Menu.Item
                                                                    leftSection={
                                                                        <IconTrash
                                                                            size={16}
                                                                            color='red'
                                                                        />
                                                                    }
                                                                    color='red'
                                                                    onClick={() =>
                                                                        onDelete?.(
                                                                            host,
                                                                        )
                                                                    }
                                                                >
                                                                    Delete
                                                                </Menu.Item>
                                                            </Menu.Dropdown>
                                                        </Menu>
                                                    </Box>
                                                </Table.Td>
                                            </Table.Tr>
                                        ))
                                    )}
                                </Table.Tbody>
                            </Table>
                        </Table.ScrollContainer>
                    </Box>

                    <Modal
                        opened={inventoryOpened}
                        onClose={closeInventory}
                        title={`Inventory: ${liveInventoryHost?.name || 'Host'}`}
                        size='sm'
                    >
                        {liveInventoryHost ? (
                            <InventoryDetails host={liveInventoryHost} />
                        ) : null}
                    </Modal>

                    {totalPages > 1 && (
                        <Group justify='space-between' align='center'>
                            <Text size='sm' c='dimmed'>
                                {(currentPage - 1) * PAGE_SIZE + 1}–
                                {Math.min(currentPage * PAGE_SIZE, filteredHosts.length)}{' '}
                                of {filteredHosts.length} hosts
                            </Text>
                            <Pagination
                                total={totalPages}
                                value={currentPage}
                                onChange={setPage}
                            />
                        </Group>
                    )}
                </Stack>
            </Card>
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
                <InventoryDetails host={host} />
            </HoverCard.Dropdown>
        </HoverCard>
    );
}

function InventoryDetails({ host }: { host: FogHost }) {
    const inventory = host?.inventory;
    if (!inventory) {
        return (
            <Text c='dimmed' size='sm'>
                No inventory
            </Text>
        );
    }
    return (
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
    );
}
