import { useApiStream } from '@/api/useApiStream';
import { Alert, Center, Divider, Loader, Stack, Text } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { type FC, useState } from 'react';
import { PiholeConnectionSettings } from './PiholeConnectionSettings';
import { PiholeDnsListTabs } from './PiholeDnsSettings';

export const PiholeSettings: FC<{ enabled?: boolean }> = ({ enabled = true }) => {
    const [configured, setConfigured] = useState<boolean | null>(null);
    const refresh = useApiStream<{ configured: boolean }>(enabled ? '/api/pihole/status' : null,
        (status) => setConfigured(status.configured),
        () => setConfigured((current) => current ?? false));

    if (configured === null) {
        return (
            <Center py={40}>
                <Loader />
            </Center>
        );
    }

    return (
        <Stack gap='md'>
            <PiholeConnectionSettings enabled={enabled} onSaved={refresh} />

            {!configured && (
                <Alert
                    icon={<IconAlertCircle size={18} />}
                    title='Pi-hole Not Configured'
                    color='yellow'
                >
                    <Text size='sm'>
                        Enter your Pi-hole URL and password above, or set{' '}
                        <code>PIHOLE_URL</code> and <code>PIHOLE_PASSWORD</code>{' '}
                        in the server environment.
                    </Text>
                </Alert>
            )}

            {configured && (
                <>
                    <Divider variant='dotted' />
                    <PiholeDnsListTabs enabled={enabled} />
                </>
            )}
        </Stack>
    );
};
