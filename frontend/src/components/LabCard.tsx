import {
    ActivationHistoryEntry,
    Lab,
    LabStats,
    toggleLab,
} from '@/api/firewall';
import {
    Badge,
    Box,
    Button,
    Card,
    Divider,
    Grid,
    Group,
    Stack,
    Text,
    ThemeIcon,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
    IconCheck,
    IconInfoCircle,
    IconNetwork,
    IconNetworkOff,
    IconShieldCheck,
    IconX,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import { FC, useState } from 'react';
import NetworkAccessTimeline from '@/components/NetworkAccessTimeline';
import { useLabDrag } from '@/lib/use-lab-drag';

interface LabCardProps {
    lab: Lab;
    stats: LabStats;
    history: ActivationHistoryEntry[];
    onToggle: (labId: string) => void;
    onMove?: (targetId: string) => void;
    layout?: 'standard' | 'wide';
    columns?: 1 | 2 | 3;
}

const LabCard: FC<LabCardProps> = ({ lab, stats, history, onToggle, onMove, layout = 'standard', columns = 1 }) => {
    const [toggling, setToggling] = useState<boolean>(false);
    const { cardRef, style, dragHandle } = useLabDrag({
        id: lab.id, name: lab.name, grid: true, disabled: !onMove, onMove: (targetId) => onMove?.(targetId),
    });

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
            onToggle(lab.id);
            notifications.show({
                title: 'Error',
                message: err instanceof Error ? err.message : `Failed to toggle lab ${lab.name}`,
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
    const usageMB = stats.firewall.usageMB;
    const usageUnit = usageMB != null && usageMB >= 1024 ** 2 ? 'TB' : usageMB != null && usageMB >= 1024 ? 'GB' : 'MB';
    const usageDivisor = usageUnit === 'TB' ? 1024 ** 2 : usageUnit === 'GB' ? 1024 : 1;
    const usageLabel = usageMB == null ? 'Unavailable' : `${(usageMB / usageDivisor).toFixed(2)} ${usageUnit}`;
    const toggleButton = (
        <Button
            fullWidth
            onClick={handleToggle}
            loading={toggling}
            color={isDisabled ? 'green' : 'red'}
            variant={layout === 'wide' ? 'filled' : 'light'}
            leftSection={layout === 'wide' ? <IconShieldCheck size={16} /> : undefined}
        >
            {toggling ? 'Updating...' : isDisabled ? 'Enable Access' : 'Disable Access'}
        </Button>
    );

    if (layout === 'wide') {
        const details = [
            ['Subnet range', lab.subnet],
            [stats.devices.source === 'dhcp' ? 'Bound DHCP devices (estimate)' : 'Online devices', stats.devices.connected ?? 'Unavailable'],
            [lab.interface ? 'Interface usage' : 'Firewall usage', usageLabel],
            ['DHCP server', stats.devices.dhcpServer],
            ['Firewall rule', stats.firewall.ruleId],
        ] as const;

        return (
            <Grid.Col ref={cardRef} data-lab-order-id={lab.id} style={style} span={12}>
                <Card shadow='md' padding={0} radius='md' withBorder>
                    <Group justify='space-between' p='lg' wrap='nowrap'>
                        <Group wrap='nowrap'>
                            <ThemeIcon size={42} radius='md' variant='light'>
                                <IconNetwork size={22} />
                            </ThemeIcon>
                            <Box>
                                <Text fw={600} size='lg'>{lab.name}</Text>
                                {lab.interface && <Text size='xs' c='dimmed'>{lab.interface}</Text>}
                            </Box>
                        </Group>
                        <Group gap={4} wrap='nowrap'>
                            <Badge leftSection={statusIcon} color={statusColor} variant='light' size='lg'>
                                {statusLabel}
                            </Badge>
                            {onMove && dragHandle}
                        </Group>
                    </Group>
                    <Divider />
                    <Grid gap={0}>
                        <Grid.Col span={4} p='xl' style={{ borderRight: '1px solid var(--mantine-color-default-border)' }}>
                            <Stack gap='lg'>
                                <Text size='sm' fw={600}>Lab overview</Text>
                                <Stack component='dl' gap='md' m={0}>
                                    {details.map(([label, value], index) => (
                                        <Box key={label}>
                                            {index === 3 && <Divider mb='lg' />}
                                            <Group justify='space-between' align='baseline' wrap='nowrap' gap='sm'>
                                                <Text component='dt' size='xs' c='dimmed' style={{ flexShrink: 0, maxWidth: '48%' }}>{label}</Text>
                                                <Text component='dd' m={0} size='xs' fw={500} ta='right' style={{ overflowWrap: 'anywhere' }}>{value}</Text>
                                            </Group>
                                        </Box>
                                    ))}
                                </Stack>
                                <Box mt='sm'>
                                    {toggleButton}
                                    <Text size='xs' c='dimmed' ta='center' mt='xs'>
                                        {isDisabled ? 'Restore' : 'Block'} internet access for this lab.
                                    </Text>
                                </Box>
                            </Stack>
                        </Grid.Col>
                        <Grid.Col span={8} p='xl' style={{ minWidth: 0 }}>
                            <Stack gap='xl'>
                                <Group wrap='nowrap'>
                                    <ThemeIcon size={38} radius='xl' color={statusColor} variant='light'>{statusIcon}</ThemeIcon>
                                    <Box>
                                        <Text size='sm' fw={600}>Internet access is {isDisabled ? 'blocked' : 'enabled'}</Text>
                                        <Text size='xs' c='dimmed'>
                                            {stats.devices.source === 'dhcp'
                                                ? `Bound DHCP devices (estimate): ${stats.devices.connected ?? 'Unavailable'}`
                                                : `Online devices: ${stats.devices.connected ?? 'Unavailable'}`}
                                        </Text>
                                    </Box>
                                </Group>
                                <NetworkAccessTimeline
                                    history={history}
                                    currentStatus={{ enabled: !isDisabled, timestamp: stats.timestamp }}
                                    height={88}
                                />
                                <Divider />
                                <Group gap='xs' c='dimmed' wrap='nowrap' align='flex-start'>
                                    <IconInfoCircle size={16} style={{ flexShrink: 0 }} />
                                    <Text size='xs'>Access controls apply to all devices in this lab. Last updated {dayjs(stats.timestamp).format('HH:mm:ss')}.</Text>
                                </Group>
                            </Stack>
                        </Grid.Col>
                    </Grid>
                </Card>
            </Grid.Col>
        );
    }

    return (
        <Grid.Col ref={cardRef} data-lab-order-id={lab.id} style={style} span={12 / columns} h='100%'>
            <Card shadow='md' padding='lg' radius='md' withBorder>
                <Card.Section p='md' pb={0}>
                    <Group justify='space-between' mb='md'>
                        <Text fw={600} size='lg'>
                            {lab.name}
                        </Text>
                        <Group gap={4} wrap='nowrap'>
                            <Badge
                                leftSection={statusIcon}
                                color={statusColor}
                                radius='md'
                                size='md'
                                variant='filled'
                            >
                                {statusLabel}
                            </Badge>
                            {onMove && dragHandle}
                        </Group>
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
                            {stats.devices.source === 'dhcp' ? 'Bound DHCP Devices (estimate)' : 'Online Devices'}
                        </Text>
                        <Text fw={500} size='sm' ff='monospace'>
                            {stats.devices.connected ?? 'Unavailable'}
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
                            {lab.interface ? `Interface Usage (${lab.interface})` : 'Firewall Usage'}
                        </Text>
                        <Text fw={500} size='sm' ff='monospace'>
                            {usageLabel}
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

                    <NetworkAccessTimeline
                        history={history}
                        currentStatus={{ enabled: !isDisabled, timestamp: stats.timestamp }}
                    />
                </Stack>

                {toggleButton}
            </Card>
        </Grid.Col>
    );
};

export default LabCard;
