import type { FogHost, ListFogHosts } from '@/api/fog';
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
import { useEffect, useMemo, useState } from 'react';
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
    const {
        filters,
        setFilter,
        clearFilters,
        isPending,
        filteredHosts,
        hasActiveFilters,
        imageOptions,
        statusOptions,
        manufacturerOptions,
        modelOptions,
    } = useHostFilters(allHosts);

    const [page, setPage] = useState(1);
    const PAGE_SIZE = 20;

    const paginatedHosts = useMemo(
        () => filteredHosts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
        [filteredHosts, page],
    );
    const totalPages = Math.max(1, Math.ceil(filteredHosts.length / PAGE_SIZE));

    const hostIds = useMemo(
        () => paginatedHosts.map((v) => v.id),
        [paginatedHosts],
    );

    const [selection, handlers] = useSelection({
        data: hostIds,
        resetSelectionOnDataChange: true,
    });

    const [inventoryHost, setInventoryHost] = useState<FogHost | null>(null);
    const [inventoryOpened, { open: openInventory, close: closeInventory }] =
        useDisclosure(false);

    useEffect(() => {
        setSelectedIds(selection);
    }, [selection.join()]);

    useEffect(() => {
        setPage(1);
    }, [filteredHosts.length]);

    return (
        <Stack gap='md'>
            <Card p='md' withBorder style={{ position: 'relative' }}>
                <Stack>
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

                    <Card p={0} withBorder style={{ position: 'relative' }}>
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
                        <Table.ScrollContainer minWidth='100%'>
                            <Table highlightOnHover withRowBorders stickyHeader>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>
                                            <Checkbox
                                                aria-label='Select all rows'
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
                                        <Table.Th>ID</Table.Th>
                                        <Table.Th>Name</Table.Th>
                                        <Table.Th>Image</Table.Th>
                                        <Table.Th>Brand / Model</Table.Th>
                                        <Table.Th>Status</Table.Th>
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
                                                    handlers.select(host.id)
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
                                                            handlers.select(
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
                    </Card>

                    <Modal
                        opened={inventoryOpened}
                        onClose={closeInventory}
                        title={`Inventory: ${inventoryHost?.name || 'Host'}`}
                        size='sm'
                    >
                        {inventoryHost ? (
                            <InventoryDetails host={inventoryHost} />
                        ) : null}
                    </Modal>

                    {totalPages > 1 && (
                        <Group justify='space-between' align='center'>
                            <Text size='sm' c='dimmed'>
                                {(page - 1) * PAGE_SIZE + 1}–
                                {Math.min(page * PAGE_SIZE, filteredHosts.length)}{' '}
                                of {filteredHosts.length} hosts
                            </Text>
                            <Pagination
                                total={totalPages}
                                value={page}
                                onChange={setPage}
                            />
                        </Group>
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
