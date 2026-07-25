import {
    ActivationHistoryEntry,
    Lab,
    LabStats,
    toggleLab,
} from '@/api/firewall';
import {
    Badge,
    Button,
    Card,
    Center,
    Grid,
    Group,
    Stack,
    Text,
    useMantineTheme,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
    IconCheck,
    IconNetwork,
    IconNetworkOff,
    IconX,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import { FC, useEffect, useMemo, useState } from 'react';
import {
    Area,
    AreaChart,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    ResponsiveContainer,
    XAxis,
    YAxis,
} from 'recharts';

interface LabCardProps {
    lab: Lab;
    stats: LabStats;
    history: ActivationHistoryEntry[];
    onToggle: (labId: string) => void;
}

const LabCard: FC<LabCardProps> = ({ lab, stats, history, onToggle }) => {
    const [toggling, setToggling] = useState<boolean>(false);
    const [now, setNow] = useState(Date.now());
    const theme = useMantineTheme();

    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    const handleToggle = async (): Promise<void> => {
        setToggling(true);

        try {
            const willEnable = stats.firewall?.disabled;
            await toggleLab(lab.id, willEnable);
            onToggle(lab.id);
            notifications.show({
                title: 'Success',
                message: `Lab ${lab.name} ${willEnable ? 'enabled' : 'disabled'} successfully`,
                color: 'green',
                icon: <IconCheck size={16} />,
                autoClose: 3000,
            });
        } catch (err) {
            console.error(err);
            notifications.show({
                title: 'Error',
                message: `Failed to toggle lab ${lab.name}`,
                color: 'red',
                icon: <IconX size={16} />,
                autoClose: 5000,
            });
        } finally {
            setToggling(false);
        }
    };

    const isDisabled = stats.firewall?.disabled;
    const statusIcon = isDisabled ? (
        <IconNetworkOff size={18} />
    ) : (
        <IconNetwork size={18} />
    );
    const statusColor = isDisabled ? 'red' : 'green';
    const statusLabel = isDisabled ? 'Blocked' : 'Active';

    const chartData = useMemo(() => {
        const base = history
            .map((entry) => {
                const timestamp = dayjs(entry.createdAt);
                return {
                    time: timestamp.valueOf(),
                    timeLabel: timestamp.format('HH:mm'),
                    dateTime: timestamp.format('DD MMM YYYY, HH:mm'),
                    active: entry.enabled ? 1 : 0,
                    blocked: entry.enabled ? 0 : 1,
                    state: entry.enabled ? 'Active' : 'Blocked',
                    isLive: false,
                };
            })
            .sort((a, b) => a.time - b.time);

        if (base.length > 0) {
            const liveTime = dayjs(now);
            base.push({
                time: now,
                timeLabel: liveTime.format('HH:mm'),
                dateTime: liveTime.format('DD MMM YYYY, HH:mm'),
                active: isDisabled ? 0 : 1,
                blocked: isDisabled ? 1 : 0,
                state: isDisabled ? 'Blocked' : 'Active',
                isLive: true,
            });
        }

        return base;
    }, [history, now, isDisabled]);

    return (
        <Grid.Col span={{ base: 12, sm: 6, md: 4 }} h='100%'>
            <Card shadow='md' padding='lg' radius='md' withBorder>
                <Card.Section p='md' pb={0}>
                    <Group justify='space-between' mb='md'>
                        <Text fw={600} size='lg'>
                            {lab.name}
                        </Text>
                        <Badge
                            leftSection={statusIcon}
                            color={statusColor}
                            radius='md'
                            size='md'
                            variant='filled'
                        >
                            {statusLabel}
                        </Badge>
                    </Group>
                </Card.Section>

                <Stack gap='sm' py='md'>
                    <div>
                        <Text size='sm' c='dimmed'>
                            Subnet
                        </Text>
                        <Text fw={500} size='sm' ff='monospace'>
                            {lab.subnet}
                        </Text>
                    </div>

                    <div>
                        <Text size='sm' c='dimmed'>
                            Firewall Rule
                        </Text>
                        <Text fw={500} size='sm' ff='monospace'>
                            {stats.firewall.ruleId}
                        </Text>
                    </div>

                    <div>
                        <Text size='sm' c='dimmed'>
                            Connected Devices
                        </Text>
                        <Text fw={500} size='sm' ff='monospace'>
                            {stats.devices.connected}
                        </Text>
                    </div>

                    <div>
                        <Text size='sm' c='dimmed'>
                            DHCP Server
                        </Text>
                        <Text fw={500} size='sm' ff='monospace'>
                            {stats.devices.dhcpServer}
                        </Text>
                    </div>

                    <div>
                        <Text size='sm' c='dimmed'>
                            Firewall Usage
                        </Text>
                        <Text fw={500} size='sm' ff='monospace'>
                            {stats.firewall.usageMB.toFixed(2)} MB
                        </Text>
                    </div>

                    <div>
                        <Text size='sm' c='dimmed'>
                            Last Updated
                        </Text>
                        <Text fw={500} size='sm' ff='monospace'>
                            {dayjs(stats.timestamp).format('HH:mm:ss')}
                        </Text>
                    </div>

                    <div>
                        <Text size='sm' c='dimmed' mb='xs'>
                            Activation Periods
                        </Text>
                        {chartData.length === 0 ? (
                            <Center h={120}>
                                <Text size='xs' c='dimmed'>
                                    No activation history
                                </Text>
                            </Center>
                        ) : (
                            <ResponsiveContainer width='100%' height={120}>
                                <AreaChart data={chartData}>
                                    <CartesianGrid
                                        strokeDasharray='3 3'
                                        vertical={true}
                                        horizontal={false}
                                    />
                                    <XAxis
                                        dataKey='time'
                                        type='number'
                                        domain={['dataMin', 'dataMax']}
                                        hide
                                    />
                                    <YAxis domain={[0, 1]} hide />
                                    <RechartsTooltip
                                        animationDuration={200}
                                        content={({ payload }: any) => {
                                            if (!payload?.[0]) return null;
                                            const data = payload[0].payload;
                                            if (data.isLive) {
                                                const liveColor =
                                                    data.active === 1
                                                        ? theme.colors.green[6]
                                                        : theme.colors.red[6];
                                                return (
                                                    <Stack
                                                        gap={2}
                                                        style={{
                                                            whiteSpace:
                                                                'nowrap',
                                                        }}
                                                    >
                                                        <Text size='xs'>
                                                            <Text
                                                                span
                                                                c={liveColor}
                                                                fw={600}
                                                            >
                                                                Current:{' '}
                                                                {data.state}
                                                            </Text>
                                                        </Text>
                                                        <Text
                                                            size='xs'
                                                            c='dimmed'
                                                        >
                                                            {data.timeLabel}{' '}
                                                            (live)
                                                        </Text>
                                                    </Stack>
                                                );
                                            }
                                            const currentState =
                                                data.active === 1
                                                    ? 'Activated'
                                                    : 'Deactivated';
                                            const currentColor =
                                                data.active === 1
                                                    ? theme.colors.green[6]
                                                    : theme.colors.red[6];
                                            return (
                                                <Stack
                                                    gap={2}
                                                    style={{
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    <Text size='xs'>
                                                        <Text
                                                            span
                                                            c={currentColor}
                                                            fw={600}
                                                        >
                                                            {currentState}
                                                        </Text>
                                                        {' at '}
                                                        {data.timeLabel}
                                                    </Text>
                                                </Stack>
                                            );
                                        }}
                                    />
                                    <Area
                                        type='stepAfter'
                                        dataKey='active'
                                        stroke='none'
                                        fill={theme.colors.green[6]}
                                        fillOpacity={0.3}
                                        strokeWidth={2}
                                        dot={false}
                                        activeDot={false}
                                    />
                                    <Area
                                        type='stepBefore'
                                        dataKey='blocked'
                                        stroke='none'
                                        fill={theme.colors.red[6]}
                                        fillOpacity={0.3}
                                        strokeWidth={2}
                                        dot={false}
                                        activeDot={false}
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </Stack>

                <Button
                    fullWidth
                    onClick={handleToggle}
                    loading={toggling}
                    color={isDisabled ? 'green' : 'red'}
                    variant='light'
                >
                    {toggling
                        ? 'Updating...'
                        : isDisabled
                          ? 'Enable Access'
                          : 'Disable Access'}
                </Button>
            </Card>
        </Grid.Col>
    );
};

export default LabCard;
