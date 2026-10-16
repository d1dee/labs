import ActiveTasksTab from '@/components/ActiveTasksTab';
import ComputersManagementTab from '@/components/VeyonManagementTab';
import PiholeTab from '@/components/pihole/PiholeTab';
import { useSessionContext } from '@/context/SessionContext';
import {
    ActionIcon,
    Alert,
    Anchor,
    AppShell,
    Avatar,
    Button,
    Container,
    Group,
    Menu,
    Tabs,
    Text,
    ThemeIcon,
    Title,
} from '@mantine/core';
import {
    IconExclamationCircle,
    IconDeviceDesktop,
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
import classes from './Dashboard.module.css';

const navTabs = [
    { value: 'firewall', label: 'Firewall', Icon: IconShieldCheck },
    { value: 'network-block', label: 'Network Block', Icon: IconNetwork },
    { value: 'management', label: 'Computers', Icon: IconDeviceDesktop },
    { value: 'active-tasks', label: 'Active Tasks', Icon: IconTools },
] as const;

interface DashboardProps {
    onLogout: () => void;
    onChangePassword: () => void;
    onSettingsOpen: () => void;
}

const Dashboard: FC<DashboardProps> = ({
    onLogout,
    onChangePassword,
    onSettingsOpen,
}) => {
    const { user, organization } = useSessionContext();
    const userName = user?.name || user?.username || 'Teacher';
    const [activeTab, setActiveTab] = useState<string | null>('firewall');
    const tabsList = (
        <Tabs.List className={classes.tabsList} aria-label='Main navigation' grow>
            {navTabs.map((tab) => (
                <Tabs.Tab
                    key={tab.value}
                    value={tab.value}
                    leftSection={<tab.Icon size={16} aria-hidden='true' />}
                    classNames={{
                        tab: classes.tab,
                        tabLabel: classes.tabLabel,
                        tabSection: classes.tabSection,
                    }}
                >
                    {tab.label}
                </Tabs.Tab>
            ))}
        </Tabs.List>
    );

    return (
        <Tabs value={activeTab} onChange={setActiveTab} keepMounted={false}>
            <AppShell
                header={{ height: 60 }}
                footer={{ height: { base: 'calc(72px + env(safe-area-inset-bottom, 0px))', md: 48 } }}
                padding='md'
            >
                <AppShell.Header>
                    <Container size='xl' h='100%'>
                        <Group
                            justify='space-between'
                            align='center'
                            h='100%'
                            gap='md'
                            wrap='nowrap'
                        >
                            <Group align='center' gap='sm' wrap='nowrap'>
                                <ThemeIcon
                                    size={36}
                                    radius='md'
                                    color='teal'
                                    variant='light'
                                >
                                    <IconShieldCheck size={20} />
                                </ThemeIcon>
                                <Title order={3}>Labs FCD</Title>
                            </Group>
                            {tabsList}

                            <Group gap='sm' wrap='nowrap'>
                                <Text size='md' visibleFrom='md'>
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
                                <Menu
                                    shadow='md'
                                    width={200}
                                    position='bottom-end'
                                >
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
                                            leftSection={
                                                <IconSettings size={16} />
                                            }
                                            onClick={onSettingsOpen}
                                        >
                                            Settings
                                        </Menu.Item>
                                        <Menu.Divider />
                                        <Menu.Item
                                            leftSection={
                                                <IconLogout size={16} />
                                            }
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
                        {!organization ? (
                            <Alert
                                icon={<IconExclamationCircle size={18} />}
                                color='orange'
                                variant='light'
                                mt='md'
                                title='No organization'
                            >
                                <Group align='center' gap='sm'>
                                    <Text size='sm'>
                                        You must join or create an organization
                                        to use these features.
                                    </Text>
                                    <Button
                                        size='xs'
                                        variant='light'
                                        onClick={onSettingsOpen}
                                    >
                                        Open settings
                                    </Button>
                                </Group>
                            </Alert>
                        ) : (
                            <>
                                <Tabs.Panel value='firewall' pt='md'>
                                    <FirewallTab />
                                </Tabs.Panel>

                                <Tabs.Panel value='network-block' pt='md'>
                                    <PiholeTab />
                                </Tabs.Panel>

                                <Tabs.Panel value='management' pt='md'>
                                    <ComputersManagementTab />
                                </Tabs.Panel>

                                <Tabs.Panel value='active-tasks' pt='md'>
                                    <ActiveTasksTab />
                                </Tabs.Panel>
                            </>
                        )}
                    </Container>
                </AppShell.Main>

                <AppShell.Footer visibleFrom='md'>
                    <Container size='xl' h='100%' visibleFrom='md'>
                        <Text size='sm' c='dimmed' ta='center' lh='48px'>
                            Crafted with care:{' '}
                            <Anchor
                                href='https://github.com/d1dee'
                                target='_blank'
                            >
                                Maina Derrick © {dayjs().year()}
                            </Anchor>
                        </Text>
                    </Container>
                </AppShell.Footer>
            </AppShell>
        </Tabs>
    );
};

export default Dashboard;
