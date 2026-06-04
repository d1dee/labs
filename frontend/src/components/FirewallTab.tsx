import { getLabs, getLabStats, Lab, LabStats } from '@/api/firewall';
import LabCard from '@/components/LabCard';
import {
    Card,
    Center,
    Grid,
    Group,
    Loader,
    SimpleGrid,
    Stack,
    Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import dayjs from 'dayjs';
import { type FC, useEffect, useState } from 'react';

const FirewallTab: FC = () => {
    const [labs, setLabs] = useState<Lab[]>([]);
    const [labStats, setLabStats] = useState<Record<string, LabStats>>({});
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        fetchLabs();
        const interval = setInterval(
            fetchLabs,
            Number(import.meta.env.VITE_REFRESH_INTERVAL) || 15000,
        );
        return () => clearInterval(interval);
    }, []);

    const fetchLabs = async (): Promise<void> => {
        try {
            const data = await getLabs();
            setLabs(data.labs);

            const stats: Record<string, LabStats> = {};
            for (const lab of data.labs) {
                const labStatsData = await getLabStats(lab.id);
                stats[lab.id] = labStatsData;
            }
            setLabStats(stats);
            setLoading(false);
        } catch (err) {
            notifications.show({
                color: 'error',
                message:
                    'Failed to fetch lab data. Please check your connection.',
            });
            console.error(err);
            setLoading(false);
        }
    };

    const handleToggle = (labId: string): void => {
        getLabStats(labId)
            .then((stats: LabStats) => {
                setLabStats((prev) => ({
                    ...prev,
                    [labId]: stats,
                }));
            })
            .catch((err: unknown) => {
                console.error('Failed to refresh stats:', err);
            });
    };

    const activeLabs = labs.filter(
        (lab) => !labStats[lab.id]?.firewall.disabled,
    ).length;
    const blockedLabs = labs.filter(
        (lab) => labStats[lab.id]?.firewall.disabled,
    ).length;

    return (
        <Stack gap='md'>
            {loading ? (
                <Center py={60}>
                    <Stack align='center' gap='md'>
                        <Loader />
                        <Text>Loading lab data...</Text>
                    </Stack>
                </Center>
            ) : (
                <>
                    <SimpleGrid cols={{ base: 2, md: 4 }} spacing='md'>
                        <Card withBorder>
                            <Text size='sm' c='dimmed'>
                                Total Labs
                            </Text>
                            <Text size='xl' fw={700}>
                                {labs.length}
                            </Text>
                        </Card>
                        <Card withBorder>
                            <Text size='sm' c='dimmed'>
                                Active Labs
                            </Text>
                            <Group justify='space-between'>
                                <Text size='xl' fw={700} c='green'>
                                    {activeLabs}
                                </Text>
                            </Group>
                        </Card>
                        <Card withBorder>
                            <Text size='sm' c='dimmed'>
                                Blocked Labs
                            </Text>
                            <Group justify='space-between'>
                                <Text size='xl' fw={700} c='red'>
                                    {blockedLabs}
                                </Text>
                            </Group>
                        </Card>
                        <Card withBorder>
                            <Text size='sm' c='dimmed'>
                                Last Refresh
                            </Text>
                            <Text size='xl' fw={700}>
                                {dayjs().format('HH:mm:ss')}
                            </Text>
                        </Card>
                    </SimpleGrid>

                    <Grid>
                        {labs.map((lab) => (
                            <LabCard
                                key={lab.id}
                                lab={lab}
                                stats={labStats[lab.id]}
                                onToggle={handleToggle}
                            />
                        ))}
                    </Grid>
                </>
            )}
        </Stack>
    );
};

export default FirewallTab;
