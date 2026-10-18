import type { Organization } from '@/context/SessionContext';
import { useSessionContext } from '@/context/SessionContext';
import { useApiStream } from '@/api/useApiStream';
import { betterFetch } from '@better-fetch/fetch';
import {
    ActionIcon,
    Alert,
    Badge,
    Button,
    Card,
    Divider,
    Group,
    SimpleGrid,
    Stack,
    Text,
    TextInput,
    ThemeIcon,
    Title,
} from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import {
    IconBuilding,
    IconCheck,
    IconCopy,
    IconInfoCircle,
    IconKey,
    IconMail,
    IconLogout,
    IconPhone,
    IconPlus,
    IconUserPlus,
    IconX,
} from '@tabler/icons-react';
import { useState } from 'react';
import { z } from 'zod';
import { PhoneNumberInput } from '../PhoneNumberInput';
import { OrganizationMembersCard } from './OrganizationMembersCard';

export type { Organization };

export function OrganizationSettings({ enabled = true }: { enabled?: boolean }) {
    const {
        organization: userOrganization,
        setOrganization: onOrganizationChange,
    } = useSessionContext();
    const [loading, setLoading] = useState(false);
    const [joining, setJoining] = useState(false);
    const [showCreateForm, setShowCreateForm] = useState(false);
    const refresh = useApiStream<{ organizations: Organization[] }>(enabled ? '/api/organizations' : null,
        (data) => onOrganizationChange(data.organizations[0] ?? null));

    const orgSchema = z.object({
        name: z
            .string()
            .min(4, 'Organization name must be at least 2 characters'),
        email: z
            .email('Invalid email address')
            .min(1, 'Contact information is required'),
        phoneNumber: z.string(),
    });

    const createForm = useForm({
        mode: 'uncontrolled',
        initialValues: {
            name: '',
            email: '',
            phoneNumber: '',
        },
        validate: schemaResolver(orgSchema),
    });

    const joinForm = useForm({
        mode: 'uncontrolled',
        initialValues: {
            joinKey: '',
        },
        validate: schemaResolver(
            z.object({
                joinKey: z
                    .string()
                    .trim()
                    .min(1, 'Organization join key is required')
                    .max(128, 'Organization join key is too long'),
            }),
        ),
    });

    const createOrganization = async (values: {
        name: string;
        email: string;
    }) => {
        setLoading(true);
        try {
            const { data, error } = await betterFetch<{
                organization: Organization;
            }>('/api/organizations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(values),
            });

            if (error) {
                notifications.show({
                    title: 'Error',
                    message: 'Failed to create organization',
                    color: 'red',
                    icon: <IconX size={16} />,
                });
                return;
            }

            notifications.show({
                title: 'Success',
                message: 'Organization created successfully',
                color: 'green',
                icon: <IconCheck size={16} />,
            });

            onOrganizationChange(data.organization);
            refresh();
            setShowCreateForm(false);
            createForm.reset();
        } catch (err) {
            notifications.show({
                title: 'Error',
                message: 'Failed to create organization',
                color: 'red',
                icon: <IconX size={16} />,
            });
        } finally {
            setLoading(false);
        }
    };

    const joinOrganization = async (values: { joinKey: string }) => {
        if (!values.joinKey.trim()) return;

        setJoining(true);
        try {
            const { data, error } = await betterFetch<{
                organization: Organization;
            }>(`/api/organizations/${encodeURIComponent(values.joinKey.trim())}/join`, {
                method: 'POST',
            });

            if (error) {
                notifications.show({
                    title: 'Error',
                    message:
                        'Failed to join organization. Check the organization ID.',
                    color: 'red',
                    icon: <IconX size={16} />,
                });
                return;
            }

            notifications.show({
                title: 'Success',
                message: 'Joined organization successfully',
                color: 'green',
                icon: <IconCheck size={16} />,
            });

            onOrganizationChange(data.organization);
            refresh();
            joinForm.reset();
        } catch (err) {
            notifications.show({
                title: 'Error',
                message: 'Failed to join organization',
                color: 'red',
                icon: <IconX size={16} />,
            });
        } finally {
            setJoining(false);
        }
    };

    const copyJoinKey = async () => {
        if (!userOrganization) return;
        try {
            await navigator.clipboard.writeText(userOrganization.joinKey);
            notifications.show({
                title: 'Copied',
                message: 'Join key copied to clipboard',
                color: 'green',
                icon: <IconCheck size={16} />,
            });
        } catch (err) {
            notifications.show({
                title: 'Error',
                message: 'Failed to copy join key',
                color: 'red',
                icon: <IconX size={16} />,
            });
        }
    };

    const leaveOrganization = async () => {
        if (!userOrganization) return;

        setJoining(true);
        try {
            const { error } = await betterFetch(
                `/api/organizations/${userOrganization.id}/leave`,
                {
                    method: 'POST',
                },
            );

            if (error) {
                notifications.show({
                    title: 'Error',
                    message: 'Failed to leave organization',
                    color: 'red',
                    icon: <IconX size={16} />,
                });
                return;
            }

            notifications.show({
                title: 'Success',
                message: 'Left organization successfully',
                color: 'green',
                icon: <IconCheck size={16} />,
            });

            onOrganizationChange(null);
            refresh();
        } catch (err) {
            notifications.show({
                title: 'Error',
                message: 'Failed to leave organization',
                color: 'red',
                icon: <IconX size={16} />,
            });
        } finally {
            setJoining(false);
        }
    };

    if (!userOrganization) {
        return (
            <Card withBorder p='md'>
                <Title order={5}>Organization</Title>
                <Text size='sm' color='dimmed' mb='md'>
                    Join or create an organization to access settings
                </Text>

                <Alert
                    color='yellow'
                    title='Organization Required'
                    icon={<IconInfoCircle size={16} />}
                    mb='md'
                >
                    <Text size='sm'>
                        You must be part of an organization to configure
                        firewall settings and manage labs.
                    </Text>
                </Alert>

                {!showCreateForm ? (
                    <Stack gap='sm'>
                        <Button
                            leftSection={<IconPlus size={14} />}
                            onClick={() => setShowCreateForm(true)}
                        >
                            Create Organization
                        </Button>
                        <Divider orientation='horizontal' label='OR' />
                        <Card withBorder p='sm'>
                            <Stack gap='xs'>
                                <Title fw={500} order={5}>
                                    Join existing
                                </Title>
                                <Text size='sm' color='dimmed'>
                                    Enter your organization join key to join
                                    an existing organization.
                                </Text>
                                <Group gap='xs'>
                                    <TextInput
                                        placeholder='Organization ID'
                                        key={joinForm.key('joinKey')}
                                        {...joinForm.getInputProps('joinKey')}
                                        style={{ flex: 1 }}
                                    />
                                    <Button
                                        leftSection={<IconUserPlus size={14} />}
                                        onClick={() =>
                                            joinForm.onSubmit(
                                                joinOrganization,
                                            )()
                                        }
                                        loading={joining}
                                    >
                                        Join
                                    </Button>
                                </Group>
                            </Stack>
                        </Card>
                    </Stack>
                ) : (
                    <Card withBorder p='sm'>
                        <Stack gap='xs'>
                            <TextInput
                                label='Organization Name'
                                placeholder='My School'
                                key={createForm.key('name')}
                                {...createForm.getInputProps('name')}
                            />
                            <PhoneNumberInput
                                label='Phone Number'
                                key={createForm.key('phoneNumber')}
                                {...createForm.getInputProps('phoneNumber')}
                            />
                            <TextInput
                                label='Email Address'
                                placeholder='admin@school.ac.ke'
                                key={createForm.key('email')}
                                {...createForm.getInputProps('email')}
                            />
                            <Group gap='xs'>
                                <Button
                                    onClick={() =>
                                        createForm.onSubmit(
                                            createOrganization,
                                        )()
                                    }
                                    loading={loading}
                                >
                                    Create
                                </Button>
                                <Button
                                    variant='subtle'
                                    onClick={() => {
                                        setShowCreateForm(false);
                                        createForm.reset();
                                    }}
                                >
                                    Cancel
                                </Button>
                            </Group>
                        </Stack>
                    </Card>
                )}
            </Card>
        );
    }

    return (
        <Stack gap='md'>
        <Card component='section' aria-labelledby='institution-title' withBorder p={{ base: 'md', sm: 'lg' }} radius='md'>
            <Stack gap='md'>
                <Group
                    justify='space-between'
                    align='flex-start'
                    wrap='wrap'
                    gap='md'
                >
                    <Group gap='sm' wrap='nowrap' style={{ minWidth: 0, flex: 1 }}>
                        <ThemeIcon
                            size='xl'
                            variant='light'
                            color='teal'
                            radius='md'
                        >
                            <IconBuilding size={22} />
                        </ThemeIcon>
                        <Stack gap={2} style={{ minWidth: 0 }}>
                            <Title order={3} id='institution-title' style={{ overflowWrap: 'anywhere' }}>
                                {userOrganization.name}
                            </Title>
                            <Text size='xs' color='dimmed'>
                                Institution details
                            </Text>
                        </Stack>
                    </Group>
                    <Button
                        variant='subtle'
                        color='gray'
                        size='xs'
                        leftSection={<IconLogout size={14} />}
                        onClick={leaveOrganization}
                        loading={joining}
                    >
                        Leave institution
                    </Button>
                </Group>

                <Divider />

                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
                        <Group gap='sm' align='flex-start' wrap='nowrap'>
                            <IconMail size={18} aria-hidden style={{ color: 'var(--mantine-color-dimmed)', flexShrink: 0, marginTop: 3 }} />
                            <Stack gap={2} style={{ minWidth: 0 }}>
                                <Text size='xs' color='dimmed'>
                                    Contact email
                                </Text>
                                <Text size='sm' fw={500} style={{ overflowWrap: 'anywhere' }}>
                                    {userOrganization.email}
                                </Text>
                            </Stack>
                        </Group>
                        <Group gap='sm' align='flex-start' wrap='nowrap'>
                            <IconPhone size={18} aria-hidden style={{ color: 'var(--mantine-color-dimmed)', flexShrink: 0, marginTop: 3 }} />
                            <Stack gap={2} style={{ minWidth: 0 }}>
                                <Text size='xs' color='dimmed'>
                                    Contact phone
                                </Text>
                                <Text size='sm' fw={500} lineClamp={1}>
                                    {userOrganization.phoneNumber || 'Not provided'}
                                </Text>
                            </Stack>
                        </Group>
                </SimpleGrid>
                <Group justify='space-between' gap='sm' p='sm' bg='var(--mantine-color-default-hover)' style={{ borderRadius: 'var(--mantine-radius-sm)' }}>
                    <Group gap='sm' wrap='nowrap'>
                        <IconKey size={18} aria-hidden style={{ flexShrink: 0 }} />
                        <Stack gap={2}>
                            <Text size='sm' fw={500}>Invite your colleagues</Text>
                            <Text size='xs' c='dimmed'>Share the join key to give access to this institution.</Text>
                        </Stack>
                    </Group>
                    <Group gap='xs' wrap='nowrap'>
                        <Badge size='lg' variant='light' color='teal' tt='none' style={{ maxWidth: 220 }} title={userOrganization.joinKey}>
                            {userOrganization.joinKey || 'Unavailable'}
                        </Badge>
                        <ActionIcon variant='subtle' color='gray' onClick={copyJoinKey} disabled={!userOrganization.joinKey} aria-label='Copy join key'><IconCopy size={16} /></ActionIcon>
                    </Group>
                </Group>
                <Text size='xs' c='dimmed'>Institution ID: {userOrganization.id}</Text>
            </Stack>
        </Card>
        <OrganizationMembersCard key={userOrganization.id} organization={userOrganization} enabled={enabled} onDeleted={refresh} />
        </Stack>
    );
}
