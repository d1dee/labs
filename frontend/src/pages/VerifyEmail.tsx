import { authClient, useSession } from '@/lib/auth-client';
import { navigate, useLocation } from '@/lib/navigation';
import VerificationCodeInput, {
    emptyVerificationDigits,
    VERIFICATION_CODE_LENGTH,
} from '@/components/auth/VerificationCodeInput';
import {
    Alert,
    Anchor,
    Button,
    Container,
    Paper,
    Stack,
    Text,
    TextInput,
    ThemeIcon,
    Title,
} from '@mantine/core';
import { IconAlertCircle, IconShieldCheck } from '@tabler/icons-react';
import { FC, FormEvent, useEffect, useState } from 'react';

const RESEND_COOLDOWN_MS = 60_000;

interface VerifyEmailProps {
    /** Email of the signed in account, when the session is already known. */
    email?: string | null;
}

/**
 * Standalone email verification screen. It collects the teacher email, the
 * six digit code that was mailed to it, and confirms the address.
 */
const VerifyEmail: FC<VerifyEmailProps> = ({ email }) => {
    const { data: session, refetch } = useSession();
    const { search } = useLocation();
    const query = new URLSearchParams(search);
    const queryEmail = query.get('email') ?? '';
    const presetEmail = email?.trim() || queryEmail.trim();
    const [typedEmail, setTypedEmail] = useState('');
    const address = (presetEmail || typedEmail).trim();
    const [digits, setDigits] = useState<string[]>(emptyVerificationDigits);
    const [error, setError] = useState('');
    const [invalidCode, setInvalidCode] = useState(false);
    const [message, setMessage] = useState(
        query.get('signup')
            ? 'Account created. Enter the six-digit code sent to your teacher email.'
            : '',
    );
    const [loading, setLoading] = useState(false);
    const [resendLoading, setResendLoading] = useState(false);
    const [resendAt, setResendAt] = useState(0);
    const [now, setNow] = useState(Date.now());
    const resendSeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));
    const code = digits.join('');
    const needsSignOut = !!session && !session.user.emailVerified;

    useEffect(() => {
        if (!resendAt) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [resendAt]);

    const resendCode = async (): Promise<void> => {
        if (resendSeconds || resendLoading) return;
        if (!address) {
            setError('Enter the teacher email that should receive the code.');
            return;
        }
        setError('');
        setMessage('');
        setResendLoading(true);
        try {
            const result = await authClient.emailOtp.sendVerificationOtp({
                email: address,
                type: 'email-verification',
            });
            if (result.error)
                setError(
                    result.error.message ||
                        'Unable to send verification code. Please try again.',
                );
            else {
                setDigits(emptyVerificationDigits());
                setMessage(
                    'A new verification code has been sent. Check your inbox and spam folder.',
                );
                setNow(Date.now());
                setResendAt(Date.now() + RESEND_COOLDOWN_MS);
            }
        } catch {
            setError('Unable to send verification code. Please try again.');
        } finally {
            setResendLoading(false);
        }
    };

    const handleSubmit = async (
        event: FormEvent<HTMLFormElement>,
    ): Promise<void> => {
        event.preventDefault();
        setError('');
        setMessage('');
        if (!address) {
            setError(
                'Enter the teacher email that received the verification code.',
            );
            return;
        }
        if (code.length !== VERIFICATION_CODE_LENGTH) {
            setError('Enter the six-digit code from your verification email.');
            setInvalidCode(true);
            return;
        }
        setLoading(true);
        try {
            const result = await authClient.emailOtp.verifyEmail({
                email: address,
                otp: code,
            });
            if (result.error) {
                setError(
                    result.error.message ||
                        'Invalid or expired verification code. Request a new code.',
                );
                setInvalidCode(true);
                setDigits(emptyVerificationDigits());
                return;
            }
            setMessage('Email verified.');
            if (session) await refetch();
            navigate(session ? '/' : '/?auth=verified');
        } catch {
            setError('Unable to verify the code. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Container
            size='xs'
            py={40}
            style={{
                minHeight: '100dvh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            <Paper radius='lg' p='xl' withBorder w='100%'>
                <Stack gap='lg'>
                    <Stack align='center' gap='xs'>
                        <ThemeIcon size={56} radius='md' color='teal' variant='light'>
                            <IconShieldCheck size={28} />
                        </ThemeIcon>
                        <Text
                            tt='uppercase'
                            size='xs'
                            fw={700}
                            c='teal'
                            lts={1.4}
                        >
                            Labs FCD
                        </Text>
                        <Title order={2} ta='center'>
                            Verify Teacher Email
                        </Title>
                        <Text c='dimmed' size='sm' ta='center'>
                            {presetEmail
                                ? 'Enter the six-digit code sent to your teacher email. Codes expire after 10 minutes.'
                                : 'Enter your teacher email to receive a six-digit code. Codes expire after 10 minutes.'}
                        </Text>
                    </Stack>

                    <form onSubmit={handleSubmit}>
                        <Stack gap='md'>
                            <TextInput
                                label='Teacher Email'
                                placeholder='teacher@school.example'
                                type='email'
                                required
                                autoComplete='email'
                                value={address}
                                onChange={(event) =>
                                    setTypedEmail(event.currentTarget.value)
                                }
                                readOnly={Boolean(presetEmail)}
                                disabled={loading}
                                description={
                                    presetEmail
                                        ? 'The verification code was sent to this address.'
                                        : undefined
                                }
                            />

                            <VerificationCodeInput
                                digits={digits}
                                onChange={(next) => {
                                    setDigits(next);
                                    if (invalidCode) setInvalidCode(false);
                                }}
                                disabled={loading || resendLoading}
                                invalid={invalidCode}
                            />

                            {error && (
                                <Alert
                                    icon={<IconAlertCircle size={16} />}
                                    title='Unable to continue'
                                    color='red'
                                >
                                    {error}
                                </Alert>
                            )}
                            {message && (
                                <Alert color='teal' role='status'>
                                    {message}
                                </Alert>
                            )}

                            <Button
                                fullWidth
                                type='submit'
                                loading={loading}
                                disabled={resendLoading}
                                mt={error ? '' : 'md'}
                                size='md'
                            >
                                Verify Email
                            </Button>
                        </Stack>
                    </form>

                    <Button
                        variant='subtle'
                        onClick={() => void resendCode()}
                        loading={resendLoading}
                        disabled={
                            loading ||
                            !address ||
                            resendSeconds > 0
                        }
                    >
                        {resendSeconds > 0
                            ? `Resend code in ${resendSeconds}s`
                            : 'Resend Verification Email'}
                    </Button>

                    <Stack align='center' gap='xs'>
                        <Anchor
                            component='button'
                            onClick={() => {
                                // An unverified session is held on this screen, so
                                // leaving it ends that session.
                                if (needsSignOut) {
                                    void authClient.signOut().then(() =>
                                        navigate('/'),
                                    );
                                    return;
                                }
                                navigate('/');
                            }}
                        >
                            Back to login
                        </Anchor>
                        {session && (
                            <Anchor
                                component='button'
                                onClick={() => {
                                    void authClient.signOut().then(() =>
                                        navigate('/'),
                                    );
                                }}
                            >
                                Sign out
                            </Anchor>
                        )}
                    </Stack>
                </Stack>
            </Paper>
        </Container>
    );
};

export default VerifyEmail;
