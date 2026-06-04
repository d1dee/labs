import FormattingTab from '@/components/pihole/FormattingTab';
import ManagementTab from '@/components/pihole/ManagementTab';
import PiholeTab from '@/components/pihole/PiholeTab';
import {
    ActionIcon,
    Anchor,
    AppShell,
    Avatar,
    Container,
    Group,
    Menu,
    Tabs,
    Text,
    Title,
} from '@mantine/core';
import {
    IconKey,
    IconLogout,
    IconNetwork,
    IconSettings,
    IconShieldCheck,
    IconTools,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import { type FC, useState } from 'react';
import FirewallTab from '../components/FirewallTab';

interface DashboardProps {
    userName: string;
    onLogout: () => void;
    onChangePassword: () => void;
}

const Dashboard: FC<DashboardProps> = ({
    userName,
    onLogout,
    onChangePassword,
}) => {
    const [activeTab, setActiveTab] = useState<string | null>('firewall');

    return (
        <AppShell header={{ height: 60 }} footer={{ height: 48 }} padding='md'>
            <AppShell.Header>
                <Container size='xl' h='100%'>
                    <Group justify='space-between' h='100%'>
                        <Title order={3}>Labs FCD</Title>
                        <Group>
                            <Text size='md'>
                                Welcome,{' '}
                                {userName
                                    .split(' ')
                                    .map((v) =>
                                        v.replace(
                                            /^./,
                                            v.charAt(0).toUpperCase(),
                                        ),
                                    )
                                    .join(' ')}
                                !
                            </Text>
                            <Menu shadow='md' width={200} position='bottom-end'>
                                <Menu.Target>
                                    <ActionIcon variant='subtle' size='xl'>
                                        <Avatar
                                            name={userName}
                                            color='initials'
                                        />
                                    </ActionIcon>
                                </Menu.Target>
                                <Menu.Dropdown>
                                    <Menu.Item
                                        leftSection={<IconKey size={16} />}
                                        onClick={onChangePassword}
                                    >
                                        Change Password
                                    </Menu.Item>
                                    <Menu.Divider />
                                    <Menu.Item
                                        leftSection={<IconLogout size={16} />}
                                        onClick={onLogout}
                                        color='red'
                                    >
                                        Logout
                                    </Menu.Item>
                                </Menu.Dropdown>
                            </Menu>
                        </Group>
                    </Group>
                </Container>
            </AppShell.Header>

            <AppShell.Main>
                <Container size='xl'>
                    <Tabs value={activeTab} onChange={setActiveTab} mb='xl'>
                        <Tabs.List>
                            <Tabs.Tab
                                value='firewall'
                                leftSection={<IconShieldCheck size={16} />}
                            >
                                Firewall
                            </Tabs.Tab>
                            <Tabs.Tab
                                value='network-block'
                                leftSection={<IconNetwork size={16} />}
                            >
                                Network Block
                            </Tabs.Tab>
                            <Tabs.Tab
                                value='management'
                                leftSection={<IconSettings size={16} />}
                            >
                                Management
                            </Tabs.Tab>
                            <Tabs.Tab
                                value='formatting'
                                leftSection={<IconTools size={16} />}
                            >
                                Formatting
                            </Tabs.Tab>
                        </Tabs.List>

                        <Tabs.Panel value='firewall' pt='md'>
                            <FirewallTab />
                        </Tabs.Panel>

                        <Tabs.Panel value='network-block' pt='md'>
                            <PiholeTab />
                        </Tabs.Panel>

                        <Tabs.Panel value='management' pt='md'>
                            <ManagementTab />
                        </Tabs.Panel>

                        <Tabs.Panel value='formatting' pt='md'>
                            <FormattingTab />
                        </Tabs.Panel>
                    </Tabs>
                </Container>
            </AppShell.Main>

            <AppShell.Footer>
                <Container size='xl' h='100%'>
                    <Text size='sm' c='dimmed' ta='center' lh='48px'>
                        Crafted with care:{' '}
                        <Anchor href='https://github.com/d1dee' target='_blank'>
                            Maina Derrick © {dayjs().year()}
                        </Anchor>
                    </Text>
                </Container>
            </AppShell.Footer>
        </AppShell>
    );
};

export default Dashboard;
