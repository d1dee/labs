import {
    createFogSnapinTask,
    createFogTask,
    deleteFogHost,
    getFogHost,
    getFogStatus,
    listFogHosts,
    listFogImages,
    listFogSnapins,
    listFogTaskTypes,
    updateFogHost,
    type FogHost,
    type FogImage,
    type FogSnapin,
    type FogTaskType,
} from '@/api/fog';
import {
    ActionIcon,
    Alert,
    Badge,
    Button,
    Card,
    Center,
    Group,
    Loader,
    Modal,
    Select,
    Stack,
    Table,
    Text,
    TextInput,
    Title,
    Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
    IconAlertCircle,
    IconCheck,
    IconCopy,
    IconPlayerPlay,
    IconRefresh,
    IconSearch,
    IconTrash,
    IconX,
} from '@tabler/icons-react';
import { useEffect, useState, type FC } from 'react';

const ManagementTab: FC = () => {
    const [configured, setConfigured] = useState<boolean | null>(null);
    const [hosts, setHosts] = useState<FogHost[]>([]);
    const [images, setImages] = useState<FogImage[]>([]);
    const [taskTypes, setTaskTypes] = useState<FogTaskType[]>([]);
    const [snapins, setSnapins] = useState<FogSnapin[]>([]);
    const [loading, setLoading] = useState(true);
    const [searching, setSearching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchName, setSearchName] = useState('');
    const [searchMac, setSearchMac] = useState('');
    const [selectedHost, setSelectedHost] = useState<FogHost | null>(null);
    const [hostDetailLoading, setHostDetailLoading] = useState(false);

    const [snapinModalOpen, setSnapinModalOpen] = useState(false);
    const [selectedSnapin, setSelectedSnapin] = useState<string | null>(null);
    const [taskingHost, setTaskingHost] = useState<FogHost | null>(null);
    const [taskLoading, setTaskLoading] = useState(false);

    const [deployTaskTypeId, setDeployTaskTypeId] = useState<number | null>(
        null,
    );
    const [captureTaskTypeId, setCaptureTaskTypeId] = useState<number | null>(
        null,
    );

    const fetchStatus = async () => {
        try {
            const status = await getFogStatus();
            setConfigured(status.configured);
            return status.configured;
        } catch {
            setConfigured(false);
            return false;
        }
    };

    const fetchReferenceData = async () => {
        try {
            const [imgs, types, snaps] = await Promise.all([
                listFogImages(),
                listFogTaskTypes(),
                listFogSnapins(),
            ]);
            setImages(imgs.images);
            setTaskTypes(types.tasktypes);
            setSnapins(snaps.snapins);

            // Auto-detect common task type IDs
            const deploy = types.tasktypes.find((t) =>
                t.name?.toLowerCase().includes('deploy'),
            );
            const capture = types.tasktypes.find((t) =>
                t.name?.toLowerCase().includes('capture'),
            );
            if (deploy) setDeployTaskTypeId(deploy.id);
            if (capture) setCaptureTaskTypeId(capture.id);
        } catch {
            // non-critical
        }
    };

    const fetchHosts = async (search?: string) => {
        setSearching(true);
        setError(null);
        try {
            const data = await listFogHosts(search);
            setHosts(data.hosts);
        } catch (err) {
            setError(String(err));
        } finally {
            setSearching(false);
        }
    };

    const loadAll = async () => {
        setLoading(true);
        const ok = await fetchStatus();
        if (ok) {
            await fetchReferenceData();
            await fetchHosts();
        }
        setLoading(false);
    };

    useEffect(() => {
        loadAll();
    }, []);

    const handleSearch = () => {
        const term = searchName.trim() || searchMac.trim() || undefined;
        fetchHosts(term);
    };

    const handleViewHost = async (host: FogHost) => {
        setHostDetailLoading(true);
        try {
            const detail = await getFogHost(host.id);
            setSelectedHost(detail);
        } catch (err) {
            notifications.show({
                color: 'red',
                title: 'Error',
                message: String(err),
                icon: <IconX size={16} />,
            });
        } finally {
            setHostDetailLoading(false);
        }
    };

    const handleCreateTask = async (
        taskTypeId: number,
        options?: Record<string, unknown>,
    ) => {
        if (!selectedHost) return;
        setTaskLoading(true);
        try {
            const result = await createFogTask(
                selectedHost.id,
                taskTypeId,
                options,
            );
            notifications.show({
                color: 'green',
                title: 'Task Created',
                message:
                    result.message || `Task created for ${selectedHost.name}`,
                icon: <IconCheck size={16} />,
            });
        } catch (err) {
            notifications.show({
                color: 'red',
                title: 'Task Failed',
                message: String(err),
                icon: <IconX size={16} />,
            });
        } finally {
            setTaskLoading(false);
        }
    };

    const handleOpenSnapinModal = (host: FogHost) => {
        setTaskingHost(host);
        setSelectedSnapin(null);
        setSnapinModalOpen(true);
    };

    const handleSendSnapin = async () => {
        if (!taskingHost || !selectedSnapin) return;
        setTaskLoading(true);
        try {
            const snapinId = parseInt(selectedSnapin, 10);
            const result = await createFogSnapinTask(taskingHost.id, snapinId);
            notifications.show({
                color: 'green',
                title: 'Snapin Task Sent',
                message:
                    result.message || `Snapin task sent to ${taskingHost.name}`,
                icon: <IconCheck size={16} />,
            });
            setSnapinModalOpen(false);
        } catch (err) {
            notifications.show({
                color: 'red',
                title: 'Snapin Task Failed',
                message: String(err),
                icon: <IconX size={16} />,
            });
        } finally {
            setTaskLoading(false);
        }
    };

    const handleAssignImage = async (imageId: number) => {
        if (!selectedHost) return;
        try {
            await updateFogHost(selectedHost.id, { imageID: imageId });
            notifications.show({
                color: 'green',
                title: 'Image Assigned',
                message: `Image assigned to ${selectedHost.name}`,
                icon: <IconCheck size={16} />,
            });
            const detail = await getFogHost(selectedHost.id);
            setSelectedHost(detail);
        } catch (err) {
            notifications.show({
                color: 'red',
                title: 'Assignment Failed',
                message: String(err),
                icon: <IconX size={16} />,
            });
        }
    };

    const handleDeleteHost = async (host: FogHost) => {
        if (!confirm(`Delete host "${host.name}"?`)) return;
        try {
            await deleteFogHost(host.id);
            notifications.show({
                color: 'green',
                title: 'Host Deleted',
                message: `${host.name} deleted`,
                icon: <IconCheck size={16} />,
            });
            setSelectedHost(null);
            await fetchHosts();
        } catch (err) {
            notifications.show({
                color: 'red',
                title: 'Delete Failed',
                message: String(err),
                icon: <IconX size={16} />,
            });
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        notifications.show({
            color: 'blue',
            title: 'Copied',
            message: text,
            icon: <IconCopy size={16} />,
        });
    };

    if (loading && configured === null) {
        return (
            <Center py={60}>
                <Stack align='center' gap='md'>
                    <Loader />
                    <Text>Loading FOG management...</Text>
                </Stack>
            </Center>
        );
    }

    if (!configured) {
        return (
            <Alert
                icon={<IconAlertCircle size={18} />}
                title='FOG Not Configured'
                color='yellow'
                mt='md'
            >
                FOG Project is not configured. Please set <code>FOG_URL</code>,{' '}
                <code>FOG_API_TOKEN</code>, and <code>FOG_USER_TOKEN</code> in
                your server environment variables.
            </Alert>
        );
    }

    return (
        <Stack gap='md'>
            <Group justify='space-between'>
                <Title order={4}>FOG Host Management</Title>
                <Button
                    size='xs'
                    leftSection={<IconRefresh size={14} />}
                    onClick={loadAll}
                    loading={loading}
                >
                    Refresh
                </Button>
            </Group>

            {error && (
                <Alert icon={<IconX size={18} />} title='Error' color='red'>
                    {error}
                </Alert>
            )}

            <Card withBorder p='md'>
                <Stack gap='sm'>
                    <Group grow>
                        <TextInput
                            label='Host Name'
                            placeholder='Search by name...'
                            value={searchName}
                            onChange={(e) =>
                                setSearchName(e.currentTarget.value)
                            }
                            onKeyDown={(e) =>
                                e.key === 'Enter' && handleSearch()
                            }
                        />
                        <TextInput
                            label='MAC Address'
                            placeholder='Search by MAC...'
                            value={searchMac}
                            onChange={(e) =>
                                setSearchMac(e.currentTarget.value)
                            }
                            onKeyDown={(e) =>
                                e.key === 'Enter' && handleSearch()
                            }
                        />
                    </Group>
                    <Group justify='flex-end'>
                        <Button
                            leftSection={<IconSearch size={14} />}
                            onClick={handleSearch}
                            loading={searching}
                            size='sm'
                        >
                            Search
                        </Button>
                    </Group>
                </Stack>
            </Card>

            {hosts.length > 0 && (
                <Card withBorder p={0}>
                    <Table highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>ID</Table.Th>
                                <Table.Th>Name</Table.Th>
                                <Table.Th>MACs</Table.Th>
                                <Table.Th>Image</Table.Th>
                                <Table.Th>Status</Table.Th>
                                <Table.Th style={{ textAlign: 'right' }}>
                                    Actions
                                </Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {hosts.map((host) => (
                                <Table.Tr
                                    key={host.id}
                                    style={{
                                        cursor: 'pointer',
                                        background:
                                            selectedHost?.id === host.id
                                                ? 'var(--mantine-color-blue-light)'
                                                : undefined,
                                    }}
                                    onClick={() => handleViewHost(host)}
                                >
                                    <Table.Td>{host.id}</Table.Td>
                                    <Table.Td>
                                        <Text fw={500}>{host.name}</Text>
                                    </Table.Td>
                                    <Table.Td>
                                        <Text size='sm' ff='monospace'>
                                            {host.macs?.[0] || '-'}
                                        </Text>
                                    </Table.Td>
                                    <Table.Td>
                                        {host?.imagename || (
                                            <Text c='dimmed' size='sm'>
                                                No image
                                            </Text>
                                        )}
                                    </Table.Td>
                                    <Table.Td>
                                        <Badge
                                            color={
                                                host.pingstatuscode === 0
                                                    ? 'green'
                                                    : host.pingstatuscode === 1
                                                      ? 'red'
                                                      : 'gray'
                                            }
                                        >
                                            {host.pingstatustext || 'unknown'}
                                        </Badge>
                                    </Table.Td>
                                    <Table.Td>
                                        <Group justify='flex-end' gap='xs'>
                                            <Tooltip label='Send Snapin'>
                                                <ActionIcon
                                                    color='blue'
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleOpenSnapinModal(
                                                            host,
                                                        );
                                                    }}
                                                >
                                                    <IconPlayerPlay size={16} />
                                                </ActionIcon>
                                            </Tooltip>
                                            <Tooltip label='Delete'>
                                                <ActionIcon
                                                    color='red'
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDeleteHost(host);
                                                    }}
                                                >
                                                    <IconTrash size={16} />
                                                </ActionIcon>
                                            </Tooltip>
                                        </Group>
                                    </Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                </Card>
            )}

            {selectedHost && (
                <Card withBorder p='md'>
                    <Stack gap='md'>
                        <Group justify='space-between'>
                            <Title order={5}>{selectedHost.name}</Title>
                            <Badge size='lg'>ID: {selectedHost.id}</Badge>
                        </Group>

                        {hostDetailLoading && <Loader size='sm' />}

                        <Group grow>
                            <Stack gap='xs'>
                                <Text size='sm' c='dimmed'>
                                    MAC Addresses
                                </Text>
                                <Stack gap={4}>
                                    {selectedHost.macs?.map((mac) => (
                                        <Group key={mac} gap='xs'>
                                            <Text ff='monospace' size='sm'>
                                                {mac}
                                            </Text>
                                            <ActionIcon
                                                size='xs'
                                                variant='subtle'
                                                onClick={() =>
                                                    copyToClipboard(mac)
                                                }
                                            >
                                                <IconCopy size={12} />
                                            </ActionIcon>
                                        </Group>
                                    )) || <Text size='sm'>-</Text>}
                                </Stack>
                            </Stack>
                            <Stack gap='xs'>
                                <Text size='sm' c='dimmed'>
                                    Description
                                </Text>
                                <Text size='sm'>
                                    {selectedHost.description || '-'}
                                </Text>
                            </Stack>
                        </Group>

                        <Group grow>
                            <Stack gap='xs'>
                                <Text size='sm' c='dimmed'>
                                    Current Image
                                </Text>
                                <Text size='sm' fw={500}>
                                    {selectedHost.imagename || 'None assigned'}
                                </Text>
                            </Stack>
                            <Stack gap='xs'>
                                <Text size='sm' c='dimmed'>
                                    Assign Image
                                </Text>
                                <Select
                                    placeholder='Select image...'
                                    data={images.map((img) => ({
                                        value: String(img.id),
                                        label: img.name,
                                    }))}
                                    onChange={(val) => {
                                        if (val)
                                            handleAssignImage(
                                                parseInt(val, 10),
                                            );
                                    }}
                                    clearable
                                />
                            </Stack>
                        </Group>

                        <Stack gap='xs'>
                            <Text size='sm' c='dimmed'>
                                Imaging Actions
                            </Text>
                            <Group gap='sm'>
                                <Button
                                    size='sm'
                                    color='green'
                                    leftSection={<IconPlayerPlay size={14} />}
                                    onClick={() => {
                                        if (deployTaskTypeId) {
                                            handleCreateTask(deployTaskTypeId);
                                        } else {
                                            notifications.show({
                                                color: 'yellow',
                                                title: 'No Deploy Type',
                                                message:
                                                    'Could not detect deploy task type ID.',
                                            });
                                        }
                                    }}
                                    loading={taskLoading}
                                    disabled={!deployTaskTypeId}
                                >
                                    Deploy
                                </Button>
                                <Button
                                    size='sm'
                                    color='orange'
                                    leftSection={<IconPlayerPlay size={14} />}
                                    onClick={() => {
                                        if (captureTaskTypeId) {
                                            handleCreateTask(captureTaskTypeId);
                                        } else {
                                            notifications.show({
                                                color: 'yellow',
                                                title: 'No Capture Type',
                                                message:
                                                    'Could not detect capture task type ID.',
                                            });
                                        }
                                    }}
                                    loading={taskLoading}
                                    disabled={!captureTaskTypeId}
                                >
                                    Capture
                                </Button>
                                <Button
                                    size='sm'
                                    color='blue'
                                    leftSection={<IconPlayerPlay size={14} />}
                                    onClick={() =>
                                        handleOpenSnapinModal(selectedHost)
                                    }
                                    loading={taskLoading}
                                >
                                    Send Snapin
                                </Button>
                            </Group>
                        </Stack>

                        {taskTypes.length > 0 && (
                            <Stack gap='xs'>
                                <Text size='sm' c='dimmed'>
                                    Available Task Types
                                </Text>
                                <Group gap='xs'>
                                    {taskTypes.map((tt) => (
                                        <Badge
                                            key={tt.id}
                                            variant='outline'
                                            size='sm'
                                        >
                                            {tt.id}: {tt.name}
                                        </Badge>
                                    ))}
                                </Group>
                            </Stack>
                        )}
                    </Stack>
                </Card>
            )}

            <Modal
                opened={snapinModalOpen}
                onClose={() => setSnapinModalOpen(false)}
                title={`Send Snapin to ${taskingHost?.name}`}
                centered
            >
                <Stack gap='md'>
                    <Select
                        label='Select Snapin'
                        placeholder='Choose a snapin...'
                        data={snapins?.map((s) => ({
                            value: String(s.id),
                            label: s.name,
                        }))}
                        value={selectedSnapin}
                        onChange={setSelectedSnapin}
                        searchable
                        nothingFoundMessage='No snapins found'
                    />
                    {selectedSnapin && (
                        <Text size='sm' c='dimmed'>
                            {
                                snapins.find(
                                    (s) =>
                                        s.id === parseInt(selectedSnapin, 10),
                                )?.description
                            }
                        </Text>
                    )}
                    <Group justify='flex-end' mt='md'>
                        <Button
                            variant='default'
                            onClick={() => setSnapinModalOpen(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            color='blue'
                            onClick={handleSendSnapin}
                            loading={taskLoading}
                            disabled={!selectedSnapin}
                        >
                            Send Snapin
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </Stack>
    );
};

export default ManagementTab;
