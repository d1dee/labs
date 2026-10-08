import {
    createFogSnapinTask,
    createFogTask,
    deleteFogHost,
    getFogStatus,
    listFogHosts,
    listFogImages,
    listFogSnapins,
    listFogTaskTypes,
    type FogHost,
    type FogImage,
    type FogSnapin,
    type FogTaskType,
} from '@/api/fog';
import { PageHero } from '@/components/ui/PageHero';
import {
    Alert,
    Button,
    Center,
    Group,
    Loader,
    Select,
    Stack,
    Text,
} from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import {
    IconAlertCircle,
    IconCheck,
    IconPackage,
    IconRefresh,
    IconX,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { HostTable } from './HostTable';
import { SelectedHostCard } from './SelectedHostCard';

function ManagementTab() {
    const [configured, setConfigured] = useState<boolean | null>(null);
    const [images, setImages] = useState<FogImage[]>([]);
    const [taskTypes, setTaskTypes] = useState<FogTaskType[]>([]);
    const [snapins, setSnapins] = useState<FogSnapin[]>([]);
    const [loading, setLoading] = useState(true);
    const [allHosts, setAllHosts] = useState<FogHost[]>([]);

    // Selection state lives here and is shared down to both table and card
    const [selectedIds, setSelectedIds] = useState<number[]>([]);

    const [deployTaskTypeId, setDeployTaskTypeId] = useState<number | null>(
        null,
    );
    const [captureTaskTypeId, setCaptureTaskTypeId] = useState<number | null>(
        null,
    );

    const selectedHosts = useMemo(
        () => allHosts.filter((v) => selectedIds.includes(v.id)),
        [allHosts, selectedIds],
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
            const [imgs, types, snaps, hosts] = await Promise.all([
                listFogImages(),
                listFogTaskTypes(),
                listFogSnapins(),
                listFogHosts(),
            ]);
            setImages(imgs.images);
            setTaskTypes(types.tasktypes);
            setSnapins(snaps.snapins);

            // Reconcile selection against the fresh host list
            const freshIds = new Set(hosts.hosts.map((h) => h.id));
            setAllHosts(
                hosts.hosts.map((v) => ({
                    id: v.id,
                    name: v.name,
                    macs: v.macs,
                    inventory: v.inventory,
                    imagename: v.imagename,
                    pingstatuscode: v.pingstatuscode,
                    pingstatustext: v.pingstatustext,
                })),
            );
            setSelectedIds((prev) => prev.filter((id) => freshIds.has(id)));

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

    const loadAll = async () => {
        setLoading(true);
        const ok = await fetchStatus();
        if (ok) {
            await fetchReferenceData();
        }
        setLoading(false);
    };

    useEffect(() => {
        loadAll();
    }, []);

    const modelCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const host of allHosts) {
            const model = host.inventory?.sysproduct?.trim();
            if (!model) continue;
            counts.set(model, (counts.get(model) ?? 0) + 1);
        }
        return counts;
    }, [allHosts]);

    const topModels = useMemo(
        () =>
            [...modelCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
        [modelCounts],
    );

    const snapinCount = snapins.length;

    // When hosts are deleted, remove them from allHosts and clear selection
    const handleHostsDeleted = useCallback((deletedIds: number[]) => {
        const del = new Set(deletedIds);
        setAllHosts((prev) => prev.filter((h) => !del.has(h.id)));
        setSelectedIds((prev) => prev.filter((id) => !del.has(id)));
    }, []);

    // When a single host is updated, patch it in place
    const handleHostUpdated = useCallback((updated: FogHost) => {
        setAllHosts((prev) =>
            prev.map((h) => (h.id === updated.id ? updated : h)),
        );
    }, []);

    const handleDeploy = useCallback(
        (host: FogHost) => {
            if (!deployTaskTypeId) {
                notifications.show({
                    color: 'red',
                    title: 'Deploy Failed',
                    message: 'No deploy task type is configured.',
                    icon: <IconX size={16} />,
                });
                return;
            }

            modals.openConfirmModal({
                title: 'Deploy Host',
                children: (
                    <Text size='sm'>
                        Are you sure you want to create a Deploy task for host{' '}
                        <strong>{host.name}</strong>?
                    </Text>
                ),
                labels: { confirm: 'Deploy', cancel: 'Cancel' },
                confirmProps: { color: 'green' },
                onConfirm: async () => {
                    try {
                        await createFogTask(host.id, deployTaskTypeId);
                        notifications.show({
                            color: 'green',
                            title: 'Deploy Started',
                            message: `Deploy task created for host ${host.name}`,
                            icon: <IconCheck size={16} />,
                        });
                    } catch {
                        notifications.show({
                            color: 'red',
                            title: 'Deploy Failed',
                            message: `Failed to create deploy task for ${host.name}`,
                            icon: <IconX size={16} />,
                        });
                    }
                },
            });
        },
        [deployTaskTypeId],
    );

    const handleSnapin = useCallback(
        (host: FogHost) => {
            const modalId = 'snapin-quick-action';
            modals.open({
                modalId,
                title: 'Send Snapin',
                children: (
                    <SnapinQuickActionModal
                        host={host}
                        snapins={snapins}
                        onClose={() => modals.close(modalId)}
                    />
                ),
            });
        },
        [snapins],
    );

    const handleDelete = useCallback(
        (host: FogHost) => {
            modals.openConfirmModal({
                title: 'Delete Host',
                children: (
                    <Text size='sm'>
                        Are you sure you want to delete host{' '}
                        <strong>{host.name}</strong>? This action is permanent
                        and cannot be undone.
                    </Text>
                ),
                labels: { confirm: 'Delete', cancel: 'Cancel' },
                confirmProps: { color: 'red' },
                onConfirm: async () => {
                    try {
                        await deleteFogHost(host.id);
                        notifications.show({
                            color: 'green',
                            title: 'Host Deleted',
                            message: `Deleted host ${host.name}`,
                            icon: <IconCheck size={16} />,
                        });
                        handleHostsDeleted([host.id]);
                    } catch {
                        notifications.show({
                            color: 'red',
                            title: 'Delete Failed',
                            message: `Failed to delete host ${host.name}`,
                            icon: <IconX size={16} />,
                        });
                    }
                },
            });
        },
        [handleHostsDeleted],
    );

    // Stable key for SelectedHostCard — forces remount (resets tab state) when
    // the set of selected hosts changes identity
    const cardKey = selectedIds.slice().sort().join(',');

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
            <PageHero
                eyebrow='Deployment'
                title='FOG host overview'
                description='Manage registered hosts, images and snapins for network deployment.'
                icon={<IconPackage size={25} />}
                actions={
                    <Button
                        variant='light'
                        color='teal'
                        leftSection={<IconRefresh size={16} />}
                        onClick={loadAll}
                        loading={loading}
                    >
                        Refresh
                    </Button>
                }
                metrics={[
                    { label: 'Total hosts', value: allHosts.length },
                    { label: 'Models', value: topModels.length },
                    { label: 'Images', value: images.length, accent: true },
                    { label: 'Snapins', value: snapinCount },
                ]}
            />

            <Stack>
                <SelectedHostCard
                    key={cardKey}
                    hosts={selectedHosts}
                    images={images}
                    snapins={snapins}
                    taskTypes={taskTypes}
                    deployTaskTypeId={deployTaskTypeId}
                    captureTaskTypeId={captureTaskTypeId}
                    onHostsDeleted={handleHostsDeleted}
                    onHostUpdated={handleHostUpdated}
                    onClose={() => setSelectedIds([])}
                />
                <HostTable
                    allHosts={allHosts}
                    setSelectedIds={setSelectedIds}
                    onDeploy={handleDeploy}
                    onSnapin={handleSnapin}
                    onDelete={handleDelete}
                    loading={loading}
                />
            </Stack>
        </Stack>
    );
}

interface SnapinQuickActionModalProps {
    host: FogHost;
    snapins: FogSnapin[];
    onClose: () => void;
}

function SnapinQuickActionModal({
    host,
    snapins,
    onClose,
}: SnapinQuickActionModalProps) {
    const [selectedSnapinId, setSelectedSnapinId] = useState<string | null>(
        null,
    );
    const [loading, setLoading] = useState(false);

    const handleSend = async () => {
        if (!selectedSnapinId) return;
        const snapinId = parseInt(selectedSnapinId, 10);
        setLoading(true);

        try {
            await createFogSnapinTask(host.id, snapinId);
            notifications.show({
                color: 'green',
                title: 'Snapin Sent',
                message: `Snapin sent to host ${host.name}`,
                icon: <IconCheck size={16} />,
            });
            onClose();
        } catch {
            notifications.show({
                color: 'red',
                title: 'Snapin Failed',
                message: `Failed to send snapin to host ${host.name}`,
                icon: <IconX size={16} />,
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Stack gap='sm'>
            <Text size='sm'>
                Select a snapin to send to host <strong>{host.name}</strong>.
            </Text>
            <Select
                label='Select snapin'
                placeholder='Choose snapin…'
                data={snapins.map((s) => ({
                    value: String(s.id),
                    label: s.name,
                }))}
                value={selectedSnapinId}
                onChange={setSelectedSnapinId}
                clearable
                searchable
                nothingFoundMessage='No snapins found'
            />
            <Group justify='flex-end' gap='xs' mt='md'>
                <Button variant='default' onClick={onClose} disabled={loading}>
                    Cancel
                </Button>
                <Button
                    onClick={handleSend}
                    disabled={!selectedSnapinId}
                    loading={loading}
                >
                    Send
                </Button>
            </Group>
        </Stack>
    );
}

export default ManagementTab;
