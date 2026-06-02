import {
    getPiholeBlocking,
    getPiholeStatus,
    getPiholeSummary,
    getPiholeTopDomains,
    setPiholeBlocking,
    type PiholeBlocking,
    type PiholeSummary,
    type PiholeTopDomains,
} from '@/api';
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
    SimpleGrid,
    Stack,
    Table,
    Text,
    Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
    IconAlertCircle,
    IconCheck,
    IconPlayerPause,
    IconPlayerPlay,
    IconX,
} from '@tabler/icons-react';
import { useEffect, useState, type FC } from 'react';
import BlockedSitesTab from './BlockedSitesTab';
import DomainBlockTab from './DomainBlockTab';

const StatsCard: FC<{
    title: string;
    value: string | number;
    color?: string;
}> = ({ title, value, color }) => (
    <Card withBorder p='md'>
        <Text size='sm' c='dimmed'>
            {title}
        </Text>
        <Text size='xl' fw={700} c={color}>
            {value}
        </Text>
    </Card>
);

const PiholeTab: FC = () => {
    const [configured, setConfigured] = useState<boolean | null>(null);
    const [summary, setSummary] = useState<PiholeSummary | null>(null);
    const [topDomains, setTopDomains] = useState<PiholeTopDomains | null>(null);
    const [blocking, setBlocking] = useState<PiholeBlocking | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [togglingBlocking, setTogglingBlocking] = useState(false);

    const fetchData = async () => {
        try {
            setLoading(true);
            setError(null);
            const status = await getPiholeStatus();
            setConfigured(status.configured);

            if (status.configured) {
                const [sum, top, block] = await Promise.all([
                    getPiholeSummary(),
                    getPiholeTopDomains(true, 10),
                    getPiholeBlocking(),
                ]);
                setSummary(sum);
                setTopDomains(top);
                setBlocking(block);
            }
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, []);

    const handleToggleBlocking = async () => {
        if (!blocking) return;
        const newState = blocking.blocking === 'enabled' ? false : true;
        setTogglingBlocking(true);
        try {
            const result = await setPiholeBlocking(newState);
            setBlocking(result);
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
                message: String(err),
                icon: <IconX size={16} />,
            });
        } finally {
            setTogglingBlocking(false);
        }
    };

    if (loading && configured === null) {
        return (
            <Center py={60}>
                <Stack align='center' gap='md'>
                    <Loader />
                    <Text>Loading Pi-hole stats...</Text>
                </Stack>
            </Center>
        );
    }

    if (!configured) {
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

    if (error) {
        return (
            <Alert icon={<IconX size={18} />} title='Error' color='red' mt='md'>
                {error}
            </Alert>
        );
    }

    const isBlockingEnabled = blocking?.blocking === 'enabled';
    const statusColor = isBlockingEnabled ? 'green' : 'red';

    return (
        <Stack gap='md'>
            <Group justify='space-between'>
                <Title order={4}>Pi-hole Statistics</Title>
                <Group gap='sm'>
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
                    >
                        Blocking {blocking?.blocking}
                    </Badge>
                    <Button
                        size='xs'
                        variant='light'
                        color={isBlockingEnabled ? 'red' : 'green'}
                        loading={togglingBlocking}
                        leftSection={
                            isBlockingEnabled ? (
                                <IconPlayerPause size={14} />
                            ) : (
                                <IconPlayerPlay size={14} />
                            )
                        }
                        onClick={handleToggleBlocking}
                    >
                        {isBlockingEnabled ? 'Pause' : 'Resume'}
                    </Button>
                </Group>
            </Group>

            <SimpleGrid cols={{ base: 2, md: 4 }} spacing='md'>
                <StatsCard
                    title='Domains Blocked'
                    value={
                        summary?.gravity?.domains_being_blocked?.toLocaleString() ||
                        0
                    }
                />
                <StatsCard
                    title='DNS Queries'
                    value={summary?.queries?.total?.toLocaleString() || 0}
                />
                <StatsCard
                    title='Queries Blocked'
                    value={summary?.queries?.blocked?.toLocaleString() || 0}
                    color='green'
                />
                <StatsCard
                    title='Block %'
                    value={`${summary?.queries?.percent_blocked?.toFixed(1) || 0}%`}
                    color='green'
                />
                <StatsCard
                    title='Unique Domains'
                    value={
                        summary?.queries?.unique_domains?.toLocaleString() || 0
                    }
                />
                <StatsCard
                    title='Forwarded'
                    value={summary?.queries?.forwarded?.toLocaleString() || 0}
                />
                <StatsCard
                    title='Cached'
                    value={summary?.queries?.cached?.toLocaleString() || 0}
                />
                <StatsCard
                    title='Active Clients'
                    value={summary?.clients?.active?.toLocaleString() || 0}
                />
            </SimpleGrid>
            <Divider variant='dotted' />
            <DomainBlockTab />
            <Divider variant='dotted' />
            {topDomains?.domains && topDomains.domains.length > 0 && (
                <Stack>
                    <div>
                        <Title order={5}>Top Blocked Domains</Title>
                        <Text size='sm' c='dimmed'>
                            List of the most blocked domains.
                        </Text>
                    </div>
                    <Card withBorder p={0}>
                        <ScrollArea mah={500}>
                            <Table highlightOnHover stickyHeader>
                                <Table.Thead>
                                    <Table.Tr>
                                        <Table.Th>Domain</Table.Th>
                                        <Table.Th>Hits</Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {topDomains.domains.map((item) => (
                                        <Table.Tr key={item.domain}>
                                            <Table.Td>
                                                <Text size='sm' ff='monospace'>
                                                    {item.domain}
                                                </Text>
                                            </Table.Td>
                                            <Table.Td>
                                                <Badge color='red'>
                                                    {item.count} hits
                                                </Badge>
                                            </Table.Td>
                                        </Table.Tr>
                                    ))}
                                </Table.Tbody>
                            </Table>
                        </ScrollArea>
                    </Card>
                </Stack>
            )}
            <Divider variant='dotted' />
            <BlockedSitesTab />
        </Stack>
    );
};

export default PiholeTab;
