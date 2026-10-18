import { betterFetch } from '@better-fetch/fetch';
import { Badge, Button, Card, Group, Stack, TextInput, Title } from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import z from 'zod';
import { FirewallConfig } from './FirewallSettings';

const mikrotikSchema = z.object({
    id: z.string().optional(),
    mikrotikBaseUrl: z.url(),
    mikrotikUsername: z.string(),
    mikrotikPassword: z.string(),
});

export function MikroTikSettings({
    config,
    setFirewallConfig,
    onSaved,
}: {
    config?: FirewallConfig;
    setFirewallConfig: (config: FirewallConfig) => void;
    onSaved: () => void;
}) {
    const [saving, setSaving] = useState(false);

    const saveConfig = async (values: z.infer<typeof mikrotikSchema>) => {
        try {
            const { data, error } = await betterFetch<{
                data: FirewallConfig;
            }>('/api/settings/mikrotik', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(values),
            });

            if (error) {
                const message =
                    error?.message ??
                    'Failed to save MikroTik settings. Please try again.';
                notifications.show({
                    title: 'Error',
                    message,
                    color: 'red',
                    icon: <IconX size={16} />,
                });
                console.error(error);
                return;
            }

            notifications.show({
                title: 'Success',
                message: 'MikroTik configuration saved successfully!',
                color: 'green',
                icon: <IconCheck size={16} />,
            });

            setFirewallConfig(data.data);
            const savedValues = {
                mikrotikBaseUrl: values.mikrotikBaseUrl,
                mikrotikUsername: values.mikrotikUsername,
                mikrotikPassword: '',
            };
            form.setValues(savedValues);
            form.resetDirty(savedValues);
            onSaved();
        } catch (err) {
            notifications.show({
                title: 'Error',
                message: 'Failed to save MikroTik settings. Please try again.',
                color: 'red',
                icon: <IconX size={16} />,
            });
            console.error(err);
        }
    };

    const form = useForm({
        initialValues: {
            mikrotikBaseUrl: config?.mikrotikBaseUrl ?? '',
            mikrotikUsername: config?.mikrotikUsername ?? '',
            mikrotikPassword: '',
        },
        validate: schemaResolver(mikrotikSchema),
        transformValues: (values) => ({
            ...values,
            id: config?.id,
        }),
    });

    useEffect(() => {
        if (config && !form.isDirty()) {
            const values = {
                mikrotikBaseUrl: config.mikrotikBaseUrl ?? '',
                mikrotikUsername: config.mikrotikUsername ?? '',
                mikrotikPassword: '',
            };
            form.setValues(values);
            form.resetDirty(values);
        }
    }, [config]);

    async function submit(values: z.infer<typeof mikrotikSchema>) {
        setSaving(true);
        try {
            await saveConfig(values);
        } finally {
            setSaving(false);
        }
    }

    return (
        <Card withBorder p='md'>
            <Group justify='space-between' mb='md'>
                <Title order={5}>MikroTik Configuration</Title>
                {config?.mikrotikBaseUrl && config.mikrotikPassword ? <Badge color='teal'>Configured</Badge> : null}
            </Group>

            <form onSubmit={form.onSubmit(submit)}>
                <Stack gap='sm'>
                    <TextInput
                        label='Base URL'
                        placeholder='http://192.168.1.1'
                        required
                        {...form.getInputProps('mikrotikBaseUrl')}
                    />
                    <TextInput
                        label='Username'
                        placeholder='admin'
                        {...form.getInputProps('mikrotikUsername')}
                        required
                    />
                    <TextInput
                        label='Password'
                        type='password'
                        {...form.getInputProps('mikrotikPassword')}
                        placeholder={config?.mikrotikPassword ? '********' : 'Enter password'}
                        description='Re-enter the router password to test and save changes.'
                        required
                    />

                    <Group gap='xs' mt='md'>
                        <Button type='submit' loading={saving}>
                            Save Configuration
                        </Button>
                    </Group>
                </Stack>
            </form>
        </Card>
    );
}
