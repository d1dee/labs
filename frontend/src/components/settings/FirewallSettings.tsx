import { betterFetch } from '@better-fetch/fetch';
import { Alert, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconInfoCircle, IconX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { LabsSettings } from './LabsSettings';
import { MikroTikSettings } from './MikrotikSettings';

export interface Lab {
    id: string;
    name: string;
    dhcpServer: string;
    subnet: string;
    ruleId: string;
}

export interface FirewallConfig {
    id?: string;
    mikrotikBaseUrl: string;
    mikrotikUsername: string;
    mikrotikPassword: string;
    mikrotikInsecure: boolean;
    labs?: Lab[];
}

export const configSchema = z.object({
    id: z.string().optional(),
    mikrotikBaseUrl: z.url(),
    mikrotikUsername: z.string(),
    mikrotikPassword: z.string(),

    labs: z
        .array(
            z.object({
                name: z.string(),
                ruleId: z.string(),
            }),
        )
        .optional(),
});

export function FirewallSettings() {
    const [initialLoading, setInitialLoading] = useState(true);
    const [configMissing, setConfigMissing] = useState(true);
    const [firewallConfig, setFirewallConfig] = useState<
        FirewallConfig | undefined
    >(undefined);

    const loadFirewallConfig = async (): Promise<void> => {
        setConfigMissing(false);
        try {
            const { data, error } = await betterFetch<
                FirewallConfig,
                { message?: string; error?: string; code?: string }
            >('/api/settings/firewall');

            if (error) {
                if (error.code === 'CONFIG_MISSING') {
                    setConfigMissing(true);
                    return;
                }
                throw new Error(
                    error.error || 'Failed to load firewall settings',
                );
            }

            setFirewallConfig(data);
        } catch (err) {
            notifications.show({
                title: 'Error',
                message: 'Failed to load firewall settings.',
                color: 'red',
                icon: <IconX size={16} />,
            });
            console.error(err);
        } finally {
            setInitialLoading(false);
        }
    };

    useEffect(() => {
        loadFirewallConfig();
    }, []);

    return (
        <Stack gap='md'>
            {configMissing && !initialLoading && (
                <Alert
                    variant='light'
                    color='yellow'
                    title='Configuration Required'
                    icon={<IconInfoCircle size={16} />}
                    mb='md'
                >
                    <Text size='sm'>
                        No firewall configuration found. Please enter your
                        MikroTik details and add labs to get started.
                    </Text>
                </Alert>
            )}
            <MikroTikSettings
                config={firewallConfig}
                setFirewallConfig={setFirewallConfig}
            />
            <LabsSettings firewallConfig={firewallConfig} />
        </Stack>
    );
}
