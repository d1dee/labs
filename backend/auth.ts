import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { emailOTP, username } from 'better-auth/plugins';
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
        },

        disabledPaths: [
            '/sign-in/email-otp',
            '/email-otp/check-verification-otp',
            '/email-otp/request-password-reset',
            '/forget-password/email-otp',
            '/email-otp/reset-password',
            '/email-otp/request-email-change',
            '/email-otp/change-email',
        ],

        hooks: {
            before: createAuthMiddleware(async (ctx) => {
                if (ctx.path === '/email-otp/send-verification-otp' &&
                    ctx.body?.type !== 'email-verification') {
                    throw new APIError('BAD_REQUEST', { message: 'Only email verification codes are supported.' });
                }
                if (['/sign-up/email', '/sign-in/username'].includes(ctx.path) &&
                    typeof ctx.body?.username === 'string') {
                    ctx.body.username = ctx.body.username.trim().toLowerCase();
                }
                if (['/sign-up/email', '/sign-in/email'].includes(ctx.path) &&
                    typeof ctx.body?.email === 'string') {
                    ctx.body.email = ctx.body.email.trim().toLowerCase();
                }
                if (
                    [
                        '/sign-up/email',
                        '/request-password-reset',
                        '/send-verification-email',
                        '/email-otp/send-verification-otp',
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
                if (typeof ctx.body?.username !== 'string' ||
                    !/^[a-z0-9_.]{2,30}$/.test(ctx.body.username)) {
                    throw new APIError('BAD_REQUEST', {
                        code: 'INVALID_USERNAME',
                        message: 'Username must contain 2 to 30 letters, numbers, dots, or underscores.',
                    });
                }
                ctx.body.name ??= ctx.body.username;
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
            after: createAuthMiddleware(async (ctx) => {
                const returned = ctx.context.returned;
                if (!['/sign-in/email', '/sign-in/username'].includes(ctx.path) ||
                    !(returned instanceof APIError) || returned.body?.code !== 'EMAIL_NOT_VERIFIED') return;
                // Both credential endpoints verify the password before returning this error.
                const identifier = ctx.path === '/sign-in/username' ? ctx.body?.username : ctx.body?.email;
                if (typeof identifier !== 'string') return;
                const user = await database.select({ email: schema.user.email })
                    .from(schema.user)
                    .where(eq(ctx.path === '/sign-in/username' ? schema.user.username : schema.user.email,
                        identifier.trim().toLowerCase()))
                    .get();
                if (user) return ctx.json({
                    code: 'EMAIL_NOT_VERIFIED',
                    message: returned.body.message,
                    email: user.email,
                }, { status: 403 });
            }),
        },

        databaseHooks: {
            verification: {
                create: {
                    before: async (verification) => {
                        if (!verification.identifier.startsWith('email-verification-otp-')) return;
                        // SQLite timestamps have second precision; tied codes otherwise
                        // make Better Auth select an older code after a quick resend.
                        await database.delete(schema.verification)
                            .where(eq(schema.verification.identifier, verification.identifier));
                    },
                },
            },
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
                usernameNormalization: (username) => username.trim().toLowerCase(),
            }),
            emailOTP({
                overrideDefaultEmailVerification: true,
                storeOTP: 'hashed',
                otpLength: 6,
                expiresIn: 600,
                allowedAttempts: 3,
                disableSignUp: true,
                sendVerificationOTP: async ({ email, otp, type }) => {
                    if (type !== 'email-verification') return;
                    await sendAuthEmail(email, 'Verify your Labs FCD email',
                        `Your verification code is ${otp} (valid for 10 minutes).\n\nThen sign in to access your labs.`);
                },
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
