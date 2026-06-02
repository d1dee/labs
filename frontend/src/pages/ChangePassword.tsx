import { authClient } from '@/lib/auth-client';
import {
    Button,
    Modal,
    PasswordInput,
    Stack,
    Text,
    Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconCheck } from '@tabler/icons-react';
import { FC, FormEvent, useState } from 'react';

interface ChangePasswordProps {
    opened: boolean;
    onClose: () => void;
}

const ChangePassword: FC<ChangePasswordProps> = ({ opened, onClose }) => {
    const [currentPassword, setCurrentPassword] = useState<string>('');
    const [newPassword, setNewPassword] = useState<string>('');
    const [confirmPassword, setConfirmPassword] = useState<string>('');
    const [loading, setLoading] = useState<boolean>(false);

    const handleSubmit = async (
        e: FormEvent<HTMLFormElement>,
    ): Promise<void> => {
        e.preventDefault();
        setLoading(true);

        try {
            if (newPassword !== confirmPassword) {
                notifications.show({
                    title: 'Error',
                    message: 'New passwords do not match.',
                    color: 'red',
                    icon: <IconAlertCircle size={16} />,
                });
                setLoading(false);
                return;
            }

            const result = await authClient.changePassword({
                currentPassword,
                newPassword,
            });

            if (result.error) {
                notifications.show({
                    title: 'Error',
                    message:
                        result.error.message ||
                        'Failed to change password. Please try again.',
                    color: 'red',
                    icon: <IconAlertCircle size={16} />,
                });
            } else {
                notifications.show({
                    title: 'Success',
                    message: 'Password changed successfully!',
                    color: 'green',
                    icon: <IconCheck size={16} />,
                });
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
                setTimeout(onClose, 1500);
            }
        } catch (err) {
            notifications.show({
                title: 'Error',
                message: 'An unexpected error occurred. Please try again.',
                color: 'red',
                icon: <IconAlertCircle size={16} />,
            });
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            opened={opened}
            onClose={onClose}
            title={
                <>
                    <Title order={3} fw={700}>
                        Change Password
                    </Title>{' '}
                    <Text c='dimmed' size='xs'>
                        Update your account password
                    </Text>
                </>
            }
            size='md'
            centered
        >
            <Stack>
                <form onSubmit={handleSubmit}>
                    <Stack>
                        <PasswordInput
                            label='Current Password'
                            placeholder='Enter your current password'
                            value={currentPassword}
                            onChange={(e) =>
                                setCurrentPassword(e.currentTarget.value)
                            }
                            disabled={loading}
                            autoFocus
                            required
                        />

                        <PasswordInput
                            label='New Password'
                            placeholder='Enter new password'
                            value={newPassword}
                            onChange={(e) =>
                                setNewPassword(e.currentTarget.value)
                            }
                            disabled={loading}
                            required
                        />

                        <PasswordInput
                            label='Confirm New Password'
                            placeholder='Confirm new password'
                            value={confirmPassword}
                            onChange={(e) =>
                                setConfirmPassword(e.currentTarget.value)
                            }
                            disabled={loading}
                            required
                        />

                        <Button
                            fullWidth
                            type='submit'
                            loading={loading}
                            size='md'
                        >
                            {loading
                                ? 'Changing password...'
                                : 'Change Password'}
                        </Button>
                    </Stack>
                </form>
            </Stack>
        </Modal>
    );
};

export default ChangePassword;
