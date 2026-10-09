import { authClient, registerTeacher, signIn } from '@/lib/auth-client';
import { useApiStream } from '@/api/useApiStream';
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
    ThemeIcon,
    Title,
} from '@mantine/core';
import { IconAlertCircle, IconShieldCheck } from '@tabler/icons-react';
import { FC, FormEvent, useEffect, useState } from 'react';

interface AppConfig {
    allowSignup: boolean;
}

type Mode = 'login' | 'signup' | 'forgot' | 'reset' | 'verify';

const Login: FC = () => {
    const query = new URLSearchParams(window.location.search);
    const [mode, setMode] = useState<Mode>(() => query.get('auth') === 'reset' ? 'reset' : 'login');
    const [username, setUsername] = useState<string>('');
    const [email, setEmail] = useState<string>('');
    const [password, setPassword] = useState<string>('');
    const [confirmPassword, setConfirmPassword] = useState<string>('');
    const [error, setError] = useState<string>('');
    const [loading, setLoading] = useState<boolean>(false);
    const [allowSignup, setAllowSignup] = useState<boolean>(false);
    const [joinKey, setJoinKey] = useState('');
    const [message, setMessage] = useState(query.get('auth') === 'verified' && !query.get('error') ? 'Email verified. You can now sign in.' : '');
    const [token] = useState(() => query.get('token') ?? '');
    const authTitles: Record<Mode, string> = { login: 'Teacher Access Portal', signup: 'Create New Account', forgot: 'Recover Password', reset: 'Set New Password', verify: 'Verify Teacher Email' };
    const actionLabels: Record<Mode, string> = { login: 'Login', signup: 'Sign Up', forgot: 'Send Reset Link', reset: 'Reset Password', verify: 'Resend Verification Email' };

    useEffect(() => {
        // Auto-fill demo credentials on demo subdomain
        if (window.location.hostname === 'demo.fcd.co.ke') {
            setUsername('demo');
            setEmail('demo@local.lan');
            setPassword('demo123');
        }
    }, []);

    useApiStream<AppConfig>('/api/config', (config) => setAllowSignup(config.allowSignup), () => setAllowSignup(false));

    const handleSubmit = async (
        e: FormEvent<HTMLFormElement>,
    ): Promise<void> => {
        e.preventDefault();
        setError('');
        setMessage('');
        setLoading(true);

        try {
            if (mode === 'forgot' || mode === 'verify') {
                if (/@(?:local\.lan|localhost)$/i.test(email.trim())) {
                    setError('Legacy accounts without a real email cannot receive recovery links. Contact your administrator.');
                    return;
                }
                const result = mode === 'forgot'
                    ? await authClient.requestPasswordReset({ email: email.trim(), redirectTo: `${window.location.origin}/?auth=reset` })
                    : await authClient.sendVerificationEmail({ email: email.trim(), callbackURL: `${window.location.origin}/?auth=verified` });
                if (result.error) setError(result.error.message || 'Unable to send email.');
                else setMessage('If an eligible account exists for this email, a link has been sent. Check your inbox and spam folder.');
            } else if (mode === 'reset') {
                if (!token || query.get('error')) {
                    setError('This reset link is invalid or expired. Request a new reset link.');
                    return;
                }
                if (password !== confirmPassword) {
                    setError('Passwords do not match.');
                    return;
                }
                const result = await authClient.resetPassword({ token, newPassword: password });
                if (result.error) setError(result.error.message || 'Unable to reset password. Request a new link.');
                else {
                    window.history.replaceState(null, '', window.location.pathname);
                    setMode('login');
                    setPassword('');
                    setConfirmPassword('');
                    setMessage('Password reset successfully. Sign in with your new password.');
                }
            } else if (mode === 'signup') {
                if (password !== confirmPassword) {
                    setError('Passwords do not match.');
                    setLoading(false);
                    return;
                }

                const result = await registerTeacher({
                    email: email.trim(),
                    callbackURL: `${window.location.origin}/?auth=verified`,
                    name: username,
                    password,
                    username,
                    joinKey: joinKey.trim() || undefined,
                });

                if (result.error) {
                    setError(
                        result.error.message ||
                            'Failed to create account. Please try again.',
                    );
                } else {
                    setMode('verify');
                    setPassword('');
                    setConfirmPassword('');
                    setMessage('Account created. Check your teacher email for a verification link, then sign in.');
                }
            } else {
                const result = await signIn.username({
                    username,
                    password,
                    rememberMe: true,
                    callbackURL: `${window.location.origin}/?auth=verified`,
                });

                if (result.error) {
                    setError(
                        result.error.message ||
                            'Invalid credentials. Please try again.',
                    );
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
        setMessage('');
        setPassword('');
        setConfirmPassword('');
    };

    return (
        <Container size={'xs'} my={40}>
            <Paper radius='lg' p='xl' withBorder>
                <Stack gap='lg'>
                    <Stack align='center' gap='xs'>
                        <ThemeIcon size={56} radius='md' color='teal' variant='light'>
                            <IconShieldCheck size={28} />
                        </ThemeIcon>
                        <Text tt='uppercase' size='xs' fw={700} c='teal' lts={1.4}>
                            Labs FCD
                        </Text>
                        <Title order={2} ta='center'>
                            {authTitles[mode]}
                        </Title>
                        <Text c='dimmed' size='sm' ta='center'>
                            {mode === 'login' ? 'Sign in to manage your labs' : mode === 'signup' ? 'Register a new teacher account' : 'Use your registered teacher email to securely access your account'}
                        </Text>
                    </Stack>

                    <form onSubmit={handleSubmit}>
                        <Stack gap='md'>
                            {(mode === 'login' || mode === 'signup') && <TextInput
                                label='Teacher Username'
                                placeholder='Enter your username'
                                value={username}
                                onChange={(e) => setUsername(e.currentTarget.value)}
                                disabled={loading}
                                required
                                autoComplete='username'
                                autoFocus
                            />}

                            {(mode === 'signup' || mode === 'forgot' || mode === 'verify') && <TextInput
                                label='Teacher Email'
                                placeholder='teacher@school.example'
                                type='email'
                                required
                                autoComplete='email'
                                value={email}
                                onChange={(e) => setEmail(e.currentTarget.value)}
                                disabled={loading}
                            />}
                            {mode === 'signup' && <TextInput
                                label='Organization Join Key'
                                description='Optional. Automatically join your organization when you register.'
                                value={joinKey}
                                onChange={(e) => setJoinKey(e.currentTarget.value)}
                                disabled={loading}
                            />}

                            {(mode === 'login' || mode === 'signup' || mode === 'reset') && <PasswordInput
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
                                required
                                minLength={mode === 'login' ? undefined : 4}
                                maxLength={mode === 'login' ? undefined : 16}
                                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                            />}

                            {(mode === 'signup' || mode === 'reset') && (
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
                                    required
                                    autoComplete='new-password'
                                />
                            )}

                            {error && (
                                <Alert
                                    icon={<IconAlertCircle size={16} />}
                                    title='Unable to continue'
                                    color='red'
                                >
                                    {error}
                                </Alert>
                            )}
                            {message && <Alert color='teal' role='status'>{message}</Alert>}
                            {query.get('error') && !error && <Alert color='red'>This authentication link is invalid or expired. Request a new link.</Alert>}

                            <Button
                                fullWidth
                                type='submit'
                                loading={loading}
                                mt={error ? '' : 'md'}
                                size='md'
                            >
                                {actionLabels[mode]}
                            </Button>
                        </Stack>
                    </form>

                    {mode === 'login' && <Stack align='center' gap='xs'>
                        <Anchor component='button' onClick={() => { setMode('forgot'); setError(''); setMessage(''); }}>Forgot password?</Anchor>
                        <Anchor component='button' onClick={() => { setMode('verify'); setError(''); setMessage(''); }}>Resend verification email</Anchor>
                    </Stack>}
                    {mode === 'forgot' && <Text size='xs' c='dimmed'>Accounts created without a real teacher email need administrator-assisted recovery.</Text>}
                    {(mode === 'forgot' || mode === 'reset' || mode === 'verify') && <Anchor component='button' ta='center' onClick={() => {
                        window.history.replaceState(null, '', window.location.pathname);
                        setMode('login'); setError(''); setMessage(''); setPassword(''); setConfirmPassword('');
                    }}>Back to login</Anchor>}
                    {mode === 'reset' && <Anchor component='button' ta='center' onClick={() => { setMode('forgot'); setError(''); setMessage(''); }}>Request a new reset link</Anchor>}
                    {allowSignup && (mode === 'login' || mode === 'signup') && (
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
