import { getPiholeQueries, PiholeQueries, type PiholeQuery } from '@/api/pihole';
import {
    Badge,
    Card,
    Center,
    Group,
    Loader,
    ScrollArea,
    Stack,
    Table,
    Text,
    Title,
} from '@mantine/core';
import { type FC, useEffect, useState } from 'react';

const isBlockedStatus = (status: string): boolean => {
    const blocked = ['GRAVITY', 'DENYLIST', 'REGEX', 'EXACT'];
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
    const [queriesData, setQueriesData] = useState<PiholeQueries>();
    const [loading, setLoading] = useState(true);
    const [blockedQueries, setBlockedQueries] = useState<PiholeQuery[]>([]);

    const fetchQueries = async () => {
        try {
            const data = await getPiholeQueries(200);
            setQueriesData(data);
        } catch (err) {
            console.error('Failed to load queries:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (queriesData?.queries)
            setBlockedQueries(
                queriesData.queries.filter((q) => isBlockedStatus(q.status)),
            );
    }, [queriesData?.queries]);

    useEffect(() => {
        fetchQueries();
        const interval = setInterval(fetchQueries, 15000);
        return () => clearInterval(interval);
    }, []);

    if (loading) {
        return (
            <Center py={60}>
                <Loader />
            </Center>
        );
    }

    return (
        <Stack gap='md'>
            <div>
                <Group justify='space-between'>
                    <Title order={4}>Blocked Sites</Title>
                    <Badge variant='light' color='red' radius='sm'>
                        {blockedQueries.length} blocked
                    </Badge>
                </Group>
                <Text size='sm' c='dimmed'>
                    Recent DNS queries that were blocked by Pi-hole.
                </Text>
            </div>
            {blockedQueries.length === 0 ? (
                <Card withBorder p='xl'>
                    <Center>
                        <Text c='dimmed'>
                            No blocked queries found. This may mean Pi-hole is
                            not blocking anything yet, or there are no recent
                            queries.
                        </Text>
                    </Center>
                </Card>
            ) : (
                <Card withBorder p={0}>
                    <ScrollArea h={500}>
                        <Table highlightOnHover stickyHeader>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>Time</Table.Th>
                                    <Table.Th>Domain</Table.Th>
                                    <Table.Th>Client</Table.Th>
                                    <Table.Th>Type</Table.Th>
                                    <Table.Th>Status</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {blockedQueries.map((q, i) => {
                                    const date = new Date(q.time * 1000);
                                    return (
                                        <Table.Tr key={i}>
                                            <Table.Td>
                                                <Text size='sm'>
                                                    {date.toLocaleTimeString()}
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
                </Card>
            )}
        </Stack>
    );
};

export default BlockedSitesTab;
