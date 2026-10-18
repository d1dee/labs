import { type PiholeSettingsConfig, savePiholeSettings } from '@/api/pihole';
import { useApiStream } from '@/api/useApiStream';
import { Badge, Button, Card, Checkbox, Group, Stack, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconX } from '@tabler/icons-react';
import { type FC, useRef, useState } from 'react';

interface Props {
    onSaved?: () => void;
    enabled?: boolean;
}

export const PiholeConnectionSettings: FC<Props> = ({ onSaved, enabled = true }) => {
    const [url, setUrl] = useState('');
    const [password, setPassword] = useState('');
    const [verifyTls, setVerifyTls] = useState(true);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [savedConfig, setSavedConfig] = useState<PiholeSettingsConfig | null>(null);

    const seeded = useRef(false);
    const refresh = useApiStream<PiholeSettingsConfig>(enabled ? '/api/settings/pihole' : null, (cfg) => {
        setSavedConfig(cfg);
        if (!seeded.current) {
            setUrl(cfg.url);
            setVerifyTls(cfg.verifyTls ?? true);
            seeded.current = true;
        }
        setLoading(false);
    }, () => setLoading(false));

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

    return (
        <Card withBorder p='md'>
            <Stack gap='sm'>
                <Group justify='space-between'>
                    <Title order={5}>Pi-hole Connection</Title>
                    {savedConfig?.configured ? <Badge color='teal'>Configured</Badge> : null}
                </Group>
                <TextInput
                    label='Pi-hole URL'
                    placeholder='https://192.168.1.xx'
                    value={url}
                    onChange={(e) => { seeded.current = true; setUrl(e.currentTarget.value); }}
                    disabled={loading}
                    required
                />
                <TextInput
                    label='Web Interface Password'
                    type='password'
                    placeholder={savedConfig?.password ? '********' : 'Enter password'}
                    description={savedConfig?.password ? 'Password is set. Re-enter it to test and save changes.' : undefined}
                    value={password}
                    onChange={(e) => setPassword(e.currentTarget.value)}
                    required
                />
                <Checkbox
                    label='Verify the Pi-hole TLS certificate'
                    checked={verifyTls}
                    onChange={(event) => { seeded.current = true; setVerifyTls(event.currentTarget.checked); }}
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
