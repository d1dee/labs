import {
    addPiholeDomain,
    deletePiholeDomain,
    getPiholeDomains,
    type PiholeDomainItem,
    updatePiholeDomain,
} from '@/api';
import {
    ActionIcon,
    Badge,
    Button,
    Card,
    Center,
    Group,
    Loader,
    Modal,
    ScrollArea,
    Select,
    Stack,
    Table,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconCheck,
    IconPlus,
    IconRefresh,
    IconTrash,
    IconX,
} from '@tabler/icons-react';
import { type FC, useEffect, useState } from 'react';

const DomainBlockTab: FC = () => {
    const [domains, setDomains] = useState<PiholeDomainItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [opened, { open, close }] = useDisclosure(false);
    const [newDomain, setNewDomain] = useState('');
    const [newType, setNewType] = useState<'allow' | 'deny'>('deny');
    const [newKind, setNewKind] = useState<'exact' | 'regex'>('exact');
    const [submitting, setSubmitting] = useState(false);

    const fetchDomains = async () => {
        try {
            const data = await getPiholeDomains();
            setDomains(data.domains);
        } catch (err) {
            notifications.show({
                color: 'red',
                title: 'Error',
                message: 'Failed to load domains',
                icon: <IconX size={16} />,
            });
        }
    };

    const refresh = async () => {
        setRefreshing(true);
        await fetchDomains();
        setRefreshing(false);
    };

    useEffect(() => {
        fetchDomains().finally(() => setLoading(false));
    }, []);

    const handleAdd = async () => {
        if (!newDomain.trim()) return;
        setSubmitting(true);
        try {
            await addPiholeDomain(newDomain.trim(), newType, newKind);
            notifications.show({
                color: 'green',
                title: 'Success',
                message: `Added ${newDomain} to ${newType} ${newKind}`,
                icon: <IconCheck size={16} />,
            });
            setNewDomain('');
            close();
            await refresh();
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

    const handleDelete = async (d: PiholeDomainItem) => {
        try {
            await deletePiholeDomain(d.domain, d.type, d.kind);
            notifications.show({
                color: 'green',
                title: 'Deleted',
                message: `Removed ${d.domain}`,
                icon: <IconCheck size={16} />,
            });
            await refresh();
        } catch (err) {
            notifications.show({
                color: 'red',
                title: 'Error',
                message: String(err),
                icon: <IconX size={16} />,
            });
        }
    };

    const handleToggle = async (d: PiholeDomainItem) => {
        try {
            await updatePiholeDomain(d.domain, d.type, d.kind, {
                enabled: !d.enabled,
            });
            notifications.show({
                color: 'green',
                title: !d.enabled ? 'Enabled' : 'Disabled',
                message: `${d.domain} ${!d.enabled ? 'enabled' : 'disabled'}`,
                icon: <IconCheck size={16} />,
            });
            await refresh();
        } catch (err) {
            notifications.show({
                color: 'red',
                title: 'Error',
                message: String(err),
                icon: <IconX size={16} />,
            });
        }
    };

    const deniedDomains = domains.filter((d) => d.type === 'deny');

    return (
        <Stack>
            <div>
                <Group justify='space-between'>
                    <Title order={4}>Domain Blocking</Title>
                    <Group>
                        <ActionIcon
                            variant='subtle'
                            onClick={refresh}
                            loading={refreshing}
                        >
                            <IconRefresh size={18} />
                        </ActionIcon>
                        <Button
                            leftSection={<IconPlus size={16} />}
                            onClick={open}
                        >
                            Add Domain
                        </Button>
                    </Group>
                </Group>
                <Text size='sm' c='dimmed'>
                    Manage which domains are blocked by FCD. Disabled entries
                    are temporarily inactive.
                </Text>
            </div>

            {loading ? (
                <Center py={40}>
                    <Loader />
                </Center>
            ) : deniedDomains.length === 0 ? (
                <Card withBorder p='xl'>
                    <Center>
                        <Stack align='center' gap='sm'>
                            <Text c='dimmed'>
                                No denied domains configured.
                            </Text>
                            <Button
                                leftSection={<IconPlus size={16} />}
                                onClick={open}
                                variant='light'
                            >
                                Add First Domain
                            </Button>
                        </Stack>
                    </Center>
                </Card>
            ) : (
                <Card withBorder p={0}>
                    <ScrollArea mah={500}>
                        <Table highlightOnHover stickyHeader>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>Domain</Table.Th>
                                    <Table.Th>Type</Table.Th>
                                    <Table.Th>Status</Table.Th>
                                    <Table.Th style={{ textAlign: 'right' }}>
                                        Actions
                                    </Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {deniedDomains.map((d) => (
                                    <Table.Tr
                                        key={`${d.type}-${d.kind}-${d.domain}`}
                                    >
                                        <Table.Td>
                                            <Text ff='monospace' size='sm'>
                                                {d.domain}
                                            </Text>
                                            {d.comment && (
                                                <Text size='xs' c='dimmed'>
                                                    {d.comment}
                                                </Text>
                                            )}
                                        </Table.Td>
                                        <Table.Td>
                                            <Badge
                                                size='sm'
                                                variant='light'
                                                color='gray'
                                            >
                                                {d.kind === 'regex'
                                                    ? 'Regex'
                                                    : 'Exact'}
                                            </Badge>
                                        </Table.Td>
                                        <Table.Td>
                                            <Badge
                                                size='sm'
                                                color={
                                                    d.enabled ? 'green' : 'gray'
                                                }
                                                variant='light'
                                            >
                                                {d.enabled
                                                    ? 'Active'
                                                    : 'Disabled'}
                                            </Badge>
                                        </Table.Td>
                                        <Table.Td
                                            style={{ textAlign: 'right' }}
                                        >
                                            <Group gap='xs' justify='flex-end'>
                                                <ActionIcon
                                                    variant='subtle'
                                                    color={
                                                        d.enabled
                                                            ? 'yellow'
                                                            : 'green'
                                                    }
                                                    onClick={() =>
                                                        handleToggle(d)
                                                    }
                                                    title={
                                                        d.enabled
                                                            ? 'Disable'
                                                            : 'Enable'
                                                    }
                                                >
                                                    {d.enabled ? (
                                                        <IconX size={16} />
                                                    ) : (
                                                        <IconCheck size={16} />
                                                    )}
                                                </ActionIcon>
                                                <ActionIcon
                                                    variant='subtle'
                                                    color='red'
                                                    onClick={() =>
                                                        handleDelete(d)
                                                    }
                                                    title='Delete'
                                                >
                                                    <IconTrash size={16} />
                                                </ActionIcon>
                                            </Group>
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </ScrollArea>
                </Card>
            )}

            <Modal
                opened={opened}
                onClose={close}
                title='Add a Domain'
                centered
            >
                <Stack gap='md'>
                    <TextInput
                        label='Domain'
                        placeholder='e.g., example.com'
                        value={newDomain}
                        onChange={(e) => setNewDomain(e.target.value)}
                        required
                        autoFocus
                    />
                    <Select
                        label='Action'
                        value={newType}
                        onChange={(val) =>
                            setNewType((val as 'allow' | 'deny') || 'deny')
                        }
                        allowDeselect={false}
                        data={[
                            { value: 'deny', label: 'Block (Deny)' },
                            { value: 'allow', label: 'Allow (Whitelist)' },
                        ]}
                    />
                    <Select
                        label='Match Type'
                        value={newKind}
                        onChange={(val) =>
                            setNewKind((val as 'exact' | 'regex') || 'exact')
                        }
                        allowDeselect={false}
                        data={[
                            { value: 'exact', label: 'Exact Match' },
                            { value: 'regex', label: 'Regular Expression' },
                        ]}
                    />
                    <Group justify='flex-end' mt='md'>
                        <Button variant='default' onClick={close}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleAdd}
                            loading={submitting}
                            disabled={!newDomain.trim()}
                        >
                            Add Domain
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </Stack>
    );
};

export default DomainBlockTab;
