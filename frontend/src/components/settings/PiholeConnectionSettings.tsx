import { getPiholeSettings, savePiholeSettings } from '@/api/pihole';
import { Button, Card, Checkbox, Group, Stack, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconX } from '@tabler/icons-react';
import { type FC, useEffect, useState } from 'react';

interface Props {
    onSaved?: () => void;
}

export const PiholeConnectionSettings: FC<Props> = ({ onSaved }) => {
    const [url, setUrl] = useState('');
    const [password, setPassword] = useState('');
    const [verifyTls, setVerifyTls] = useState(true);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        getPiholeSettings()
            .then((cfg) => {
                setUrl(cfg.url);
                setVerifyTls(cfg.verifyTls ?? true);
            })
            .catch(() => {
                /* not configured yet */
            })
            .finally(() => setLoading(false));
    }, []);

    const handleSave = async () => {
        if (!url.trim() || !password.trim()) return;
        setSaving(true);
        try {
            await savePiholeSettings(url.trim(), password, verifyTls);
            notifications.show({
                title: 'Success',
                message: 'Pi-hole connection saved and verified.',
                color: 'green',
                icon: <IconCheck size={16} />,
            });
            setPassword('');
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

    return (
        <Card withBorder p='md'>
            <Stack gap='sm'>
                <Title order={5}>Pi-hole Connection</Title>
                <TextInput
                    label='Pi-hole URL'
                    placeholder='https://192.168.1.xx'
                    value={url}
                    onChange={(e) => setUrl(e.currentTarget.value)}
                    disabled={loading}
                    required
                />
                <TextInput
                    label='Web Interface Password'
                    type='password'
                    placeholder='Enter password'
                    value={password}
                    onChange={(e) => setPassword(e.currentTarget.value)}
                    required
                />
                <Checkbox
                    label='Verify the Pi-hole TLS certificate'
                    checked={verifyTls}
                    onChange={(event) => setVerifyTls(event.currentTarget.checked)}
                    disabled={loading}
                />
                {!verifyTls && (
                    <Text size='sm' c='orange'>
                        Warning: Disabling TLS certificate verification allows attackers to impersonate your Pi-hole server and steal your password.
                    </Text>
                )}
                <Group gap='xs' mt='xs'>
                    <Button
                        onClick={handleSave}
                        loading={saving}
                        disabled={loading || !url.trim()}
                    >
                        Test &amp; Save
                    </Button>
                </Group>
            </Stack>
        </Card>
    );
};
