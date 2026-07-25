import {
    getFogSettings,
    saveFogSettings,
} from '@/api/fog';
import {
    Button,
    Card,
    Group,
    Stack,
    TextInput,
    Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconX } from '@tabler/icons-react';
import { type FC, useEffect, useState } from 'react';

interface Props {
    onSaved?: () => void;
}

export const FogConnectionSettings: FC<Props> = ({ onSaved }) => {
    const [url, setUrl] = useState('');
    const [apiToken, setApiToken] = useState('');
    const [userToken, setUserToken] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        getFogSettings()
            .then((cfg) => setUrl(cfg.url))
            .catch(() => {
                /* not configured yet */
            })
            .finally(() => setLoading(false));
    }, []);

    const handleSave = async () => {
        if (!url.trim() || !apiToken.trim() || !userToken.trim()) return;
        setSaving(true);
        try {
            await saveFogSettings(url.trim(), apiToken, userToken);
            notifications.show({
                title: 'Success',
                message: 'FOG connection saved and verified.',
                color: 'green',
                icon: <IconCheck size={16} />,
            });
            setApiToken('');
            setUserToken('');
            onSaved?.();
        } catch (err) {
            notifications.show({
                title: 'Error',
                message: String(err),
                color: 'red',
                icon: <IconX size={16} />,
            });
        } finally {
            setSaving(false);
        }
    };

    const ready = url.trim() && apiToken.trim() && userToken.trim();

    return (
        <Card withBorder p='md'>
            <Stack gap='sm'>
                <Title order={5}>FOG Connection</Title>
                <TextInput
                    label='FOG URL'
                    placeholder='https://fog.example.edu'
                    value={url}
                    onChange={(e) => setUrl(e.currentTarget.value)}
                    disabled={loading}
                    required
                />
                <TextInput
                    label='API Token'
                    placeholder='fog-api-token'
                    value={apiToken}
                    onChange={(e) => setApiToken(e.currentTarget.value)}
                    required
                />
                <TextInput
                    label='User Token'
                    placeholder='fog-user-token'
                    value={userToken}
                    onChange={(e) => setUserToken(e.currentTarget.value)}
                    required
                />
                <Group gap='xs' mt='xs'>
                    <Button
                        onClick={handleSave}
                        loading={saving}
                        disabled={loading || !ready}
                    >
                        Test &amp; Save
                    </Button>
                </Group>
            </Stack>
        </Card>
    );
};
