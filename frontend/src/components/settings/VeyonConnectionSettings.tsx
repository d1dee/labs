import {
    getVeyonSettings,
    saveVeyonSettings,
    VEYON_AUTH_METHODS,
} from '@/api/veyon';
import {
    Alert,
    Button,
    Card,
    Checkbox,
    PasswordInput,
    Select,
    Stack,
    Text,
    Textarea,
    TextInput,
    Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconInfoCircle, IconX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';

const methodOptions = [
    { value: VEYON_AUTH_METHODS.logon, label: 'System logon' },
    { value: VEYON_AUTH_METHODS.authKeys, label: 'Authentication key' },
    { value: VEYON_AUTH_METHODS.ldap, label: 'LDAP (Veyon 5+)' },
    { value: VEYON_AUTH_METHODS.simple, label: 'Master password (Veyon 5+)' },
];

export function VeyonConnectionSettings() {
    const [url, setUrl] = useState('http://localhost:11080');
    const [authMethod, setAuthMethod] = useState<string>(VEYON_AUTH_METHODS.logon);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [keyName, setKeyName] = useState('teacher');
    const [keyData, setKeyData] = useState('');
    const [testHost, setTestHost] = useState('localhost');
    const [verifyTls, setVerifyTls] = useState(true);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        getVeyonSettings()
            .then((settings) => {
                if (settings.url) setUrl(settings.url);
                setAuthMethod(settings.authMethod);
                setUsername(settings.username);
                if (settings.keyName) setKeyName(settings.keyName);
                setVerifyTls(settings.verifyTls);
            })
            .finally(() => setLoading(false));
    }, []);

    const usesKey = authMethod === VEYON_AUTH_METHODS.authKeys;
    const usesUsername = [VEYON_AUTH_METHODS.logon, VEYON_AUTH_METHODS.ldap].includes(
        authMethod as typeof VEYON_AUTH_METHODS.logon,
    );

    const save = async () => {
        setSaving(true);
        try {
            await saveVeyonSettings({
                url: url.trim(),
                authMethod,
                username: username.trim(),
                password,
                keyName: keyName.trim(),
                keyData,
                verifyTls,
                testHost: testHost.trim(),
            });
            setPassword('');
            setKeyData('');
            notifications.show({
                color: 'teal',
                title: 'Veyon connected',
                message: `Authentication succeeded for ${testHost}.`,
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

    return (
        <Card withBorder p='md'>
            <Stack gap='sm'>
                <div>
                    <Title order={5}>Veyon WebAPI proxy</Title>
                    <Text size='sm' c='dimmed'>
                        Credentials are stored on the server and scoped to this organization.
                    </Text>
                </div>
                <Alert color='blue' variant='light' icon={<IconInfoCircle size={18} />}>
                    Enable the Veyon WebAPI plugin in proxy mode. Its default port is 11080.
                </Alert>
                <TextInput
                    label='WebAPI URL'
                    placeholder='https://veyon-proxy.example.edu:11080'
                    value={url}
                    onChange={(event) => setUrl(event.currentTarget.value)}
                    disabled={loading}
                    required
                />
                <Select
                    label='Veyon authentication method'
                    data={methodOptions}
                    value={authMethod}
                    onChange={(value) => value && setAuthMethod(value)}
                    allowDeselect={false}
                />
                {usesUsername ? (
                    <TextInput
                        label='Username'
                        value={username}
                        onChange={(event) => setUsername(event.currentTarget.value)}
                        required
                    />
                ) : null}
                {usesKey ? (
                    <>
                        <TextInput
                            label='Key name'
                            value={keyName}
                            onChange={(event) => setKeyName(event.currentTarget.value)}
                            required
                        />
                        <Textarea
                            label='PEM private key'
                            placeholder='-----BEGIN PRIVATE KEY-----'
                            value={keyData}
                            onChange={(event) => setKeyData(event.currentTarget.value)}
                            minRows={5}
                            autosize
                            required
                        />
                    </>
                ) : (
                    <PasswordInput
                        label={usesUsername ? 'Password' : 'Master password'}
                        value={password}
                        onChange={(event) => setPassword(event.currentTarget.value)}
                        required
                    />
                )}
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
                <Button
                    onClick={save}
                    loading={saving}
                    disabled={loading || !url.trim() || !testHost.trim()}
                    w='fit-content'
                >
                    Test &amp; save
                </Button>
            </Stack>
        </Card>
    );
}
