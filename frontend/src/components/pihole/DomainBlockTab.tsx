import {
    addPiholeDomain,
    deletePiholeDomain,
    type PiholeDomains,
    type PiholeDomainItem,
    updatePiholeDomain,
} from '@/api/pihole';
import { useApiStream } from '@/api/useApiStream';
import {
    MobileFilterPanel,
    MobileFilterToggle,
    useMobileTableFilters,
} from '@/components/ui/MobileTableFilters';
import {
    compareTableValues,
    SortableTh,
    type SortState,
    toggleTableSort,
} from '@/components/ui/tableUtils';
import {
    ActionIcon,
    Alert,
    Badge,
    Button,
    Card,
    Center,
    Checkbox,
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
    IconEdit,
    IconPlus,
    IconTrash,
    IconX,
} from '@tabler/icons-react';
import { type FC, useState } from 'react';

const DomainBlockTab: FC = () => {
    const filters = useMobileTableFilters();
    const [domains, setDomains] = useState<PiholeDomainItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [opened, { open, close }] = useDisclosure(false);
    const [newDomain, setNewDomain] = useState('');
    const [newType, setNewType] = useState<'allow' | 'deny'>('deny');
    const [newKind, setNewKind] = useState<'exact' | 'regex'>('exact');
    const [editingDomain, setEditingDomain] = useState<PiholeDomainItem | null>(
        null,
    );
    const [comment, setComment] = useState('');
    const [enabled, setEnabled] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('all');
    const [kind, setKind] = useState('all');
    const [sort, setSort] = useState<SortState<'domain' | 'kind' | 'status'>>({
        key: 'domain',
        direction: 'asc',
    });

    const refresh = useApiStream<PiholeDomains>('/api/pihole/domains', (data) => {
        setDomains(data.domains);
        setError(null);
        setLoading(false);
    }, (err) => {
        setError(err.message);
        setLoading(false);
    });

    const openAdd = () => {
        setEditingDomain(null);
        setNewDomain('');
        setNewType('deny');
        setNewKind('exact');
        setComment('');
        setEnabled(true);
        open();
    };

    const openEdit = (domain: PiholeDomainItem) => {
        setEditingDomain(domain);
        setNewDomain(domain.domain);
        setNewType(domain.type);
        setNewKind(domain.kind);
        setComment(domain.comment ?? '');
        setEnabled(domain.enabled);
        open();
    };

    const handleSave = async () => {
        if (!newDomain.trim() || submitting) return;
        setSubmitting(true);
        try {
            const result = editingDomain
                ? await updatePiholeDomain(
                      editingDomain.domain,
                      editingDomain.type,
                      editingDomain.kind,
                      {
                          newType,
                          newKind,
                          comment,
                          enabled,
                      },
                  )
                : await addPiholeDomain(
                      newDomain.trim(),
                      newType,
                      newKind,
                      comment,
                      enabled,
                  );
            if (result.processed?.errors.length) {
                throw new Error(
                    result.processed.errors
                        .map((item) => item.error)
                        .join('; '),
                );
            }
            notifications.show({
                color: 'green',
                title: 'Success',
                message: `${editingDomain ? 'Updated' : 'Added'} ${newDomain} to ${newType} ${newKind}`,
                icon: <IconCheck size={16} />,
            });
            setNewDomain('');
            close();
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

    const handleDelete = async (d: PiholeDomainItem) => {
        try {
            await deletePiholeDomain(d.domain, d.type, d.kind);
            notifications.show({
                color: 'green',
                title: 'Deleted',
                message: `Removed ${d.domain}`,
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

    const deniedDomains = domains.filter((d) => d.type === 'deny');
    const visibleDomains = deniedDomains
        .filter(
            (d) =>
                `${d.domain} ${d.comment ?? ''}`
                    .toLowerCase()
                    .includes(search.trim().toLowerCase()) &&
                (status === 'all' || d.enabled === (status === 'active')) &&
                (kind === 'all' || d.kind === kind),
        )
        .sort((a, b) =>
            compareTableValues(
                sort.key === 'status'
                    ? a.enabled
                        ? 'Active'
                        : 'Disabled'
                    : a[sort.key],
                sort.key === 'status'
                    ? b.enabled
                        ? 'Active'
                        : 'Disabled'
                    : b[sort.key],
                sort.direction,
            ),
        );

    return (
        <Card withBorder radius='lg' p='md'>
            <Stack gap='md'>
                {error && <Alert color='red' title='Domains Request Failed'>{error}</Alert>}
                <Group justify='space-between' align='flex-end'>
                    <div>
                        <Title order={4}>Domain Blocking</Title>
                        <Text size='sm' c='dimmed'>
                            Manage which domains are blocked by FCD. Disabled
                            entries are temporarily inactive.
                        </Text>
                    </div>
                    <Group align='flex-end' w={{ base: '100%', sm: 'auto' }}>
                        <Group
                            wrap='nowrap'
                            gap='xs'
                            w={{ base: '100%', sm: 300 }}
                        >
                            <TextInput
                                aria-label='Search blocked domains'
                                placeholder='Search domains or comments...'
                                value={search}
                                flex={1}
                                miw={0}
                                onChange={(event) =>
                                    setSearch(event.currentTarget.value)
                                }
                            />
                            <MobileFilterToggle
                                opened={filters.opened}
                                onToggle={filters.toggle}
                                controlsId={filters.controlsId}
                                label='Toggle domain blocking filters'
                            />
                        </Group>
                    </Group>
                </Group>

                <MobileFilterPanel
                    opened={filters.opened}
                    id={filters.controlsId}
                >
                    <Group grow preventGrowOverflow={false} align='flex-end'>
                        <Select
                            miw={{ base: '100%', sm: 180 }}
                            label='Domain status'
                            value={status}
                            allowDeselect={false}
                            onChange={(value) => setStatus(value ?? 'all')}
                            data={[
                                { value: 'all', label: 'All statuses' },
                                { value: 'active', label: 'Active' },
                                { value: 'disabled', label: 'Disabled' },
                            ]}
                        />
                        <Select
                            miw={{ base: '100%', sm: 180 }}
                            label='Domain match type'
                            value={kind}
                            allowDeselect={false}
                            onChange={(value) => setKind(value ?? 'all')}
                            data={[
                                { value: 'all', label: 'All types' },
                                { value: 'exact', label: 'Exact' },
                                { value: 'regex', label: 'Regex' },
                            ]}
                        />
                        <Button
                            leftSection={<IconPlus size={16} />}
                            style={{ flex: '0 0 auto' }}
                            onClick={openAdd}
                        >
                            Add Domain
                        </Button>
                    </Group>
                </MobileFilterPanel>
                {loading ? (
                    <Center py={40}>
                        <Loader />
                    </Center>
                ) : deniedDomains.length === 0 ? (
                    <Center py='xl'>
                        <Stack align='center' gap='sm'>
                            <Text c='dimmed'>
                                No denied domains configured.
                            </Text>
                            <Button
                                leftSection={<IconPlus size={16} />}
                                onClick={openAdd}
                                variant='light'
                            >
                                Add First Domain
                            </Button>
                        </Stack>
                    </Center>
                ) : visibleDomains.length === 0 ? (
                    <Text c='dimmed'>
                        No blocked domains match your filters.
                    </Text>
                ) : (
                    <Table.ScrollContainer minWidth={600}>
                        <ScrollArea mah={500}>
                            <Table
                                verticalSpacing='sm'
                                highlightOnHover
                                stickyHeader
                            >
                                <Table.Thead>
                                    <Table.Tr>
                                        {(
                                            [
                                                'domain',
                                                'kind',
                                                'status',
                                            ] as const
                                        ).map((key) => (
                                            <SortableTh
                                                key={key}
                                                label={
                                                    key === 'kind'
                                                        ? 'Type'
                                                        : key === 'domain'
                                                          ? 'Domain'
                                                          : 'Status'
                                                }
                                                active={sort.key === key}
                                                direction={sort.direction}
                                                onSort={() =>
                                                    setSort((current) =>
                                                        toggleTableSort(
                                                            current,
                                                            key,
                                                        ),
                                                    )
                                                }
                                            />
                                        ))}
                                        <Table.Th
                                            style={{ textAlign: 'right' }}
                                        >
                                            Actions
                                        </Table.Th>
                                    </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                    {visibleDomains.map((d) => (
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
                                                        d.enabled
                                                            ? 'green'
                                                            : 'gray'
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
                                                <Group
                                                    gap='xs'
                                                    justify='flex-end'
                                                >
                                                    <ActionIcon
                                                        variant='subtle'
                                                        onClick={() =>
                                                            openEdit(d)
                                                        }
                                                        title='Edit'
                                                        aria-label={`Edit ${d.domain}`}
                                                    >
                                                        <IconEdit size={16} />
                                                    </ActionIcon>
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
                                                            <IconCheck
                                                                size={16}
                                                            />
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
                    </Table.ScrollContainer>
                )}

                <Modal
                    opened={opened}
                    onClose={() => {
                        if (!submitting) close();
                    }}
                    title={editingDomain ? 'Edit Domain' : 'Add a Domain'}
                    closeButtonProps={{ disabled: submitting }}
                    centered
                >
                    <Stack gap='md'>
                        <TextInput
                            label='Domain'
                            placeholder='e.g., example.com'
                            value={newDomain}
                            readOnly={editingDomain !== null}
                            description={
                                editingDomain
                                    ? 'Domain names cannot be changed. Add a new rule to use a different domain.'
                                    : undefined
                            }
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
                                setNewKind(
                                    (val as 'exact' | 'regex') || 'exact',
                                )
                            }
                            allowDeselect={false}
                            data={[
                                { value: 'exact', label: 'Exact Match' },
                                { value: 'regex', label: 'Regular Expression' },
                            ]}
                        />
                        <TextInput
                            label='Comment'
                            value={comment}
                            onChange={(event) =>
                                setComment(event.currentTarget.value)
                            }
                        />
                        <Checkbox
                            label='Enabled'
                            checked={enabled}
                            onChange={(event) =>
                                setEnabled(event.currentTarget.checked)
                            }
                        />
                        <Group justify='flex-end' mt='md'>
                            <Button
                                variant='default'
                                onClick={close}
                                disabled={submitting}
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleSave}
                                loading={submitting}
                                disabled={!newDomain.trim()}
                            >
                                {editingDomain ? 'Save Changes' : 'Add Domain'}
                            </Button>
                        </Group>
                    </Stack>
                </Modal>
            </Stack>
        </Card>
    );
};

export default DomainBlockTab;
