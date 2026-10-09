import { useApiStream } from '@/api/useApiStream';
import { Alert, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconInfoCircle, IconX } from '@tabler/icons-react';
import { useState } from 'react';
import { z } from 'zod';
import { LabsSettings } from './LabsSettings';
import { MikroTikSettings } from './MikrotikSettings';

export interface Lab {
    id: string;
    name: string;
    dhcpServer: string;
    subnet: string;
    ruleId: string;
    interface?: string;
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

export function FirewallSettings({ enabled = true }: { enabled?: boolean }) {
    const [initialLoading, setInitialLoading] = useState(true);
    const [configMissing, setConfigMissing] = useState(true);
    const [firewallConfig, setFirewallConfig] = useState<
        FirewallConfig | undefined
    >(undefined);

    const refresh = useApiStream<FirewallConfig>(enabled ? '/api/settings/firewall' : null, (data) => {
        setConfigMissing(false);
        setFirewallConfig(data);
        setInitialLoading(false);
    }, (err) => {
        setInitialLoading(false);
        if (err.code === 'CONFIG_MISSING') {
            setConfigMissing(true);
            setFirewallConfig(undefined);
        } else {
            notifications.show({
                title: 'Error',
                message: 'Failed to load firewall settings.',
                color: 'red',
                icon: <IconX size={16} />,
            });
            console.error(err);
        }
    });

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
                onSaved={refresh}
            />
            <LabsSettings firewallConfig={firewallConfig} enabled={enabled} onSaved={refresh} />
        </Stack>
    );
}
