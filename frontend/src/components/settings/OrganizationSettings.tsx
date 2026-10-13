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
    IconPhone,
    IconPlus,
    IconTrash,
    IconUserPlus,
    IconUsers,
    IconX,
} from '@tabler/icons-react';
import { useState } from 'react';
import { z } from 'zod';
import { PhoneNumberInput } from '../PhoneNumberInput';

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

    const memberColors = [
        'blue',
        'teal',
        'grape',
        'orange',
        'indigo',
        'pink',
        'cyan',
    ];

    return (
        <Card withBorder p={{ base: 'sm', md: 'md' }} radius='md'>
            <Stack gap='md'>
                {/* Header */}
                <Group
                    justify='space-between'
                    align='flex-start'
                    wrap='nowrap'
                    gap='md'
                >
                    <Group gap='sm' wrap='nowrap'>
                        <ThemeIcon
                            size='xl'
                            variant='light'
                            color='blue'
                            radius='md'
                        >
                            <IconBuilding size={22} />
                        </ThemeIcon>
                        <Stack gap={2} style={{ minWidth: 0 }}>
                            <Title order={4} lineClamp={1}>
                                {userOrganization.name}
                            </Title>
                            <Text size='xs' color='dimmed'>
                                Organization ID: {userOrganization.id}
                            </Text>
                        </Stack>
                    </Group>
                    <Button
                        variant='light'
                        color='red'
                        size='xs'
                        leftSection={<IconTrash size={14} />}
                        onClick={leaveOrganization}
                        loading={joining}
                    >
                        Leave
                    </Button>
                </Group>

                <Divider />

                {/* Join key */}
                <Group
                    justify='space-between'
                    align='center'
                    wrap='wrap'
                    gap='sm'
                >
                    <Group gap='sm' wrap='nowrap'>
                        <ThemeIcon variant='light' color='green' size='lg'>
                            <IconKey size={16} />
                        </ThemeIcon>
                        <Stack gap={2}>
                            <Text size='sm' fw={500}>
                                Join Key
                            </Text>
                            <Text size='xs' color='dimmed'>
                                Share this code so others can join
                            </Text>
                        </Stack>
                    </Group>
                    <Group gap='xs'>
                        <Badge
                            size='lg'
                            variant='light'
                            color='green'
                            ff='monospace'
                            style={{ letterSpacing: '0.15em' }}
                        >
                            {userOrganization.joinKey}
                        </Badge>
                        <ActionIcon
                            variant='subtle'
                            color='gray'
                            onClick={copyJoinKey}
                            aria-label='Copy join key'
                        >
                            <IconCopy size={16} />
                        </ActionIcon>
                    </Group>
                </Group>

                {/* Contact information */}
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing='sm'>
                    <Card withBorder p='sm' radius='md'>
                        <Group gap='sm' align='center'>
                            <ThemeIcon variant='light' color='indigo' size='lg'>
                                <IconMail size={16} />
                            </ThemeIcon>
                            <Stack gap={2} style={{ minWidth: 0 }}>
                                <Text size='xs' color='dimmed'>
                                    Email
                                </Text>
                                <Text size='sm' fw={500} lineClamp={1}>
                                    {userOrganization.email}
                                </Text>
                            </Stack>
                        </Group>
                    </Card>

                    <Card withBorder p='sm' radius='md'>
                        <Group gap='sm' align='center'>
                            <ThemeIcon variant='light' color='teal' size='lg'>
                                <IconPhone size={16} />
                            </ThemeIcon>
                            <Stack gap={2} style={{ minWidth: 0 }}>
                                <Text size='xs' color='dimmed'>
                                    Phone
                                </Text>
                                <Text size='sm' fw={500} lineClamp={1}>
                                    {userOrganization.phoneNumber || '—'}
                                </Text>
                            </Stack>
                        </Group>
                    </Card>
                </SimpleGrid>

                {/* Members */}
                <Card withBorder p='sm' radius='md'>
                    <Group justify='space-between' mb='sm'>
                        <Group gap='xs'>
                            <ThemeIcon variant='light' color='gray' size='md'>
                                <IconUsers size={16} />
                            </ThemeIcon>
                            <Text size='sm' fw={500}>
                                Members
                            </Text>
                        </Group>
                        <Badge variant='light' size='sm'>
                            {userOrganization.members?.length || 0}
                        </Badge>
                    </Group>

                    <Stack gap='xs'>
                        {userOrganization.members?.map((member, index) => (
                            <Group
                                key={member.id}
                                justify='space-between'
                                wrap='nowrap'
                                gap='sm'
                            >
                                <Group gap='sm' wrap='nowrap'>
                                    <ThemeIcon
                                        variant='light'
                                        color={
                                            memberColors[
                                                index % memberColors.length
                                            ]
                                        }
                                        size='lg'
                                        radius='xl'
                                    >
                                        {member.name.charAt(0).toUpperCase()}
                                    </ThemeIcon>
                                    <Stack gap={2} style={{ minWidth: 0 }}>
                                        <Text size='sm' fw={500} lineClamp={1}>
                                            {member.name}
                                        </Text>
                                        <Text
                                            size='xs'
                                            color='dimmed'
                                            lineClamp={1}
                                        >
                                            {member.email}
                                        </Text>
                                    </Stack>
                                </Group>
                                {member.username && (
                                    <Badge
                                        variant='light'
                                        size='sm'
                                        color='gray'
                                    >
                                        @{member.username}
                                    </Badge>
                                )}
                            </Group>
                        ))}
                        {(!userOrganization.members ||
                            userOrganization.members.length === 0) && (
                            <Text size='sm' color='dimmed' ta='center'>
                                No members yet
                            </Text>
                        )}
                    </Stack>
                </Card>
            </Stack>
        </Card>
    );
}
