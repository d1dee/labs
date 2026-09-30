import {
    deleteVeyonSettings,
    getVeyonSettings,
    saveVeyonSettings,
} from '@/api/veyon';
import {
    Alert,
    Badge,
    Button,
    Card,
    Checkbox,
    FileButton,
    Group,
    Stack,
    Text,
    Textarea,
    TextInput,
    Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconInfoCircle, IconTrash, IconUpload, IconX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';

export function VeyonConnectionSettings() {
    const [url, setUrl] = useState('http://localhost:11080');
    const [keyName, setKeyName] = useState('teacher');
    const [keyData, setKeyData] = useState('');
    const [keyFileName, setKeyFileName] = useState('');
    const [keyConfigured, setKeyConfigured] = useState(false);
    const [configured, setConfigured] = useState(false);
    const [testHost, setTestHost] = useState('localhost');
    const [verifyTls, setVerifyTls] = useState(true);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [removing, setRemoving] = useState(false);

    useEffect(() => {
        getVeyonSettings()
            .then((settings) => {
                if (settings.url) setUrl(settings.url);
                if (settings.keyName) setKeyName(settings.keyName);
                setVerifyTls(settings.verifyTls);
                setKeyConfigured(settings.keyConfigured);
                setConfigured(settings.configured);
            })
            .finally(() => setLoading(false));
    }, []);

    const onKeyFile = async (file: File | null) => {
        if (!file) return;
        setKeyFileName(file.name);
        setKeyData(await file.text());
    };

    const save = async () => {
        setSaving(true);
        try {
            await saveVeyonSettings({
                url: url.trim(),
                keyName: keyName.trim(),
                keyData: keyData.trim() || undefined,
                verifyTls,
                testHost: testHost.trim(),
            });
            setKeyData('');
            setKeyFileName('');
            setKeyConfigured(true);
            setConfigured(true);
            notifications.show({
                color: 'teal',
                title: 'Veyon connected',
                message: `Key authentication succeeded for ${testHost}.`,
                icon: <IconCheck size={16} />,
            });
        } catch (error) {
            notifications.show({
                color: 'red',
                title: 'Connection failed',
                message: error instanceof Error ? error.message : String(error),
                icon: <IconX size={16} />,
            });
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        setRemoving(true);
        try {
            await deleteVeyonSettings();
            setKeyData('');
            setKeyFileName('');
            setKeyConfigured(false);
            setConfigured(false);
            notifications.show({
                color: 'teal',
                title: 'Configuration removed',
                message: 'The stored private key was deleted.',
                icon: <IconCheck size={16} />,
            });
        } catch (error) {
            notifications.show({
                color: 'red',
                title: 'Removal failed',
                message: error instanceof Error ? error.message : String(error),
                icon: <IconX size={16} />,
            });
        } finally {
            setRemoving(false);
        }
    };

    const canSave =
        !loading &&
        url.trim().length > 0 &&
        keyName.trim().length > 0 &&
        testHost.trim().length > 0 &&
        (keyData.trim().length > 0 || keyConfigured);

    return (
        <Card withBorder p='md'>
            <Stack gap='sm'>
                <Group justify='space-between'>
                    <div>
                        <Title order={5}>Veyon WebAPI proxy</Title>
                        <Text size='sm' c='dimmed'>
                            Key file authentication only — the PEM private key stays on the
                            server, scoped to this organization.
                        </Text>
                    </div>
                    {configured ? <Badge color='teal'>Configured</Badge> : null}
                </Group>
                <Alert color='blue' variant='light' icon={<IconInfoCircle size={18} />}>
                    Enable the Veyon WebAPI plugin (default port 11080) and set the
                    authentication method to <b>Key file authentication</b> on all Veyon
                    Servers. The public key must be deployed on every target under the key
                    name below; the WebAPI server signs each challenge with this private
                    key.
                </Alert>
                <TextInput
                    label='WebAPI URL'
                    placeholder='https://veyon-proxy.example.edu:11080'
                    value={url}
                    onChange={(event) => setUrl(event.currentTarget.value)}
                    disabled={loading}
                    required
                />
                <TextInput
                    label='Key name'
                    description='Name of the key pair created with veyon-cli authkeys create (e.g. "teacher")'
                    value={keyName}
                    onChange={(event) => setKeyName(event.currentTarget.value)}
                    required
                />
                <Textarea
                    label='PEM private key'
                    description={
                        keyConfigured
                            ? 'Leave empty to keep the stored private key'
                            : 'Paste the private key PEM or upload the key file'
                    }
                    placeholder='-----BEGIN PRIVATE KEY-----'
                    value={keyData}
                    onChange={(event) => setKeyData(event.currentTarget.value)}
                    minRows={5}
                    autosize
                />
                <Group>
                    <FileButton onChange={onKeyFile} accept='.pem,.key,text/plain'>
                        {(props) => (
                            <Button
                                {...props}
                                variant='light'
                                leftSection={<IconUpload size={16} />}
                            >
                                Upload private key file
                            </Button>
                        )}
                    </FileButton>
                    {keyFileName ? (
                        <Text size='sm' c='dimmed'>
                            {keyFileName}
                        </Text>
                    ) : null}
                </Group>
                <TextInput
                    label='Test target host'
                    description='A Veyon-managed computer reachable through the proxy'
                    value={testHost}
                    onChange={(event) => setTestHost(event.currentTarget.value)}
                    required
                />
                <Checkbox
                    label='Verify the WebAPI TLS certificate'
                    checked={verifyTls}
                    onChange={(event) => setVerifyTls(event.currentTarget.checked)}
                />
                <Group>
                    <Button onClick={save} loading={saving} disabled={!canSave}>
                        Test &amp; save
                    </Button>
                    {configured ? (
                        <Button
                            onClick={remove}
                            loading={removing}
                            color='red'
                            variant='light'
                            leftSection={<IconTrash size={16} />}
                        >
                            Remove configuration
                        </Button>
                    ) : null}
                </Group>
            </Stack>
        </Card>
    );
}
