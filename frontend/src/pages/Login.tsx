import { signIn, signUp } from '@/lib/auth-client';
import {
    Alert,
    Anchor,
    Button,
    Container,
    Paper,
    PasswordInput,
    Stack,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { FC, FormEvent, useEffect, useState } from 'react';

interface AppConfig {
    allowSignup: boolean;
}

type Mode = 'login' | 'signup';

interface LoginProps {
    onLoginSuccess?: () => void;
}

const Login: FC<LoginProps> = ({ onLoginSuccess }) => {
    const [mode, setMode] = useState<Mode>('login');
    const [username, setUsername] = useState<string>('');
    const [email, setEmail] = useState<string>('');
    const [password, setPassword] = useState<string>('');
    const [confirmPassword, setConfirmPassword] = useState<string>('');
    const [error, setError] = useState<string>('');
    const [loading, setLoading] = useState<boolean>(false);
    const [allowSignup, setAllowSignup] = useState<boolean>(false);

    useEffect(() => {
        // Auto-fill demo credentials on demo subdomain
        if (window.location.hostname === 'demo.fcd.co.ke') {
            setUsername('demo');
            setEmail('demo@local.lan');
            setPassword('demo123');
        }
    }, []);

    useEffect(() => {
        fetch('/api/config')
            .then((res) => res.json())
            .then((config: AppConfig) => setAllowSignup(config.allowSignup))
            .catch(() => setAllowSignup(false));
    }, []);

    const handleSubmit = async (
        e: FormEvent<HTMLFormElement>,
    ): Promise<void> => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (mode === 'signup') {
                if (password !== confirmPassword) {
                    setError('Passwords do not match.');
                    setLoading(false);
                    return;
                }

                const result = await signUp.email({
                    email,
                    callbackURL: '/',
                    name: username,
                    password,
                    username,
                });

                if (result.error) {
                    setError(
                        result.error.message ||
                            'Failed to create account. Please try again.',
                    );
                } else {
                    onLoginSuccess?.();
                }
            } else {
                const result = await signIn.username({
                    username,
                    password,
                    rememberMe: true,
                });

                if (result.error) {
                    setError(
                        result.error.message ||
                            'Invalid credentials. Please try again.',
                    );
                } else {
                    onLoginSuccess?.();
                }
            }
        } catch (err) {
            setError('An unexpected error occurred. Please try again.');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const toggleMode = () => {
        setMode(mode === 'login' ? 'signup' : 'login');
        setError('');
        setPassword('');
        setConfirmPassword('');
    };

    return (
        <Container size={'xs'} my={40}>
            <Paper radius='md' p='xl' withBorder>
                <Stack gap='lg'>
                    <div>
                        <Title order={2} ta='center' fw={700}>
                            Labs FCD
                        </Title>
                        <Text c='dimmed' size='sm' ta='center' mt={5}>
                            {mode === 'login'
                                ? 'Teacher Access Portal'
                                : 'Create New Account'}
                        </Text>
                    </div>

                    <form onSubmit={handleSubmit}>
                        <Stack gap='md'>
                            <TextInput
                                label='Teacher Name'
                                placeholder='Enter your name'
                                value={username}
                                onChange={(e) => {
                                    setUsername(e.currentTarget.value);
                                    setEmail(
                                        e.currentTarget.value?.toLowerCase() +
                                            '@local.lan',
                                    );
                                }}
                                disabled={loading}
                                autoFocus
                            />

                            <PasswordInput
                                label='Password'
                                placeholder={
                                    mode === 'signup'
                                        ? 'Create a password'
                                        : 'Enter your password'
                                }
                                value={password}
                                onChange={(e) =>
                                    setPassword(e.currentTarget.value)
                                }
                                disabled={loading}
                            />

                            {mode === 'signup' && (
                                <PasswordInput
                                    label='Confirm Password'
                                    placeholder='Confirm your password'
                                    value={confirmPassword}
                                    onChange={(e) =>
                                        setConfirmPassword(
                                            e.currentTarget.value,
                                        )
                                    }
                                    disabled={loading}
                                />
                            )}

                            {error && (
                                <Alert
                                    icon={<IconAlertCircle size={16} />}
                                    title={
                                        mode === 'signup'
                                            ? 'Sign Up Failed'
                                            : 'Login Failed'
                                    }
                                    color='red'
                                >
                                    {error}
                                </Alert>
                            )}

                            <Button
                                fullWidth
                                type='submit'
                                loading={loading}
                                mt={error ? '' : 'md'}
                                size='md'
                            >
                                {loading
                                    ? mode === 'signup'
                                        ? 'Creating account...'
                                        : 'Logging in...'
                                    : mode === 'signup'
                                      ? 'Sign Up'
                                      : 'Login'}
                            </Button>
                        </Stack>
                    </form>

                    {allowSignup && (
                        <Text ta='center' size='sm'>
                            {mode === 'login'
                                ? "Don't have an account? "
                                : 'Already have an account? '}
                            <Anchor
                                component='button'
                                onClick={toggleMode}
                                size='sm'
                            >
                                {mode === 'login' ? 'Sign up' : 'Login'}
                            </Anchor>
                        </Text>
                    )}
                </Stack>
            </Paper>
        </Container>
    );
};

export default Login;
