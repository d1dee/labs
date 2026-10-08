import {
    ActivationHistoryEntry,
    getLabsOverview,
    Lab,
    LabStats,
} from '@/api/firewall';
import LabCard from '@/components/LabCard';
import { useApiStream } from '@/api/useApiStream';
import { PageHero } from '@/components/ui/PageHero';
import { Alert, Center, Grid, Loader, Stack, Text } from '@mantine/core';
import { IconInfoCircle, IconShieldCheck } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { type FC, useState } from 'react';

const FirewallTab: FC = () => {
    const [labs, setLabs] = useState<Lab[]>([]);
    const [labStats, setLabStats] = useState<Record<string, LabStats>>({});
    const [labHistory, setLabHistory] = useState<
        Record<string, ActivationHistoryEntry[]>
    >({});
    const [loading, setLoading] = useState<boolean>(true);
    const [configMissing, setConfigMissing] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [lastRefresh, setLastRefresh] = useState<string>('');

    const refresh = useApiStream<Awaited<ReturnType<typeof getLabsOverview>>>('/api/labs/overview', (data) => {
        setLabs(data.labs);
        setLabStats(data.stats);
        setLabHistory(data.history);
        setConfigMissing(false);
        setError(null);
        setLastRefresh(dayjs().format('HH:mm:ss'));
        setLoading(false);
    }, (err) => {
        setConfigMissing(err.code === 'CONFIG_MISSING');
        setError(err.message);
        setLoading(false);
    });

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
            ) : configMissing && labs.length === 0 ? (
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
                    {error && <Alert color='red'>{error}</Alert>}
                    <PageHero
                        eyebrow='Network security'
                        title='Firewall & lab access'
                        description='Toggle per-lab internet access and watch live device counts across your MikroTik router.'
                        icon={<IconShieldCheck size={25} />}
                        metrics={[
                            { label: 'Total labs', value: labs.length },
                            { label: 'Active', value: activeLabs, accent: true },
                            { label: 'Blocked', value: blockedLabs, color: 'red.4' },
                            { label: 'Last refresh', value: lastRefresh || '-' },
                        ]}
                    />

                    <Grid grow>
                        {labs
                            .slice()
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((lab) => (
                                <LabCard
                                    key={lab.id}
                                    lab={lab}
                                    stats={labStats[lab.id]}
                                    history={labHistory[lab.id]}
                                    onToggle={refresh}
                                />
                            ))}
                    </Grid>
                </>
            )}
        </Stack>
    );
};

export default FirewallTab;
