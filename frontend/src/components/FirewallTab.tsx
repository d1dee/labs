import {
    ActivationHistoryEntry,
    getLabsOverview,
    Lab,
    LabStats,
} from '@/api/firewall';
import LabCard from '@/components/LabCard';
import { PageHero } from '@/components/ui/PageHero';
import { ActionIcon, Alert, Center, Grid, Loader, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconInfoCircle, IconRefresh, IconShieldCheck } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { type FC, useEffect, useState } from 'react';

const FirewallTab: FC = () => {
    const [labs, setLabs] = useState<Lab[]>([]);
    const [labStats, setLabStats] = useState<Record<string, LabStats>>({});
    const [labHistory, setLabHistory] = useState<
        Record<string, ActivationHistoryEntry[]>
    >({});
    const [loading, setLoading] = useState<boolean>(true);
    const [configMissing, setConfigMissing] = useState<boolean>(false);

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
            const data = await getLabsOverview();
            setLabs(data.labs);
            setLabStats(data.stats);
            setLabHistory(data.history);
            setConfigMissing(false);
        } catch (err: any) {
            if (err.code === 'CONFIG_MISSING') {
                setConfigMissing(true);
                return;
            }
            notifications.show({
                color: 'error',
                message:
                    'Failed to fetch lab data. Please check your connection.',
            });
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleToggle = (): void => {
        // A single lab toggled — refetch the consolidated overview so both the
        // changed stats and history refresh in one request.
        fetchLabs().catch((err: any) => {
            if (err.code === 'CONFIG_MISSING') {
                setConfigMissing(true);
            }
            console.error('Failed to refresh labs:', err);
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
            ) : configMissing ? (
                <Center py={60}>
                    <Stack align='center' gap='md' maw={500}>
                        <Alert
                            variant='light'
                            color='yellow'
                            title='Configuration Required'
                            icon={<IconInfoCircle size={24} />}
                        >
                            <Text size='sm' mb='md'>
                                No firewall configuration found. Please
                                configure your MikroTik settings and labs in
                                Settings.
                            </Text>
                        </Alert>
                    </Stack>
                </Center>
            ) : (
                <>
                    <PageHero
                        eyebrow='Network security'
                        title='Firewall & lab access'
                        description='Toggle per-lab internet access and watch live device counts across your MikroTik router.'
                        icon={<IconShieldCheck size={25} />}
                        actions={
                            <ActionIcon
                                variant='light'
                                color='gray'
                                size='lg'
                                aria-label='Refresh labs'
                                onClick={() => void fetchLabs()}
                            >
                                <IconRefresh size={18} />
                            </ActionIcon>
                        }
                        metrics={[
                            { label: 'Total labs', value: labs.length },
                            { label: 'Active', value: activeLabs, accent: true },
                            { label: 'Blocked', value: blockedLabs, color: 'red.4' },
                            { label: 'Last refresh', value: dayjs().format('HH:mm:ss') },
                        ]}
                    />

                    <Grid grow>
                        {labs
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((lab) => (
                                <LabCard
                                    key={lab.id}
                                    lab={lab}
                                    stats={labStats[lab.id]}
                                    history={labHistory[lab.id]}
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
