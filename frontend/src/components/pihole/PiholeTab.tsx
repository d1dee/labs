import {
    setPiholeBlocking,
    type PiholeBlocking,
    type PiholeSummary,
    type PiholeTopDomains,
} from '@/api/pihole';
import { useApiStream } from '@/api/useApiStream';
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
    const [errors, setErrors] = useState<Record<string, string | null>>({});
    const error = Object.values(errors).filter(Boolean).join('; ') || null;
    const loading = !error && configured !== false && (!summary || !blocking);
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

    useApiStream<{ configured: boolean; url: string | null }>('/api/pihole/status', (status) => {
        setConfigured(status.configured);
        setErrors((current) => ({ ...current, status: null }));
        if (!status.configured) {
            setSummary(null);
            setBlocking(null);
            setErrors({});
        }
    }, (err) => setErrors((current) => ({ ...current, status: err.message })));
    useApiStream<PiholeSummary>(configured ? '/api/pihole/summary' : null, (data) => {
        setSummary(data);
        setErrors((current) => ({ ...current, summary: null }));
    }, (err) => setErrors((current) => ({ ...current, summary: err.message })));
    const refresh = useApiStream<PiholeBlocking>(configured ? '/api/pihole/blocking' : null, (data) => {
        setBlocking(data);
        setErrors((current) => ({ ...current, blocking: null }));
    }, (err) => setErrors((current) => ({ ...current, blocking: err.message })));

    const topPath = !configured || rangeError ? null
        : `/api/pihole/top-domains?blocked=${domainType === 'blocked'}&count=10&${domainPeriod === 'custom' ? `from=${customFrom}&until=${customUntil}` : `windowSeconds=${Number(domainPeriod) * 86400}`}`;
    useEffect(() => {
        setTopDomains(null);
        setTopError(null);
        setTopLoading(Boolean(topPath));
    }, [topPath]);
    useApiStream<PiholeTopDomains>(topPath, (data) => {
        setTopDomains(data);
        setTopError(null);
        setTopLoading(false);
    }, (err) => {
        setTopError(err.message);
        setTopLoading(false);
    });

    const handleToggleBlocking = async () => {
        if (!blocking || togglingBlocking) return;
        const newState = blocking.blocking === 'enabled' ? false : true;
        setTogglingBlocking(true);
        try {
            const result = await setPiholeBlocking(newState);
            setBlocking(result);
            refresh();
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

    if (loading && summary === null) {
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
                    {topError && (
                        <Alert color='red' title='Top Domains Request Failed'>{topError}</Alert>
                    )}
                    {rangeError ? (
                        <Alert color='yellow'>{rangeError}</Alert>
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
