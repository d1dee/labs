import { getPiholeStatus } from '@/api/pihole';
import { Alert, Center, Divider, Loader, Stack, Text } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { type FC, useCallback, useEffect, useState } from 'react';
import { PiholeConnectionSettings } from './PiholeConnectionSettings';
import { PiholeDnsListTabs } from './PiholeDnsSettings';

export const PiholeSettings: FC = () => {
    const [configured, setConfigured] = useState<boolean | null>(null);
    const [version, setVersion] = useState(0);

    const reload = useCallback(async () => {
        try {
            const status = await getPiholeStatus();
            setConfigured(status.configured);
        } catch {
            setConfigured(false);
        }
        setVersion((v) => v + 1);
    }, []);

    useEffect(() => {
        reload();
    }, [reload]);

    if (configured === null) {
        return (
            <Center py={40}>
                <Loader />
            </Center>
        );
    }

    return (
        <Stack gap='md'>
            <PiholeConnectionSettings onSaved={reload} />

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
                    <PiholeDnsListTabs key={version} />
                </>
            )}
        </Stack>
    );
};
