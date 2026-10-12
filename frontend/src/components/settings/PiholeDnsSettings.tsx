import {
    addPiholeDnsItem,
    deletePiholeDnsItem,
    type PiholeDnsList,
    type PiholeDnsElement,
} from '@/api/pihole';
import { useApiStream } from '@/api/useApiStream';
import { TablePagination, useTablePagination } from '@/components/ui/TablePagination';
import { compareTableValues, SortableTh, toggleTableSort, type SortState } from '@/components/ui/tableUtils';
import {
    ActionIcon,
    Badge,
    Box,
    Button,
    Card,
    Center,
    Flex,
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
    IconServer,
    IconTrash,
    IconX,
} from '@tabler/icons-react';
import { type FC, useState } from 'react';

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

const DnsListPanel: FC<{ config: DnsElementConfig; enabled: boolean }> = ({ config, enabled }) => {
    const [items, setItems] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [formValues, setFormValues] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<SortState | null>(null);
    const query = search.trim().toLowerCase();
    const visibleItems = items.map((value) => ({ value, cells: config.splitValue(value) }))
        .filter(({ cells }) => cells.some((cell) => (cell || 'default').toLowerCase().includes(query)));
    if (sort) {
        const index = config.columns.indexOf(sort.key);
        const sortValue = (cells: string[]) => {
            const cell = cells[index]?.trim();
            if (!cell) return null;
            if (sort.key === 'TTL') {
                const ttl = Number(cell);
                return Number.isFinite(ttl) ? ttl : null;
            }
            return cell;
        };
        visibleItems.sort((a, b) => compareTableValues(sortValue(a.cells), sortValue(b.cells), sort.direction));
    }
    const pagination = useTablePagination(visibleItems, JSON.stringify({ search, sort }));

    const refresh = useApiStream<PiholeDnsList>(enabled ? `/api/pihole/dns/${config.element}` : null,
        (data) => {
            setItems(data.items);
            setLoading(false);
        }, (err) => {
            setLoading(false);
            notifications.show({
                color: 'red',
                title: 'Error',
                message: String(err),
                icon: <IconX size={16} />,
            });
        });

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
            refresh();
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
            refresh();
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
        <Card withBorder radius='lg' p='md'>
            <Stack gap='md'>
                <Flex direction={{ base: 'column', sm: 'row' }} align={{ base: 'stretch', sm: 'flex-end' }} gap='md'>
                    <Stack gap={2} flex={1} miw={0} style={{ overflowWrap: 'anywhere' }}>
                        <Group gap='xs' wrap='nowrap'>
                            <Box style={{ flexShrink: 0 }}>{config.icon}</Box>
                            <Title order={4} miw={0}>{config.title}</Title>
                        </Group>
                        <Text size='sm' c='dimmed'>
                            {config.description}
                        </Text>
                    </Stack>
                    <TextInput aria-label={`Search ${config.title}`} placeholder='Search all fields...'
                        value={search} onChange={(event) => setSearch(event.currentTarget.value)}
                        w={{ base: '100%', sm: 300 }} style={{ flexShrink: 0 }} />
                </Flex>

                <Group align='flex-end' grow preventGrowOverflow={false} wrap='wrap'>
                    {config.addFields.map((field) => (
                        <TextInput
                            miw={{ base: '100%', sm: 180 }}
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
                    <Center py='xl'>
                        <Stack align='center' gap='sm'>
                            <Text c='dimmed'>
                                No {config.title.toLowerCase()} configured.
                            </Text>
                        </Stack>
                    </Center>
                ) : (
                    <Table.ScrollContainer minWidth={config.columns.length === 1 ? 400 : 600}>
                        <ScrollArea mah={420}>
                            <Table verticalSpacing='sm' highlightOnHover stickyHeader>
                                <Table.Thead>
                                    <Table.Tr>
                                        {config.columns.map((col) => (
                                            <SortableTh key={col} label={col} active={sort?.key === col}
                                                direction={sort?.direction ?? 'asc'}
                                                onSort={() => setSort((current) => toggleTableSort(current, col))} />
                                        ))}
                                        <Table.Th style={{ textAlign: 'right' }}>
                                            Actions
                                        </Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {visibleItems.length === 0 ? (
                                        <Table.Tr><Table.Td colSpan={config.columns.length + 1}><Text ta='center' c='dimmed'>No records match the current search.</Text></Table.Td></Table.Tr>
                                    ) : null}
                                    {pagination.pageItems.map(({ value, cells }) => {
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
                                                            aria-label={`Delete ${value}`}
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
                    </Table.ScrollContainer>
                )}
                {!loading && <TablePagination pagination={pagination} label='records' />}
            </Stack>
        </Card>
    );
};

export const PiholeDnsListTabs: FC<{ enabled?: boolean }> = ({ enabled = true }) => {
    const [activeTab, setActiveTab] = useState<string | null>(DNS_CONFIGS[0].element);
    return (
        <Tabs value={activeTab} onChange={setActiveTab} keepMounted keepMountedMode='display-none'>
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
                    <DnsListPanel config={cfg} enabled={enabled && activeTab === cfg.element} />
                </Tabs.Panel>
            ))}
        </Tabs>
    );
};
