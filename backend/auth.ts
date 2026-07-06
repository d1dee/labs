import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { username } from 'better-auth/plugins';
import { db } from '../db/database';
import * as schema from '../db/schema';

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        schema: schema,
        provider: 'sqlite',
    }),

    trustedOrigins: [
        'http://localhost:5173',
        'http://localhost:3000',
        ...(process.env.TRUSTED_ORIGINS?.split(',') || []),
    ],

    emailAndPassword: {
        enabled: true,
        maxPasswordLength: 16,
        minPasswordLength: 4,
        allowUserSignUp: process.env.ALLOW_SIGNUP === 'true',
        autoSignIn: true,
        requireEmailVerification: false,
    },

    plugins: [
        username({
            minUsernameLength: 2,
            maxUsernameLength: 30,
            usernameNormalization: (username) => username.toLowerCase(),
        }),
    ],

    user: {
        additionalFields: {
            organizationId: {
                type: 'string',
                required: false,
                input: false,
            },
        },
    },

    session: {
        expiresIn: 60 * 60 * 24 * 7,
        updateAge: 60 * 60 * 24,
        cookieCache: {
            enabled: true,
            maxAge: 60 * 5,
        },
    },

    account: {
        accountLinking: {
            enabled: false,
        },
    },

    advanced: {
        useSecureCookies: process.env.NODE_ENV === 'production',
        defaultCookieAttributes: {
            sameSite: 'lax',
            path: '/',
        },
    },
});

// Export the session API helper for server-side auth checks
export const getSession = auth.api.getSession;
