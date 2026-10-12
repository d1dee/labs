import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { username } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import * as schema from '../db/schema';
import { requireAuthEmailConfig, sendAuthEmail } from './auth-email';

export const createAuth = (database = db) =>
    betterAuth({
        database: drizzleAdapter(database, {
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
            disableSignUp: process.env.ALLOW_SIGNUP !== 'true',
            autoSignIn: false,
            requireEmailVerification: true,
            revokeSessionsOnPasswordReset: true,
            sendResetPassword: async ({ user, url }) => {
                void sendAuthEmail(
                    user.email,
                    'Reset your Labs FCD password',
                    `Reset your password using this link (valid for one hour): ${url}\n\nIf you did not request this, ignore this email.`,
                ).catch((error) =>
                    console.error(
                        'Password reset email failed:',
                        error.message,
                    ),
                );
            },
        },

        emailVerification: {
            sendOnSignUp: true,
            sendOnSignIn: true,
            autoSignInAfterVerification: false,
            expiresIn: 60 * 60,
            sendVerificationEmail: async ({ user, url }) => {
                void sendAuthEmail(
                    user.email,
                    'Verify your Labs FCD email',
                    `Verify your teacher email using this link (valid for one hour): ${url}\n\nThen sign in to access your labs.`,
                ).catch((error) =>
                    console.error('Verification email failed:', error.message),
                );
            },
        },

        hooks: {
            before: createAuthMiddleware(async (ctx) => {
                if (
                    [
                        '/sign-up/email',
                        '/request-password-reset',
                        '/send-verification-email',
                    ].includes(ctx.path)
                ) {
                    try {
                        requireAuthEmailConfig();
                    } catch {
                        throw new APIError('SERVICE_UNAVAILABLE', {
                            message:
                                'Authentication email is not configured. Please contact your administrator.',
                        });
                    }
                }
                if (ctx.path !== '/sign-up/email') return;
                if (process.env.ALLOW_SIGNUP !== 'true') {
                    throw new APIError('FORBIDDEN', {
                        message: 'New account registration is disabled.',
                    });
                }
                if (
                    typeof ctx.body?.email === 'string' &&
                    /@(?:local\.lan|localhost)$/i.test(ctx.body.email.trim())
                ) {
                    throw new APIError('BAD_REQUEST', {
                        message:
                            'Enter a real teacher email address that can receive verification mail.',
                    });
                }
                const joinKey = ctx.body?.joinKey;
                if (
                    joinKey != null &&
                    (typeof joinKey !== 'string' || joinKey.trim().length > 128)
                ) {
                    throw new APIError('BAD_REQUEST', {
                        message: 'Invalid organization join key.',
                    });
                }
                if (typeof joinKey === 'string' && joinKey.trim()) {
                    const organization = await database
                        .select({ id: schema.organization.id })
                        .from(schema.organization)
                        .where(eq(schema.organization.joinKey, joinKey.trim()))
                        .get();
                    if (!organization)
                        throw new APIError('BAD_REQUEST', {
                            message: 'Organization join key was not found.',
                        });
                }
            }),
        },

        databaseHooks: {
            user: {
                create: {
                    before: async (user, ctx) => {
                        if (ctx?.path !== '/sign-up/email') return;
                        const joinKey = ctx.body?.joinKey;
                        if (typeof joinKey !== 'string' || !joinKey.trim())
                            return;
                        const organization = await database
                            .select({ id: schema.organization.id })
                            .from(schema.organization)
                            .where(
                                eq(schema.organization.joinKey, joinKey.trim()),
                            )
                            .get();
                        if (!organization)
                            throw new APIError('BAD_REQUEST', {
                                message: 'Organization join key was not found.',
                            });
                        return {
                            data: { ...user, organizationId: organization.id },
                        };
                    },
                },
            },
        },

        rateLimit: {
            enabled: false,
            customRules: {
                // Background polling must not accumulate requests in the inactivity-based limiter.
                '/get-session': false,
                '/sign-up/email': { window: 60, max: 5 },
                '/request-password-reset': { window: 60, max: 3 },
                '/send-verification-email': { window: 60, max: 3 },
            },
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
                enabled: false,
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

export const auth = createAuth();

// Export the session API helper for server-side auth checks
export const getSession = auth.api.getSession;
