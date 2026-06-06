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
import { useEffect, useState } from 'react';
import { HostTable } from './HostTable';

function ManagementTab() {
    const [configured, setConfigured] = useState<boolean | null>(null);
    const [images, setImages] = useState<FogImage[]>([]);
    const [taskTypes, setTaskTypes] = useState<FogTaskType[]>([]);
    const [snapins, setSnapins] = useState<FogSnapin[]>([]);
    const [loading, setLoading] = useState(true);
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
    const [allHosts, setAllHosts] = useState<FogHost[]>([]);

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
            setAllHosts(hosts.hosts);

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
                        <Group justify='space-between'>
                            <Text size='xl' fw={700} c='green'>
                                {
                                    allHosts.filter(
                                        (h) => h.pingstatuscode === 0,
                                    ).length
                                }
                            </Text>
                        </Group>
                    </Card>
                    <Card withBorder>
                        <Text size='sm' c='dimmed'>
                            Offline
                        </Text>
                        <Group justify='space-between'>
                            <Text size='xl' fw={700} c='red'>
                                {
                                    allHosts.filter(
                                        (h) => h.pingstatuscode === 1,
                                    ).length
                                }
                            </Text>
                        </Group>
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
                        Select a host to view details or perform actions.
                    </Text>
                </div>
                <HostTable allHosts={allHosts} />
            </Stack>
        </Stack>
    );
}

export default ManagementTab;
