import {
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
import {
    Alert,
    Button,
    Card,
    Center,
    Group,
    Loader,
    SimpleGrid,
    Stack,
    Text,
    Title,
} from '@mantine/core';
import { IconAlertCircle, IconRefresh } from '@tabler/icons-react';
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
            setAllHosts(hosts.hosts);
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

    // O(1) lookup set for selected IDs
    const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

    // Derive the actual FogHost objects for selected IDs — O(n)
    const selectedHosts = useMemo(
        () => allHosts.filter((h) => selectedSet.has(h.id)),
        [allHosts, selectedSet],
    );

    // Memoised stat counts — single pass
    const { onlineCount, offlineCount } = useMemo(
        () =>
            allHosts.reduce(
                (acc, h) => {
                    if (h.pingstatuscode === 0) acc.onlineCount++;
                    else if (h.pingstatuscode === 1) acc.offlineCount++;
                    return acc;
                },
                { onlineCount: 0, offlineCount: 0 },
            ),
        [allHosts],
    );

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
            <Stack>
                <Group justify='space-between'>
                    <Title order={4}>Host Overview</Title>{' '}
                    <Button
                        size='xs'
                        leftSection={<IconRefresh size={14} />}
                        onClick={loadAll}
                        loading={loading}
                    >
                        Refresh
                    </Button>
                </Group>
                <SimpleGrid cols={{ base: 2, md: 4 }} spacing='md'>
                    <Card withBorder>
                        <Text size='sm' c='dimmed'>
                            Total Hosts
                        </Text>
                        <Text size='xl' fw={700}>
                            {allHosts.length}
                        </Text>
                    </Card>
                    <Card withBorder>
                        <Text size='sm' c='dimmed'>
                            Online
                        </Text>
                        <Text size='xl' fw={700} c='green'>
                            {onlineCount}
                        </Text>
                    </Card>
                    <Card withBorder>
                        <Text size='sm' c='dimmed'>
                            Offline
                        </Text>
                        <Text size='xl' fw={700} c='red'>
                            {offlineCount}
                        </Text>
                    </Card>
                    <Card withBorder>
                        <Text size='sm' c='dimmed'>
                            Images
                        </Text>
                        <Text size='xl' fw={700}>
                            {images.length}
                        </Text>
                    </Card>
                </SimpleGrid>
            </Stack>

            <Stack>
                <div>
                    <Title order={5}>Registered Hosts</Title>
                    <Text size='sm' c='dimmed'>
                        Select one or more hosts to perform actions.
                    </Text>
                </div>

                <HostTable
                    allHosts={allHosts}
                    selectedIds={selectedIds}
                    onSelectionChange={setSelectedIds}
                />

                {selectedHosts.length > 0 && (
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
                )}
            </Stack>
        </Stack>
    );
}

export default ManagementTab;
