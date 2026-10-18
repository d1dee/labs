import { emailOTPClient, usernameClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
    basePath: '/api/auth',
    fetchOptions: {
        credentials: 'include',
    },
    sessionOptions: {
        refetchInterval: 10,
        refetchOnWindowFocus: true,
        refetchWhenOffline: false,
    },
    plugins: [usernameClient(), emailOTPClient()],
});

export const { signIn, signUp, signOut, getSession, useSession } = authClient;

// joinKey is request-only; organizationId remains a server-owned user field.
export const registerTeacher = (body: {
    name: string;
    username: string;
    email: string;
    password: string;
    callbackURL: string;
    joinKey?: string;
}) => authClient.$fetch('/sign-up/email', { method: 'POST', body });
