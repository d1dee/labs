import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { username } from 'better-auth/plugins';
import { db } from './db/database';
import * as schema from './db/schema';

export const auth = betterAuth({
    database: drizzleAdapter(db, {
        schema: schema,
        provider: 'sqlite',
    }),

    emailAndPassword: {
        enabled: true,
        minPasswordLength: 4,
        maxPasswordLength: 16,
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
    },
});

export const getSession = auth.api.getSession;
