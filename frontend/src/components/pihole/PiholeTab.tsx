import {
    getPiholeBlocking,
    getPiholeStatus,
    getPiholeSummary,
    getPiholeTopDomains,
    setPiholeBlocking,
    type PiholeBlocking,
    type PiholeSummary,
    type PiholeTopDomains,
} from '@/api/pihole';
import {
    MobileFilterPanel,
    MobileFilterToggle,
    useMobileTableFilters,
} from '@/components/ui/MobileTableFilters';
import { PageHero } from '@/components/ui/PageHero';
import {
    compareTableValues,
    SortableTh,
    toggleTableSort,
    type SortState,
} from '@/components/ui/tableUtils';
import {
    Alert,
    Badge,
    Button,
    Card,
    Center,
    Divider,
    Group,
    Loader,
    ScrollArea,
    Select,
    Stack,
    Table,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import {
    IconAlertCircle,
    IconCheck,
    IconNetwork,
    IconPlayerPause,
    IconPlayerPlay,
    IconX,
} from '@tabler/icons-react';
import { useEffect, useState, type FC } from 'react';
import BlockedSitesTab from './BlockedSitesTab';
import DomainBlockTab from './DomainBlockTab';

const PiholeTab: FC = () => {
    const filters = useMobileTableFilters();
    const [configured, setConfigured] = useState<boolean | null>(null);
    const [summary, setSummary] = useState<PiholeSummary | null>(null);
    const [topDomains, setTopDomains] = useState<PiholeTopDomains | null>(null);
    const [blocking, setBlocking] = useState<PiholeBlocking | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [togglingBlocking, setTogglingBlocking] = useState(false);
    const [domainType, setDomainType] = useState('blocked');
    const [domainPeriod, setDomainPeriod] = useState('1');
    const [[startDate, endDate], setDateRange] = useState<
        [string | null, string | null]
    >([null, null]);
    const [domainSearch, setDomainSearch] = useState('');
    const [domainSort, setDomainSort] = useState<SortState<'domain' | 'count'>>(
        { key: 'count', direction: 'desc' },
    );
    const [topLoading, setTopLoading] = useState(true);
    const [topError, setTopError] = useState<string | null>(null);
    const [topRetry, setTopRetry] = useState(0);
    const customFrom = new Date(`${startDate}T00:00:00`).getTime() / 1000;
    const customUntil = Math.floor(
        new Date(`${endDate}T23:59:59`).getTime() / 1000,
    );
    const rangeError =
        domainPeriod !== 'custom'
            ? null
            : !startDate || !endDate
              ? 'Choose both a start and end date.'
              : !Number.isFinite(customFrom) || !Number.isFinite(customUntil)
                ? 'Choose valid dates.'
                : customFrom > customUntil
                  ? 'Start date must be on or before end date.'
                  : null;

    const fetchData = async () => {
        try {
            setLoading(true);
            const status = await getPiholeStatus();
            setConfigured(status.configured);

            if (status.configured) {
                const [sum, block] = await Promise.all([
                    getPiholeSummary(),
                    getPiholeBlocking(),
                ]);
                setSummary(sum);
                setBlocking(block);
            } else {
                setSummary(null);
                setBlocking(null);
            }
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        let active = true;
        let inFlight = false;
        setTopDomains(null);
        setTopError(null);
        setTopLoading(false);
        if (!configured || rangeError) return;

        const fetchTopDomains = async () => {
            if (!active || inFlight) return;
            inFlight = true;
            setTopLoading(true);
            const until = Math.floor(Date.now() / 1000);
            const range =
                domainPeriod === 'custom'
                    ? { from: customFrom, until: customUntil }
                    : { from: until - Number(domainPeriod) * 86400, until };
            try {
                const result = await getPiholeTopDomains(
                    domainType === 'blocked',
                    10,
                    range,
                );
                if (!active) return;
                setTopDomains(result);
                setTopError(null);
            } catch (err) {
                if (!active) return;
                setTopDomains(null);
                setTopError(err instanceof Error ? err.message : String(err));
            } finally {
                inFlight = false;
                if (active) setTopLoading(false);
            }
        };
        void fetchTopDomains();
        const interval = setInterval(fetchTopDomains, 30000);
        return () => {
            active = false;
            clearInterval(interval);
        };
    }, [
        configured,
        domainType,
        domainPeriod,
        customFrom,
        customUntil,
        rangeError,
        topRetry,
    ]);

    const handleToggleBlocking = async () => {
        if (!blocking || togglingBlocking) return;
        const newState = blocking.blocking === 'enabled' ? false : true;
        setTogglingBlocking(true);
        try {
            const result = await setPiholeBlocking(newState);
            setBlocking(result);
            if (result.blocking !== (newState ? 'enabled' : 'disabled')) {
                throw new Error(
                    `Pi-hole did not ${newState ? 'enable' : 'disable'} blocking (status: ${result.blocking}).`,
                );
            }
            notifications.show({
                color: 'green',
                title: 'Success',
                message: `Pi-hole blocking ${result.blocking}`,
                icon: <IconCheck size={16} />,
            });
        } catch (err) {
            notifications.show({
                color: 'red',
                title: 'Error',
                message: err instanceof Error ? err.message : String(err),
                icon: <IconX size={16} />,
            });
        } finally {
            setTogglingBlocking(false);
        }
    };

    if (loading && configured !== false && summary === null && !error) {
        return (
            <Center py={60}>
                <Stack align='center' gap='md'>
                    <Loader />
                    <Text>Loading Pi-hole stats...</Text>
                </Stack>
            </Center>
        );
    }

    const errorAlert = error ? (
        <Alert
            icon={<IconX size={18} />}
            title='Pi-hole Request Failed'
            color='red'
        >
            <Stack gap='sm'>
                <Text size='sm'>{error}</Text>
                {summary && (
                    <Text size='sm'>
                        Showing the last successfully loaded data.
                    </Text>
                )}
                <Button
                    variant='light'
                    color='red'
                    loading={loading}
                    onClick={fetchData}
                >
                    Retry
                </Button>
            </Stack>
        </Alert>
    ) : null;

    if (error && summary === null) {
        return errorAlert;
    }

    if (configured === false) {
        return (
            <Alert
                icon={<IconAlertCircle size={18} />}
                title='Pi-hole Not Configured'
                color='yellow'
                mt='md'
            >
                Pi-hole is not configured. Please set <code>PIHOLE_URL</code>{' '}
                and <code>PIHOLE_PASSWORD</code> in your server environment
                variables.
            </Alert>
        );
    }

    const isBlockingEnabled = blocking?.blocking === 'enabled';
    const canToggleBlocking =
        blocking?.blocking === 'enabled' || blocking?.blocking === 'disabled';
    const statusColor = isBlockingEnabled
        ? 'green'
        : canToggleBlocking
          ? 'red'
          : 'gray';
    const visibleDomains = (topDomains?.domains ?? [])
        .filter((item) =>
            item.domain
                .toLowerCase()
                .includes(domainSearch.trim().toLowerCase()),
        )
        .sort((a, b) =>
            compareTableValues(
                a[domainSort.key],
                b[domainSort.key],
                domainSort.direction,
            ),
        );

    return (
        <Stack gap='md'>
            {errorAlert}
            <PageHero
                eyebrow='DNS filtering'
                title='Pi-hole network block'
                description='Monitor DNS queries and manage blocking for your network.'
                icon={<IconNetwork size={25} />}
                actions={
                    <>
                        <Badge
                            leftSection={
                                isBlockingEnabled ? (
                                    <IconCheck size={14} />
                                ) : (
                                    <IconX size={14} />
                                )
                            }
                            color={statusColor}
                            variant='filled'
                            size='lg'
                        >
                            Blocking {blocking?.blocking ?? 'unknown'}
                        </Badge>
                        <Button
                            variant='light'
                            color={isBlockingEnabled ? 'red' : 'teal'}
                            loading={togglingBlocking}
                            disabled={!canToggleBlocking || loading}
                            leftSection={
                                isBlockingEnabled ? (
                                    <IconPlayerPause size={16} />
                                ) : (
                                    <IconPlayerPlay size={16} />
                                )
                            }
                            onClick={handleToggleBlocking}
                        >
                            {isBlockingEnabled ? 'Pause' : 'Resume'}
                        </Button>
                    </>
                }
                metrics={[
                    {
                        label: 'Unique domains',
                        value:
                            summary?.queries?.unique_domains?.toLocaleString() ||
                            0,
                    },
                    {
                        label: 'DNS queries',
                        value: summary?.queries?.total?.toLocaleString() || 0,
                    },
                    {
                        label: 'Queries blocked',
                        value: summary?.queries?.blocked?.toLocaleString() || 0,
                        accent: true,
                    },
                    {
                        label: 'Active clients',
                        value: summary?.clients?.active?.toLocaleString() || 0,
                    },
                ]}
            />
            <Divider variant='dotted' />
            <DomainBlockTab />
            <Divider variant='dotted' />
            <Card withBorder radius='lg' p='md'>
                <Stack gap='md'>
                    <Group justify='space-between' align='flex-end'>
                        <Stack gap={0} flex={1} miw={{ base: '100%', sm: 0 }}>
                            <Title order={4}>Top Domains</Title>
                            <Text size='sm' c='dimmed'>
                                Filters apply only to Top Domains, not the
                                summary metrics. Search and sorting apply to the
                                returned top 10 domains. History is limited by
                                Pi-hole retention.
                            </Text>
                        </Stack>
                        <Group
                            wrap='nowrap'
                            gap='xs'
                            w={{ base: '100%', sm: 300 }}
                            style={{ flexShrink: 0 }}
                        >
                            <TextInput
                                aria-label='Search top domains'
                                placeholder='Search top domains...'
                                value={domainSearch}
                                flex={1}
                                miw={0}
                                onChange={(event) =>
                                    setDomainSearch(event.currentTarget.value)
                                }
                            />
                            <MobileFilterToggle
                                opened={filters.opened}
                                onToggle={filters.toggle}
                                controlsId={filters.controlsId}
                                label='Toggle top domain filters'
                            />
                        </Group>
                    </Group>
                    <MobileFilterPanel
                        opened={filters.opened}
                        id={filters.controlsId}
                    >
                        <Group
                            grow
                            preventGrowOverflow={false}
                            align='flex-end'
                        >
                            <Select
                                miw={{ base: '100%', sm: 180 }}
                                label='Query status'
                                value={domainType}
                                onChange={(value) =>
                                    setDomainType(value ?? 'blocked')
                                }
                                allowDeselect={false}
                                data={[
                                    { value: 'blocked', label: 'Blocked' },
                                    { value: 'allowed', label: 'Allowed' },
                                ]}
                            />
                            <Select
                                miw={{ base: '100%', sm: 180 }}
                                label='Date range'
                                value={domainPeriod}
                                onChange={(value) =>
                                    setDomainPeriod(value ?? '1')
                                }
                                allowDeselect={false}
                                data={[
                                    { value: '1', label: 'Last 24 hours' },
                                    { value: '7', label: 'Last 7 days' },
                                    { value: '30', label: 'Last 30 days' },
                                    { value: 'custom', label: 'Custom range' },
                                ]}
                            />
                            {domainPeriod === 'custom' && (
                                <DatePickerInput
                                    miw={{ base: '100%', sm: 180 }}
                                    type='range'
                                    label='Custom date range'
                                    value={[startDate, endDate]}
                                    onChange={setDateRange}
                                    allowSingleDateInRange
                                    clearable
                                    clearButtonProps={{
                                        'aria-label': 'Clear custom date range',
                                    }}
                                    placeholder='Choose start and end dates'
                                />
                            )}
                        </Group>
                    </MobileFilterPanel>
                    {rangeError ? (
                        <Alert color='yellow'>{rangeError}</Alert>
                    ) : topError ? (
                        <Alert color='red' title='Top Domains Request Failed'>
                            <Stack gap='sm'>
                                <Text size='sm'>{topError}</Text>
                                <Button
                                    variant='light'
                                    color='red'
                                    onClick={() =>
                                        setTopRetry((value) => value + 1)
                                    }
                                >
                                    Retry Top Domains
                                </Button>
                            </Stack>
                        </Alert>
                    ) : topLoading && topDomains === null ? (
                        <Group role='status'>
                            <Loader size='sm' />
                            <Text>Loading Top Domains...</Text>
                        </Group>
                    ) : !visibleDomains.length ? (
                        <Text c='dimmed'>
                            {domainSearch.trim()
                                ? 'No top domains match your search.'
                                : `No ${domainType} domains found for this date range.`}
                        </Text>
                    ) : (
                        <Table.ScrollContainer minWidth={400}>
                            <ScrollArea mah={500}>
                                <Table
                                    verticalSpacing='sm'
                                    highlightOnHover
                                    stickyHeader
                                    aria-label='Top domains'
                                >
                                    <Table.Thead>
                                        <Table.Tr>
                                            {(['domain', 'count'] as const).map(
                                                (key) => (
                                                    <SortableTh
                                                        key={key}
                                                        label={
                                                            key === 'domain'
                                                                ? 'Domain'
                                                                : 'Hits'
                                                        }
                                                        active={
                                                            domainSort.key ===
                                                            key
                                                        }
                                                        direction={
                                                            domainSort.direction
                                                        }
                                                        onSort={() =>
                                                            setDomainSort(
                                                                (current) =>
                                                                    toggleTableSort(
                                                                        current,
                                                                        key,
                                                                    ),
                                                            )
                                                        }
                                                    />
                                                ),
                                            )}
                                        </Table.Tr>
                                    </Table.Thead>
                                    <Table.Tbody>
                                        {visibleDomains.map((item) => (
                                            <Table.Tr key={item.domain}>
                                                <Table.Td>
                                                    <Text
                                                        size='sm'
                                                        ff='monospace'
                                                    >
                                                        {item.domain}
                                                    </Text>
                                                </Table.Td>
                                                <Table.Td>
                                                    <Badge
                                                        color={
                                                            domainType ===
                                                            'blocked'
                                                                ? 'red'
                                                                : 'green'
                                                        }
                                                    >
                                                        {item.count} hits
                                                    </Badge>
                                                </Table.Td>
                                            </Table.Tr>
                                        ))}
                                    </Table.Tbody>
                                </Table>
                            </ScrollArea>
                        </Table.ScrollContainer>
                    )}
                </Stack>
            </Card>
            <Divider variant='dotted' />
            <BlockedSitesTab />
        </Stack>
    );
};

export default PiholeTab;
