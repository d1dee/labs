import { OrganizationSettings } from '@/components/settings/OrganizationSettings';
import { useSessionContext } from '@/context/SessionContext';
import { Modal, Stack, Tabs, Text, Title } from '@mantine/core';
import { FC } from 'react';
import { FirewallSettings } from '../components/settings/FirewallSettings';

interface SettingsProps {
    opened: boolean;
    onClose: () => void;
}

const Settings: FC<SettingsProps> = ({ opened, onClose }) => {
    const { organization } = useSessionContext();

    return (
        <Modal
            opened={opened}
            onClose={onClose}
            title={
                <>
                    <Title order={3}>Settings</Title>
                    <Text size='sm' color='dimmed'>
                        Manage your organization and firewall configuration
                    </Text>
                </>
            }
            size='lg'
            centered
        >
            <Stack pos='relative'>
                <Tabs defaultValue='organization'>
                    <Tabs.List>
                        <Tabs.Tab value='organization'>Organization</Tabs.Tab>
                        <Tabs.Tab value='firewall' disabled={!organization}>
                            Firewall
                        </Tabs.Tab>
                    </Tabs.List>

                    <Tabs.Panel value='organization' pt='md'>
                        <OrganizationSettings />
                    </Tabs.Panel>

                    <Tabs.Panel value='firewall' pt='md'>
                        <FirewallSettings />
                    </Tabs.Panel>
                </Tabs>
            </Stack>
        </Modal>
    );
};

export default Settings;
