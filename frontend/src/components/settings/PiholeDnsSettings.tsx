import {
    addPiholeDnsItem,
    deletePiholeDnsItem,
    getPiholeDnsList,
    type PiholeDnsElement,
} from '@/api/pihole';
import {
    ActionIcon,
    Badge,
    Box,
    Button,
    Card,
    Center,
    Group,
    Loader,
    ScrollArea,
    Stack,
    Table,
    Tabs,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
    IconCheck,
    IconLink,
    IconMapPin,
    IconPlus,
    IconRefresh,
    IconServer,
    IconTrash,
    IconX,
} from '@tabler/icons-react';
import { type FC, useCallback, useEffect, useState } from 'react';

interface AddField {
    key: string;
    label: string;
    placeholder: string;
    required: boolean;
    type?: 'text' | 'number';
}

interface DnsElementConfig {
    element: PiholeDnsElement;
    title: string;
    description: string;
    icon: React.ReactNode;
    addFields: AddField[];
    /** Build the stored value from the add-form field values. */
    buildValue: (values: Record<string, string>) => string;
    /** Split a stored value into display cells. */
    splitValue: (value: string) => string[];
    columns: string[];
}

const DNS_CONFIGS: DnsElementConfig[] = [
    {
        element: 'upstreams',
        title: 'Upstream DNS',
        description:
            'Upstream DNS servers used to resolve queries (e.g. 8.8.8.8 or 127.0.0.1#5353).',
        icon: <IconServer size={18} />,
        addFields: [
            {
                key: 'address',
                label: 'Server address',
                placeholder: '8.8.8.8 or 127.0.0.1#5353',
                required: true,
            },
        ],
        buildValue: (v) => v.address.trim(),
        splitValue: (v) => [v],
        columns: ['Server'],
    },
    {
        element: 'hosts',
        title: 'Local DNS Records',
        description:
            'Local A/AAAA records mapping hostnames to IP addresses.',
        icon: <IconMapPin size={18} />,
        addFields: [
            {
                key: 'ip',
                label: 'IP address',
                placeholder: '192.168.1.10',
                required: true,
            },
            {
                key: 'domain',
                label: 'Hostname',
                placeholder: 'myhost.lan',
                required: true,
            },
        ],
        buildValue: (v) => `${v.ip.trim()} ${v.domain.trim()}`,
        splitValue: (v) => {
            const idx = v.indexOf(' ');
            return idx === -1 ? [v, ''] : [v.slice(0, idx), v.slice(idx + 1)];
        },
        columns: ['IP address', 'Hostname'],
    },
    {
        element: 'cnameRecords',
        title: 'CNAME Records',
        description:
            'Alias records pointing one hostname to another, optional TTL (seconds).',
        icon: <IconLink size={18} />,
        addFields: [
            {
                key: 'domain',
                label: 'Alias (domain)',
                placeholder: 'alias.lan',
                required: true,
            },
            {
                key: 'target',
                label: 'Target',
                placeholder: 'myhost.lan',
                required: true,
            },
            {
                key: 'ttl',
                label: 'TTL (optional)',
                placeholder: '3600',
                required: false,
                type: 'number',
            },
        ],
        buildValue: (v) => {
            const base = `${v.domain.trim()},${v.target.trim()}`;
            return v.ttl.trim() ? `${base},${v.ttl.trim()}` : base;
        },
        splitValue: (v) => {
            const parts = v.split(',');
            return [parts[0] ?? '', parts[1] ?? '', parts.slice(2).join(',')];
        },
        columns: ['Alias', 'Target', 'TTL'],
    },
];

const DnsListPanel: FC<{ config: DnsElementConfig }> = ({ config }) => {
    const [items, setItems] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [formValues, setFormValues] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);

    const fetchItems = useCallback(async () => {
        try {
            const data = await getPiholeDnsList(config.element);
            setItems(data.items);
        } catch (err) {
            notifications.show({
                color: 'red',
                title: 'Error',
                message: String(err),
                icon: <IconX size={16} />,
            });
        }
    }, [config.element]);

    const refresh = useCallback(async () => {
        setRefreshing(true);
        await fetchItems();
        setRefreshing(false);
    }, [fetchItems]);

    useEffect(() => {
        fetchItems().finally(() => setLoading(false));
    }, [fetchItems]);

    const handleAdd = async () => {
        const value = config.buildValue(formValues);
        if (!value.trim()) return;

        const missingRequired = config.addFields.some(
            (f) => f.required && !(formValues[f.key] || '').trim(),
        );
        if (missingRequired) return;

        setSubmitting(true);
        try {
            await addPiholeDnsItem(config.element, value);
            notifications.show({
                color: 'green',
                title: 'Added',
                message: `${value} added to ${config.title}`,
                icon: <IconCheck size={16} />,
            });
            setFormValues({});
            await fetchItems();
        } catch (err) {
            notifications.show({
                color: 'red',
                title: 'Error',
                message: String(err),
                icon: <IconX size={16} />,
            });
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (value: string) => {
        try {
            await deletePiholeDnsItem(config.element, value);
            notifications.show({
                color: 'green',
                title: 'Deleted',
                message: `${value} removed`,
                icon: <IconCheck size={16} />,
            });
            await fetchItems();
        } catch (err) {
            notifications.show({
                color: 'red',
                title: 'Error',
                message: String(err),
                icon: <IconX size={16} />,
            });
        }
    };

    const addable = !config.addFields.some(
        (f) => f.required && !(formValues[f.key] || '').trim(),
    );

    return (
        <Stack gap='md'>
            <Group justify='space-between' align='flex-start'>
                <Stack gap={2}>
                    <Group gap='xs'>
                        {config.icon}
                        <Title order={5}>{config.title}</Title>
                    </Group>
                    <Text size='sm' c='dimmed'>
                        {config.description}
                    </Text>
                </Stack>
                <ActionIcon variant='subtle' onClick={refresh} loading={refreshing}>
                    <IconRefresh size={18} />
                </ActionIcon>
            </Group>

            <Group align='flex-end' grow wrap='wrap'>
                {config.addFields.map((field) => (
                    <TextInput
                        key={field.key}
                        label={field.label}
                        placeholder={field.placeholder}
                        required={field.required}
                        type={field.type ?? 'text'}
                        value={formValues[field.key] ?? ''}
                        onChange={(e) => {
                            // Capture the value before the state updater runs —
                            // React nulls currentTarget once the handler returns.
                            const value = e.currentTarget.value;
                            setFormValues((prev) => ({
                                ...prev,
                                [field.key]: value,
                            }));
                        }}
                    />
                ))}
                <Box>
                    <Button
                        leftSection={<IconPlus size={16} />}
                        onClick={handleAdd}
                        loading={submitting}
                        disabled={!addable}
                    >
                        Add
                    </Button>
                </Box>
            </Group>

            {loading ? (
                <Center py={40}>
                    <Loader />
                </Center>
            ) : items.length === 0 ? (
                <Card withBorder p='xl'>
                    <Center>
                        <Stack align='center' gap='sm'>
                            <Text c='dimmed'>
                                No {config.title.toLowerCase()} configured.
                            </Text>
                        </Stack>
                    </Center>
                </Card>
            ) : (
                <Card withBorder p={0}>
                    <ScrollArea mah={420}>
                        <Table highlightOnHover stickyHeader>
                            <Table.Thead>
                                <Table.Tr>
                                    {config.columns.map((col) => (
                                        <Table.Th key={col}>{col}</Table.Th>
                                    ))}
                                    <Table.Th style={{ textAlign: 'right' }}>
                                        Actions
                                    </Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {items.map((value) => {
                                    const cells = config.splitValue(value);
                                    return (
                                        <Table.Tr key={value}>
                                            {cells.map((cell, idx) => (
                                                <Table.Td key={idx}>
                                                    {cell ? (
                                                        <Text
                                                            size='sm'
                                                            ff='monospace'
                                                        >
                                                            {cell}
                                                        </Text>
                                                    ) : (
                                                        <Badge
                                                            size='sm'
                                                            variant='light'
                                                            color='gray'
                                                        >
                                                            default
                                                        </Badge>
                                                    )}
                                                </Table.Td>
                                            ))}
                                            <Table.Td
                                                style={{ textAlign: 'right' }}
                                            >
                                                <Group
                                                    gap='xs'
                                                    justify='flex-end'
                                                >
                                                    <ActionIcon
                                                        variant='subtle'
                                                        color='red'
                                                        onClick={() =>
                                                            handleDelete(value)
                                                        }
                                                        title='Delete'
                                                    >
                                                        <IconTrash size={16} />
                                                    </ActionIcon>
                                                </Group>
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

export const PiholeDnsListTabs: FC = () => {
    return (
        <Tabs defaultValue={DNS_CONFIGS[0].element}>
            <Tabs.List>
                {DNS_CONFIGS.map((cfg) => (
                    <Tabs.Tab
                        key={cfg.element}
                        value={cfg.element}
                        leftSection={cfg.icon}
                    >
                        {cfg.title}
                    </Tabs.Tab>
                ))}
            </Tabs.List>
            {DNS_CONFIGS.map((cfg) => (
                <Tabs.Panel key={cfg.element} value={cfg.element} pt='md'>
                    <DnsListPanel config={cfg} />
                </Tabs.Panel>
            ))}
        </Tabs>
    );
};
