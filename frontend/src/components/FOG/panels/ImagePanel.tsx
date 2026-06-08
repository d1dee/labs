import type { FogHost, FogImage } from '@/api/fog';
import { getFogHost, updateFogHost } from '@/api/fog';
import { Button, Group, Select, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconX } from '@tabler/icons-react';
import { useState } from 'react';

interface Props {
    hosts: FogHost[];
    images: FogImage[];
    onDone: (updatedHost?: FogHost) => void;
    onImageAssigned?: (hosts: FogHost[]) => void;
}

export function ImagePanel({ hosts, images, onDone, onImageAssigned }: Props) {
    const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const isBulk = hosts.length > 1;
    const selectedImage = images.find(
        (img) => String(img.id) === selectedImageId,
    );

    const handleAssign = async () => {
        if (!selectedImageId) return;
        const imageId = parseInt(selectedImageId, 10);
        setLoading(true);

        if (isBulk) {
            const results = await Promise.allSettled(
                hosts.map((host) =>
                    updateFogHost(host.id, { imageID: imageId }),
                ),
            );
            const succeeded = results.filter(
                (r) => r.status === 'fulfilled',
            ).length;
            const failed = results.filter(
                (r) => r.status === 'rejected',
            ).length;
            if (succeeded > 0) {
                notifications.show({
                    color: 'green',
                    title: 'Images Assigned',
                    message: `Assigned to ${succeeded} host${succeeded !== 1 ? 's' : ''}`,
                    icon: <IconCheck size={16} />,
                });
            }
            if (failed > 0) {
                notifications.show({
                    color: 'red',
                    title: 'Some Assignments Failed',
                    message: `Failed for ${failed} host${failed !== 1 ? 's' : ''}`,
                    icon: <IconX size={16} />,
                });
            }
            setLoading(false);
            if (onImageAssigned) {
                const updated = hosts.map((h) => ({
                    ...h,
                    imageID: imageId,
                    imagename:
                        images.find((img) => img.id === imageId)?.name ||
                        h.imagename,
                }));
                onImageAssigned(updated);
            }
            onDone();
        } else {
            const host = hosts[0];
            try {
                await updateFogHost(host.id, { imageID: imageId });
                notifications.show({
                    color: 'green',
                    title: 'Image Assigned',
                    message: `Image assigned to ${host.name}`,
                    icon: <IconCheck size={16} />,
                });
                const updated = await getFogHost(host.id);
                setLoading(false);
                if (onImageAssigned && updated) {
                    onImageAssigned([updated]);
                }
                onDone(updated);
            } catch (err) {
                notifications.show({
                    color: 'red',
                    title: 'Assignment Failed',
                    message: String(err),
                    icon: <IconX size={16} />,
                });
                setLoading(false);
            }
        }
    };

    return (
        <Stack gap='sm'>
            <Text size='sm' c='dimmed'>
                {isBulk
                    ? `Assign an image to all ${hosts.length} selected hosts.`
                    : `Current image: ${hosts[0]?.imagename || 'None assigned'}`}
            </Text>
            <Select
                label='Select image'
                placeholder='Choose image…'
                data={images.map((img) => ({
                    value: String(img.id),
                    label: img.name,
                }))}
                value={selectedImageId}
                onChange={setSelectedImageId}
                clearable
                searchable
                nothingFoundMessage='No images found'
            />
            {selectedImage?.description && (
                <Text size='xs' c='dimmed'>
                    {selectedImage.description}
                </Text>
            )}
            <Group>
                <Button
                    size='sm'
                    color='blue'
                    onClick={handleAssign}
                    disabled={!selectedImageId}
                    loading={loading}
                >
                    Assign Image
                </Button>
            </Group>
        </Stack>
    );
}
