import { usernameClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
    basePath: '/api/auth',
    fetchOptions: {
        credentials: 'include',
    },
    sessionOptions: {
        refetchOnWindowFocus: true,
        refetchWhenOffline: false,
    },
    plugins: [usernameClient()],
});

export const { signIn, signUp, signOut, getSession, useSession } = authClient;
