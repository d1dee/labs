import { addPiholeDomain, type PiholeQueries } from '@/api/pihole';
import { useApiStream } from '@/api/useApiStream';
import {
    deviceIdentitySearchText,
    useDeviceIdentities,
} from '@/api/useDeviceIdentities';
import { DeviceIdentityDetails } from '@/components/ui/DeviceIdentityDetails';
import {
    MobileFilterPanel,
    MobileFilterToggle,
    useMobileTableFilters,
} from '@/components/ui/MobileTableFilters';
import {
    TablePagination,
    useTablePagination,
} from '@/components/ui/TablePagination';
import {
    compareTableValues,
    SortableTh,
    toggleTableSort,
    type SortState,
} from '@/components/ui/tableUtils';
import {
    ActionIcon,
    Alert,
    Badge,
    Box,
    Button,
    Card,
    Center,
    Flex,
    Group,
    Loader,
    Menu,
    Modal,
    Select,
    Stack,
    Table,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { IconDotsVertical, IconPlus } from '@tabler/icons-react';
import { useState, type FC } from 'react';

const isBlockedStatus = (status: string): boolean => {
    const blocked = [
        'GRAVITY',
        'DENYLIST',
        'REGEX',
        'EXACT',
        'BLOCK',
        'SPECIAL_DOMAIN',
    ];
    return blocked.some((s) => status?.toUpperCase().includes(s));
};

const statusColor = (status: string): string => {
    const st = status?.toUpperCase() || '';
    if (isBlockedStatus(status)) return 'red';
    if (st.includes('FORWARD')) return 'blue';
    if (st.includes('CACHE')) return 'green';
    return 'gray';
};

const BlockedSitesTab: FC = () => {
    const identities = useDeviceIdentities();
    const filters = useMobileTableFilters();
    const [queriesData, setQueriesData] = useState<PiholeQueries>();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('all');
    const [outcome, setOutcome] = useState('all');
    const [type, setType] = useState('all');
    const [labId, setLabId] = useState('all');
    const [blockDomain, setBlockDomain] = useState<string | null>(null);
    const [blockKind, setBlockKind] = useState<'exact' | 'regex'>('exact');
    const [blockRule, setBlockRule] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [blockError, setBlockError] = useState<string | null>(null);
    const [dateRange, setDateRange] = useState<[string | null, string | null]>([
        null,
        null,
    ]);
    const [sort, setSort] = useState<
        SortState<'time' | 'domain' | 'client' | 'type' | 'status'>
    >({ key: 'time', direction: 'desc' });

    const refresh = useApiStream<PiholeQueries>(
        '/api/pihole/queries?length=200',
        (data) => {
            setQueriesData(data);
            setError(null);
            setLoading(false);
        },
        (err) => {
            setError(err.message);
            setLoading(false);
        },
    );

    const openBlock = (domain: string) => {
        setBlockDomain(domain);
        setBlockKind('exact');
        setBlockRule(domain);
        setBlockError(null);
    };

    const handleBlock = async () => {
        if (!blockRule.trim() || submitting) return;
        setSubmitting(true);
        setBlockError(null);
        try {
            const result = await addPiholeDomain(
                blockRule.trim(),
                'deny',
                blockKind,
            );
            if (result.processed?.errors.length) {
                throw new Error(
                    result.processed.errors
                        .map((item) => item.error)
                        .join('; '),
                );
            }
            notifications.show({
                color: 'green',
                title: 'Network block added',
                message: `Added ${blockRule.trim()} as an ${blockKind} Pi-hole deny rule.`,
            });
            setBlockDomain(null);
            refresh();
        } catch (err) {
            setBlockError(err instanceof Error ? err.message : String(err));
        } finally {
            setSubmitting(false);
        }
    };

    const queries = queriesData?.queries ?? [];
    const from = dateRange[0]
        ? new Date(`${dateRange[0]}T00:00:00`).getTime() / 1000
        : null;
    const until = dateRange[1]
        ? new Date(`${dateRange[1]}T23:59:59.999`).getTime() / 1000
        : null;
    const incompleteRange = Boolean(dateRange[0] && !dateRange[1]);
    const visibleQueries = queries
        .map((q) => {
            const client = { address: q.client.ip, hostname: q.client.name };
            return {
                ...q,
                identity: identities.lookup(client),
                lab: identities.labFor(client),
            };
        })
        .filter(
            (q) =>
                `${q.domain} ${q.client.name} ${q.client.ip} ${deviceIdentitySearchText(q.identity)} ${q.lab?.name ?? ''} ${q.lab?.dhcpServer ?? ''}`
                    .toLowerCase()
                    .includes(search.trim().toLowerCase()) &&
                (status === 'all' || q.status === status) &&
                (outcome === 'all' ||
                    isBlockedStatus(q.status) === (outcome === 'blocked')) &&
                (type === 'all' || q.type === type) &&
                (labId === 'all' || q.lab?.id === labId) &&
                (incompleteRange ||
                    ((from === null || q.time >= from) &&
                        (until === null || q.time <= until))),
        )
        .sort((a, b) =>
            compareTableValues(
                sort.key === 'client'
                    ? a.identity?.hostname || a.client.name || a.client.ip
                    : a[sort.key],
                sort.key === 'client'
                    ? b.identity?.hostname || b.client.name || b.client.ip
                    : b[sort.key],
                sort.direction,
            ),
        );

    const pagination = useTablePagination(
        visibleQueries,
        JSON.stringify([
            search,
            status,
            outcome,
            type,
            labId,
            dateRange,
            sort.key,
            sort.direction,
        ]),
    );

    if (loading) {
        return (
            <Center py={60}>
                <Loader />
            </Center>
        );
    }

    return (
        <Card withBorder radius='lg' p='md'>
            <Stack gap='md'>
                {error && (
                    <Alert color='red' title='Queries Request Failed'>
                        {error}
                    </Alert>
                )}
                {identities.warning ? (
                    <Text size='xs' c='dimmed' role='status'>
                        {identities.warning}
                    </Text>
                ) : null}
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
                        <Group>
                            <Title order={4}>DNS Queries</Title>{' '}
                            <Badge variant='light' color='blue' radius='sm'>
                                {visibleQueries.length} / {queries.length}{' '}
                                queries
                            </Badge>
                        </Group>
                        <Text size='sm' c='dimmed'>
                            Allowed and blocked Pi-hole DNS queries stream every
                            10 seconds. Filters apply to the latest 200 fetched
                            queries, not complete historical data. Dates use
                            local time.
                        </Text>
                    </Stack>
                    <Group
                        align='flex-end'
                        justify='flex-end'
                        w={{ base: '100%', sm: 300 }}
                        style={{ flexShrink: 0 }}
                    >
                        <Group
                            wrap='nowrap'
                            gap='xs'
                            w={{ base: '100%', sm: 300 }}
                        >
                            <TextInput
                                aria-label='Search DNS queries'
                                placeholder='Search domains or clients...'
                                value={search}
                                flex={1}
                                miw={0}
                                onChange={(event) =>
                                    setSearch(event.currentTarget.value)
                                }
                            />
                            <MobileFilterToggle
                                opened={filters.opened}
                                onToggle={filters.toggle}
                                controlsId={filters.controlsId}
                                label='Toggle DNS query filters'
                            />
                        </Group>
                    </Group>
                </Flex>
                <MobileFilterPanel
                    opened={filters.opened}
                    id={filters.controlsId}
                >
                    <Group grow preventGrowOverflow={false} align='flex-end'>
                        <Select
                            miw={{ base: '100%', sm: 180 }}
                            label='Lab'
                            value={labId}
                            allowDeselect={false}
                            onChange={(value) => setLabId(value ?? 'all')}
                            data={[
                                { value: 'all', label: 'All labs' },
                                ...identities.labs.map((lab) => ({
                                    value: lab.id,
                                    label: lab.name,
                                })),
                            ]}
                        />
                        <Select
                            miw={{ base: '100%', sm: 180 }}
                            label='Query outcome'
                            value={outcome}
                            allowDeselect={false}
                            onChange={(value) => setOutcome(value ?? 'all')}
                            data={[
                                { value: 'all', label: 'All queries' },
                                { value: 'blocked', label: 'Blocked' },
                                { value: 'allowed', label: 'Allowed' },
                            ]}
                        />
                        <Select
                            miw={{ base: '100%', sm: 180 }}
                            label='Query status'
                            value={status}
                            allowDeselect={false}
                            onChange={(value) => setStatus(value ?? 'all')}
                            data={[
                                { value: 'all', label: 'All statuses' },
                                ...Array.from(
                                    new Set([
                                        ...queries.map((q) => q.status),
                                        ...(status === 'all' ? [] : [status]),
                                    ]),
                                )
                                    .sort()
                                    .map((value) => ({ value, label: value })),
                            ]}
                        />
                        <Select
                            miw={{ base: '100%', sm: 180 }}
                            label='Query type'
                            value={type}
                            allowDeselect={false}
                            onChange={(value) => setType(value ?? 'all')}
                            data={[
                                { value: 'all', label: 'All types' },
                                ...Array.from(
                                    new Set([
                                        ...queries.map((q) => q.type),
                                        ...(type === 'all' ? [] : [type]),
                                    ]),
                                )
                                    .sort()
                                    .map((value) => ({ value, label: value })),
                            ]}
                        />
                        <DatePickerInput
                            miw={{ base: '100%', sm: 180 }}
                            type='range'
                            label='Query date range'
                            value={dateRange}
                            onChange={setDateRange}
                            allowSingleDateInRange
                            clearable
                            placeholder='All fetched dates'
                            clearButtonProps={{
                                'aria-label': 'Clear query date range',
                            }}
                            description={
                                incompleteRange
                                    ? 'Choose an end date to apply the range.'
                                    : undefined
                            }
                        />
                    </Group>
                </MobileFilterPanel>
                {visibleQueries.length === 0 ? (
                    <Center py='xl'>
                        <Text c='dimmed'>
                            {queries.length
                                ? 'No DNS queries match your filters.'
                                : 'No DNS queries found in the latest fetched queries.'}
                        </Text>
                    </Center>
                ) : (
                    <Table.ScrollContainer minWidth={900} maxHeight={500} scrollAreaProps={{ h: 500 }}>
                            <Table
                                verticalSpacing='sm'
                                highlightOnHover
                                stickyHeader
                                aria-label='DNS queries'
                            >
                                <Table.Thead>
                                    <Table.Tr>
                                        {(
                                            [
                                                'time',
                                                'domain',
                                                'client',
                                                'type',
                                                'status',
                                            ] as const
                                        ).map((key) => (
                                            <SortableTh
                                                key={key}
                                                label={
                                                    key[0].toUpperCase() +
                                                    key.slice(1)
                                                }
                                                active={sort.key === key}
                                                direction={sort.direction}
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
                                        <Table.Th data-table-actions>Actions</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {pagination.pageItems.map((q) => {
                                        const date = new Date(q.time * 1000);
                                        return (
                                            <Table.Tr key={q.id}>
                                                <Table.Td>
                                                    <Text size='sm'>
                                                        {date.toLocaleString()}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Text
                                                        size='sm'
                                                        ff='monospace'
                                                    >
                                                        {q.domain}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <DeviceIdentityDetails
                                                        identity={q.identity}
                                                        hostname={q.client.name}
                                                        address={q.client.ip}
                                                        lab={q.lab}
                                                    />
                                                </Table.Td>
                                                <Table.Td>
                                                    <Badge
                                                        size='sm'
                                                        variant='light'
                                                        color='blue'
                                                    >
                                                        {q.type}
                                                    </Badge>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Badge
                                                        size='sm'
                                                        variant='light'
                                                        color={statusColor(
                                                            q.status,
                                                        )}
                                                    >
                                                        {q.status}
                                                    </Badge>
                                                </Table.Td>
                                                <Table.Td data-table-actions>
                                                    <Button
                                                        visibleFrom='sm'
                                                        size='xs'
                                                        variant='light'
                                                        color='red'
                                                        aria-label={`Add ${q.domain} to network block`}
                                                        onClick={() =>
                                                            openBlock(q.domain)
                                                        }
                                                    >
                                                        Add to block
                                                    </Button>
                                                    <Box hiddenFrom='sm'>
                                                        <Menu position='bottom-end'>
                                                            <Menu.Target>
                                                                <ActionIcon variant='subtle' aria-label={`Actions for query ${q.id}`}>
                                                                    <IconDotsVertical size={16} />
                                                                </ActionIcon>
                                                            </Menu.Target>
                                                            <Menu.Dropdown>
                                                                <Menu.Item
                                                                    color='red'
                                                                    leftSection={<IconPlus size={16} />}
                                                                    onClick={() => openBlock(q.domain)}
                                                                >
                                                                    Add to block
                                                                </Menu.Item>
                                                            </Menu.Dropdown>
                                                        </Menu>
                                                    </Box>
                                                </Table.Td>
                                            </Table.Tr>
                                        );
                                    })}
                                </Table.Tbody>
                            </Table>
                    </Table.ScrollContainer>
                )}
                <TablePagination pagination={pagination} label='queries' />
                <Modal
                    opened={blockDomain !== null}
                    onClose={() => {
                        if (!submitting) setBlockDomain(null);
                    }}
                    title='Add to Network Block'
                    closeButtonProps={{ disabled: submitting }}
                    centered
                >
                    <Stack gap='md'>
                        <Text size='sm'>
                            Block future queries through Pi-hole for{' '}
                            {blockDomain}. Existing query results will not
                            change.
                        </Text>
                        {blockError && (
                            <Alert color='red' title='Unable to add block'>
                                {blockError}
                            </Alert>
                        )}
                        <Select
                            label='Match type'
                            value={blockKind}
                            allowDeselect={false}
                            disabled={submitting}
                            data={[
                                { value: 'exact', label: 'Exact' },
                                { value: 'regex', label: 'Regex' },
                            ]}
                            onChange={(value) => {
                                const kind =
                                    value === 'regex' ? 'regex' : 'exact';
                                setBlockKind(kind);
                                setBlockRule(
                                    kind === 'regex'
                                        ? `^${(blockDomain ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
                                        : (blockDomain ?? ''),
                                );
                                setBlockError(null);
                            }}
                        />
                        <TextInput
                            label={
                                blockKind === 'regex'
                                    ? 'Regular expression'
                                    : 'Domain'
                            }
                            value={blockRule}
                            description={
                                blockKind === 'regex'
                                    ? 'Starts as an exact domain match. Edit the expression to broaden the rule.'
                                    : 'Blocks only this domain.'
                            }
                            onChange={(event) =>
                                setBlockRule(event.currentTarget.value)
                            }
                            disabled={submitting}
                            required
                        />
                        <Group justify='flex-end'>
                            <Button
                                variant='default'
                                disabled={submitting}
                                onClick={() => setBlockDomain(null)}
                            >
                                Cancel
                            </Button>
                            <Button
                                color='red'
                                loading={submitting}
                                disabled={!blockRule.trim()}
                                onClick={handleBlock}
                            >
                                Add Block
                            </Button>
                        </Group>
                    </Stack>
                </Modal>
            </Stack>
        </Card>
    );
};

export default BlockedSitesTab;
