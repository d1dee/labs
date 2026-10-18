import { useSessionContext, type Organization } from '@/context/SessionContext';
import { betterFetch } from '@better-fetch/fetch';
import { ActionIcon, Alert, Avatar, Badge, Button, Card, Group, PasswordInput, Stack, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconShieldLock, IconTrash, IconUsers } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import classes from './OrganizationMembersCard.module.css';

export function OrganizationMembersCard({ organization, enabled, onDeleted }: {
    organization: Organization;
    enabled: boolean;
    onDeleted: () => void;
}) {
    const { user } = useSessionContext();
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const members = organization.members ?? [];
    const canDelete = organization.canDeleteMembers && organization.createdByUserId === user?.id;
    const selected = canDelete ? members.find((member) => member.id === selectedId && member.id !== user?.id && member.canDeleteAccount) : undefined;
    const activeCount = members.filter((member) => member.hasActiveSession).length;
    const reset = () => {
        setSelectedId(null);
        setPassword('');
        setConfirmation('');
        setError(null);
    };
    useEffect(() => {
        if (!enabled || !selected) reset();
    }, [enabled, selected?.id]);

    const deleteAccount = async () => {
        if (!selected || !enabled || deleting || confirmation !== selected.email || !password) return;
        setDeleting(true);
        setError(null);
        try {
            const { data, error: failure } = await betterFetch<{ success: boolean }>(
                `/api/organizations/${encodeURIComponent(organization.id)}/members/${encodeURIComponent(selected.id)}/account`,
                { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password, confirmEmail: confirmation }) },
            );
            setPassword('');
            if (failure || !data?.success) {
                setError(failure?.status === 429
                    ? 'Too many confirmation attempts. Wait 15 minutes before trying again.'
                    : 'Account was not deleted. Check your password and confirm you are still the institution creator. Protected creator accounts cannot be deleted.');
                return;
            }
            notifications.show({ title: 'Account deleted', message: `${selected.name}'s account and sessions have been removed.`, color: 'green' });
            reset();
            onDeleted();
        } catch {
            setPassword('');
            setError('Unable to delete this account. Check your connection and try again.');
        } finally {
            setDeleting(false);
        }
    };

    return (
        <Card component='section' aria-labelledby='organization-members-title' withBorder radius='md' p={{ base: 'md', sm: 'lg' }}>
            <Group justify='space-between' gap='sm' mb='xs'>
                <Group gap='xs'>
                    <IconUsers size={20} aria-hidden />
                    <Title order={4} id='organization-members-title'>Members</Title>
                    <Badge variant='light' color='gray'>{members.length}</Badge>
                </Group>
                <Text size='xs' c='dimmed'>{activeCount} signed in</Text>
            </Group>
            <Text size='sm' c='dimmed'>People with access to {organization.name}. Only the institution creator can delete accounts.</Text>
            {!organization.createdByUserId && (
                <Alert color='gray' mt='md' title='Creator not recorded'>This institution predates creator tracking. Its creator must be explicitly recorded before account deletion can be enabled.</Alert>
            )}
            <div role='list' aria-label='Institution members'>
                {members.map((member) => {
                    const creator = member.id === organization.createdByUserId;
                    const self = member.id === user?.id;
                    const lastLogin = member.lastLoginAt ? new Date(member.lastLoginAt) : null;
                    return (
                        <div role='listitem' key={member.id} className={classes.member}>
                            <Group gap='sm' wrap='nowrap' className={classes.identity} align='flex-start'>
                                <Avatar size={40} radius='xl' color={creator ? 'teal' : 'gray'} name={member.name} />
                                <Stack gap={3} className={classes.identity}>
                                    <Group gap={6}>
                                        <Text size='sm' fw={600}>{member.name}</Text>
                                        {creator && <Badge size='xs' variant='light' color='teal'>Creator</Badge>}
                                        {self && <Text size='xs' c='dimmed'>(you)</Text>}
                                    </Group>
                                    <Text size='xs' c='dimmed' className={classes.email}>{member.email}</Text>
                                    {member.username && <Text size='xs' c='dimmed'>@{member.username}</Text>}
                                </Stack>
                            </Group>
                            <Stack gap={5} className={classes.activity}>
                                <Badge size='sm' variant='light' color={member.hasActiveSession ? 'teal' : 'gray'} style={{ alignSelf: 'flex-start' }}>
                                    {member.hasActiveSession ? 'Active session' : 'Signed out'}
                                </Badge>
                                <Text size='xs' c='dimmed'>Last sign-in<br />
                                    {lastLogin && !Number.isNaN(lastLogin.getTime()) ? (
                                        <time dateTime={lastLogin.toISOString()} title={lastLogin.toLocaleString()}>{lastLogin.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>
                                    ) : <span>Not recorded</span>}
                                </Text>
                            </Stack>
                            <div className={classes.action}>
                                {canDelete && !creator && !self && member.canDeleteAccount && (
                                    <Tooltip label='Delete account'>
                                        <ActionIcon variant='subtle' color='red' aria-label={`Delete account for ${member.name}`} disabled={!enabled || deleting} onClick={() => {
                                            reset();
                                            setSelectedId(member.id);
                                        }}>
                                            <IconTrash size={17} />
                                        </ActionIcon>
                                    </Tooltip>
                                )}
                                {canDelete && !creator && !self && !member.canDeleteAccount && member.deletionProtectionReason && (
                                    <Tooltip label={member.deletionProtectionReason === 'institution_creator' ? 'This account created another institution and cannot be deleted here.' : 'This account is protected from deletion.'}>
                                        <span aria-label={`Protected account for ${member.name}`}><IconShieldLock size={17} color='var(--mantine-color-dimmed)' /></span>
                                    </Tooltip>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
            {!members.length && <Text size='sm' c='dimmed' py='lg'>No members to display yet.</Text>}
            <Text size='xs' c='dimmed' mt='xs'>An active session means the account is signed in, not necessarily online. Earlier sign-ins may not have been recorded.</Text>
            {enabled && selected && (
                <Card component='form' withBorder className={classes.confirmation} mt='md' p='md' aria-label={`Confirm deleting ${selected.name}`} onSubmit={(event) => {
                    event.preventDefault();
                    void deleteAccount();
                }}>
                    <Stack gap='sm'>
                        <Group gap='xs'><IconAlertTriangle size={18} /><Text fw={600} size='sm'>Permanently delete {selected.name}'s account?</Text></Group>
                        <Text size='sm'>This deletes their account and ends all their sessions. It cannot be undone. Shared institution settings and lab history are kept.</Text>
                        <TextInput label='Confirm member email' description={`Type ${selected.email} to confirm.`} value={confirmation} onChange={(event) => setConfirmation(event.currentTarget.value)} autoComplete='off' autoFocus disabled={deleting} required />
                        <PasswordInput label='Your password' description="Confirm with your own password, not the member's." value={password} onChange={(event) => setPassword(event.currentTarget.value)} autoComplete='current-password' disabled={deleting} required />
                        {error && <Alert color='red' role='alert'>{error}</Alert>}
                        <Group justify='flex-end' gap='sm'>
                            <Button variant='default' onClick={reset} disabled={deleting}>Cancel</Button>
                            <Button type='submit' color='red' loading={deleting} disabled={confirmation !== selected.email || !password}>Delete account permanently</Button>
                        </Group>
                    </Stack>
                </Card>
            )}
        </Card>
    );
}
