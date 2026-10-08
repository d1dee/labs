import { FogConnectionSettings } from '@/components/settings/FogConnectionSettings';
import { OrganizationSettings } from '@/components/settings/OrganizationSettings';
import { PiholeSettings } from '@/components/settings/PiholeSettings';
import { VeyonConnectionSettings } from '@/components/settings/VeyonConnectionSettings';
import { useSessionContext } from '@/context/SessionContext';
import { Modal, Stack, Tabs, Text, Title } from '@mantine/core';
import { FC, useState } from 'react';
import { FirewallSettings } from '../components/settings/FirewallSettings';

interface SettingsProps {
    opened: boolean;
    onClose: () => void;
}

const Settings: FC<SettingsProps> = ({ opened, onClose }) => {
    const { organization } = useSessionContext();
    const [activeTab, setActiveTab] = useState<string | null>('organization');

    return (
        <Modal
            opened={opened}
            onClose={onClose}
            closeButtonProps={{ 'aria-label': 'Close settings' }}
            title={
                <>
                    <Title component='span' order={3}>Settings</Title>
                    <Text component='span' display='block' size='sm' color='dimmed'>
                        Manage your organization and firewall configuration
                    </Text>
                </>
            }
            size='lg'
            centered
        >
            <Stack pos='relative'>
                <Tabs value={activeTab} onChange={setActiveTab} keepMounted keepMountedMode='display-none'>
                    <Tabs.List>
                        <Tabs.Tab value='organization'>Organization</Tabs.Tab>
                        <Tabs.Tab value='firewall' disabled={!organization}>
                            Firewall
                        </Tabs.Tab>
                        <Tabs.Tab value='pihole'>DNS</Tabs.Tab>
                        <Tabs.Tab value='fog'>FOG</Tabs.Tab>
                        <Tabs.Tab value='veyon'>Veyon</Tabs.Tab>
                    </Tabs.List>
                    <Tabs.Panel value='organization' pt='md'>
                        <OrganizationSettings enabled={opened && activeTab === 'organization'} />
                    </Tabs.Panel>
                    <Tabs.Panel value='firewall' pt='md'>
                        <FirewallSettings key={organization?.id ?? 'none'} enabled={opened && activeTab === 'firewall' && !!organization} />
                    </Tabs.Panel>
                    <Tabs.Panel value='pihole' pt='md'>
                        <PiholeSettings key={organization?.id ?? 'none'} enabled={opened && activeTab === 'pihole' && !!organization} />
                    </Tabs.Panel>
                    <Tabs.Panel value='fog' pt='md'>
                        <FogConnectionSettings key={organization?.id ?? 'none'} enabled={opened && activeTab === 'fog' && !!organization} />
                    </Tabs.Panel>
                    <Tabs.Panel value='veyon' pt='md'>
                        <VeyonConnectionSettings key={organization?.id ?? 'none'} enabled={opened && activeTab === 'veyon' && !!organization} />
                    </Tabs.Panel>
                </Tabs>
            </Stack>
        </Modal>
    );
};

export default Settings;
