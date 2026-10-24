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
    Grid,
    Group,
    Stack,
    Text,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
    IconCheck,
    IconNetwork,
    IconNetworkOff,
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
}

const LabCard: FC<LabCardProps> = ({ lab, stats, history, onToggle, onMove }) => {
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

    return (
        <Grid.Col ref={cardRef} data-lab-order-id={lab.id} style={style} span={{ base: 12, sm: 6, md: 4 }} maw={420} h='100%'>
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
                            {usageMB == null ? 'Unavailable' : `${(usageMB / usageDivisor).toFixed(2)} ${usageUnit}`}
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
