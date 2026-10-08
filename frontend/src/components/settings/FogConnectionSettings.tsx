import {
    type FogSettingsConfig,
    saveFogSettings,
} from '@/api/fog';
import { useApiStream } from '@/api/useApiStream';
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
import { type FC, useRef, useState } from 'react';

interface Props {
    onSaved?: () => void;
    enabled?: boolean;
}

export const FogConnectionSettings: FC<Props> = ({ onSaved, enabled = true }) => {
    const [url, setUrl] = useState('');
    const [apiToken, setApiToken] = useState('');
    const [userToken, setUserToken] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const seeded = useRef(false);
    const refresh = useApiStream<FogSettingsConfig>(enabled ? '/api/settings/fog' : null, (cfg) => {
        if (!seeded.current) {
            setUrl(cfg.url);
            seeded.current = true;
        }
        setLoading(false);
    }, () => setLoading(false));

    const handleSave = async () => {
        if (!url.trim() || !apiToken.trim()) return;
        if (!bearerMode && !userToken.trim()) return;
        setSaving(true);
        try {
            await saveFogSettings(
                url.trim(),
                apiToken.trim(),
                bearerMode ? '' : userToken,
            );
            notifications.show({
                title: 'Success',
                message: 'FOG connection saved and verified.',
                color: 'green',
                icon: <IconCheck size={16} />,
            });
            setApiToken('');
            setUserToken('');
            refresh();
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

    // FOG 1.6 bearer tokens (fog_ prefixed) authenticate on their own; the
    // user token is only needed for legacy fog-api-token header auth.
    const bearerMode = apiToken.trimStart().startsWith('fog_');
    const ready =
        url.trim() && apiToken.trim() && (bearerMode || userToken.trim());

    return (
        <Card withBorder p='md'>
            <Stack gap='sm'>
                <Title order={5}>FOG Connection</Title>
                <TextInput
                    label='FOG URL'
                    placeholder='https://fog.example.edu'
                    value={url}
                    onChange={(e) => { seeded.current = true; setUrl(e.currentTarget.value); }}
                    disabled={loading}
                    required
                />
                <TextInput
                    label='API Token'
                    description='FOG 1.6: bearer token from the user API tab (starts with "fog_")'
                    placeholder='fog_… or legacy fog-api-token'
                    value={apiToken}
                    onChange={(e) => setApiToken(e.currentTarget.value)}
                    required
                />
                {!bearerMode && (
                    <TextInput
                        label='User Token'
                        description='Required for legacy (non-bearer) API tokens'
                        placeholder='fog-user-token'
                        value={userToken}
                        onChange={(e) => setUserToken(e.currentTarget.value)}
                        required
                    />
                )}
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
