import {
    ActivationHistoryEntry,
    getLabsOverview,
    Lab,
    LabStats,
} from '@/api/firewall';
import LabCard from '@/components/LabCard';
import { useApiStream } from '@/api/useApiStream';
import { PageHero } from '@/components/ui/PageHero';
import { orderLabs, useLabOrder } from '@/lib/lab-order';
import { Alert, Box, Center, Grid, Loader, Stack, Text } from '@mantine/core';
import { useResizeObserver } from '@mantine/hooks';
import { IconInfoCircle, IconShieldCheck } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { type FC, useState } from 'react';

const FirewallTab: FC = () => {
    const [cardsRef, { width: cardsWidth }] = useResizeObserver<HTMLDivElement>();
    const { order, saveOrder } = useLabOrder();
    const [orderError, setOrderError] = useState<string | null>(null);
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
    const sortedLabs = orderLabs(labs, order);
    // Keep each standard card at least 400px wide, with 16px between cards.
    const columns = labs.length >= 3 && cardsWidth >= 1232 ? 3
        : labs.length >= 2 && cardsWidth >= 816 ? 2 : 1;
    const cardLayout = columns === 1 && cardsWidth >= 720 ? 'wide' : 'standard';
    const moveLab = (id: string, targetId: string) => {
        const ids = sortedLabs.map((lab) => lab.id);
        const from = ids.indexOf(id);
        const to = ids.indexOf(targetId);
        if (from < 0 || to < 0 || from === to) return;
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        setOrderError(saveOrder(ids) ? null : 'Unable to save your preferences. Browser storage may be disabled.');
    };

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
                    {orderError && <Alert color='red'>{orderError}</Alert>}
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

                    <Box
                        ref={cardsRef}
                        w='100%'
                    >
                        <Grid gap={16}>
                            {sortedLabs.map((lab) => (
                                <LabCard
                                    key={lab.id}
                                    lab={lab}
                                    stats={labStats[lab.id]}
                                    history={labHistory[lab.id]}
                                    onToggle={refresh}
                                    layout={cardLayout}
                                    columns={columns}
                                    onMove={labs.length > 1 ? (targetId) => moveLab(lab.id, targetId) : undefined}
                                />
                            ))}
                        </Grid>
                    </Box>
                </>
            )}
        </Stack>
    );
};

export default FirewallTab;
