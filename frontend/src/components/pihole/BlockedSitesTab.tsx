import { getPiholeQueries, type PiholeQueries } from '@/api/pihole';
import { MobileFilterPanel, MobileFilterToggle, useMobileTableFilters } from '@/components/ui/MobileTableFilters';
import { compareTableValues, SortableTh, toggleTableSort, type SortState } from '@/components/ui/tableUtils';
import { DatePickerInput } from '@mantine/dates';
import {
    Badge,
    Card,
    Center,
    Group,
    Loader,
    Select,
    ScrollArea,
    Stack,
    Table,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { type FC, useEffect, useState } from 'react';

const isBlockedStatus = (status: string): boolean => {
    const blocked = ['GRAVITY', 'DENYLIST', 'REGEX', 'EXACT', 'BLOCK'];
    return blocked.some((s) => status?.toUpperCase().includes(s));
};

const statusColor = (status: string): string => {
    const st = status?.toUpperCase() || '';
    if (
        st.includes('GRAVITY') ||
        st.includes('DENYLIST') ||
        st.includes('BLOCK')
    )
        return 'red';
    if (st.includes('FORWARD')) return 'blue';
    if (st.includes('CACHE')) return 'green';
    return 'gray';
};

const BlockedSitesTab: FC = () => {
    const filters = useMobileTableFilters();
    const [queriesData, setQueriesData] = useState<PiholeQueries>();
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [client, setClient] = useState('');
    const [status, setStatus] = useState('all');
    const [type, setType] = useState('all');
    const [dateRange, setDateRange] = useState<[string | null, string | null]>([null, null]);
    const [sort, setSort] = useState<SortState<'time' | 'domain' | 'client' | 'type' | 'status'>>({ key: 'time', direction: 'desc' });

    useEffect(() => {
        let active = true;
        let inFlight = false;
        const fetchQueries = async () => {
            if (!active || inFlight) return;
            inFlight = true;
            try {
                const data = await getPiholeQueries(200);
                if (active) setQueriesData(data);
            } catch (err) {
                if (active) console.error('Failed to load queries:', err);
            } finally {
                inFlight = false;
                if (active) setLoading(false);
            }
        };
        void fetchQueries();
        const interval = setInterval(fetchQueries, 15000);
        return () => { active = false; clearInterval(interval); };
    }, []);

    const blockedQueries = (queriesData?.queries ?? []).filter((q) => isBlockedStatus(q.status));
    const from = dateRange[0] ? new Date(`${dateRange[0]}T00:00:00`).getTime() / 1000 : null;
    const until = dateRange[1] ? new Date(`${dateRange[1]}T23:59:59.999`).getTime() / 1000 : null;
    const incompleteRange = Boolean(dateRange[0] && !dateRange[1]);
    const visibleQueries = blockedQueries.filter((q) =>
        q.domain.toLowerCase().includes(search.trim().toLowerCase())
        && `${q.client.name} ${q.client.ip}`.toLowerCase().includes(client.trim().toLowerCase())
        && (status === 'all' || q.status === status)
        && (type === 'all' || q.type === type)
        && (incompleteRange || ((from === null || q.time >= from) && (until === null || q.time <= until))),
    ).sort((a, b) => compareTableValues(
        sort.key === 'client' ? a.client.name || a.client.ip : a[sort.key],
        sort.key === 'client' ? b.client.name || b.client.ip : b[sort.key], sort.direction,
    ));

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
                <Group justify='space-between' align='flex-end'>
                    <div>
                        <Title order={4}>Blocked Sites</Title>
                        <Text size='sm' c='dimmed'>
                            Filters apply only to blocked entries in the latest 200 fetched queries, not complete historical data. Dates use local time.
                        </Text>
                    </div>
                    <Group align='flex-end' w={{ base: '100%', sm: 'auto' }}>
                        <Group wrap='nowrap' gap='xs' w={{ base: '100%', sm: 300 }}>
                            <TextInput aria-label='Search blocked queries' placeholder='Search blocked domains...' value={search}
                                flex={1} miw={0}
                                onChange={(event) => setSearch(event.currentTarget.value)} />
                            <MobileFilterToggle opened={filters.opened} onToggle={filters.toggle} controlsId={filters.controlsId}
                                label='Toggle blocked query filters' />
                        </Group>
                        <Badge variant='light' color='red' radius='sm'>
                            {visibleQueries.length} / {blockedQueries.length} blocked
                        </Badge>
                    </Group>
                </Group>
                <MobileFilterPanel opened={filters.opened} id={filters.controlsId}>
                    <Group grow preventGrowOverflow={false} align='flex-end'>
                        <TextInput miw={{ base: '100%', sm: 180 }} label='Filter client' value={client} onChange={(event) => setClient(event.currentTarget.value)} />
                        <Select miw={{ base: '100%', sm: 180 }} label='Blocked query status' value={status} allowDeselect={false} onChange={(value) => setStatus(value ?? 'all')}
                            data={[{ value: 'all', label: 'All statuses' }, ...Array.from(new Set([...blockedQueries.map((q) => q.status), ...(status === 'all' ? [] : [status])])).sort().map((value) => ({ value, label: value }))]} />
                        <Select miw={{ base: '100%', sm: 180 }} label='Query type' value={type} allowDeselect={false} onChange={(value) => setType(value ?? 'all')}
                            data={[{ value: 'all', label: 'All types' }, ...Array.from(new Set([...blockedQueries.map((q) => q.type), ...(type === 'all' ? [] : [type])])).sort().map((value) => ({ value, label: value }))]} />
                        <DatePickerInput miw={{ base: '100%', sm: 180 }} type='range' label='Blocked query date range' value={dateRange} onChange={setDateRange}
                            allowSingleDateInRange clearable placeholder='All fetched dates'
                            clearButtonProps={{ 'aria-label': 'Clear blocked query date range' }}
                            description={incompleteRange ? 'Choose an end date to apply the range.' : undefined} />
                    </Group>
                </MobileFilterPanel>
                {visibleQueries.length === 0 ? (
                    <Center py='xl'>
                        <Text c='dimmed'>
                            {blockedQueries.length ? 'No blocked queries match your filters.' : 'No blocked queries found in the latest fetched queries.'}
                        </Text>
                    </Center>
                ) : (
                    <Table.ScrollContainer minWidth={760}>
                        <ScrollArea h={500}>
                            <Table verticalSpacing='sm' highlightOnHover stickyHeader aria-label='Blocked queries'>
                                <Table.Thead>
                                    <Table.Tr>
                                        {(['time', 'domain', 'client', 'type', 'status'] as const).map((key) => (
                                            <SortableTh key={key} label={key[0].toUpperCase() + key.slice(1)}
                                                active={sort.key === key} direction={sort.direction}
                                                onSort={() => setSort((current) => toggleTableSort(current, key))} />
                                        ))}
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {visibleQueries.map((q) => {
                                        const date = new Date(q.time * 1000);
                                        return (
                                            <Table.Tr key={q.id}>
                                                <Table.Td>
                                                    <Text size='sm'>
                                                        {date.toLocaleString()}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Text size='sm' ff='monospace'>
                                                        {q.domain}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Text size='sm'>
                                                        {q.client.name ||
                                                            q.client.ip}
                                                    </Text>
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
                                            </Table.Tr>
                                        );
                                    })}
                                </Table.Tbody>
                            </Table>
                        </ScrollArea>
                    </Table.ScrollContainer>
                )}
            </Stack>
        </Card>
    );
};

export default BlockedSitesTab;
