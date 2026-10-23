import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import z from 'zod';
import { db } from '../../db/database';
import {
    account,
    activationHistory,
    dataUsageHistory,
    demoState,
    firewallConfig,
    fogConfig,
    lab,
    organization,
    organizationComputerInventory,
    organizationDeviceCache,
    organizationDeviceLab,
    piholeConfig,
    session,
    user as userTable,
    verification,
    veyonComputer,
    veyonConfig,
} from '../../db/index';
import { auth, trustedOrigins } from '../auth';
import { isDemoUser } from '../demo';
import { invalidateOrganizationDevices } from '../devices';
import { clearVeyonConnections } from '../veyon';
import { veyonPoller } from '../veyon-poller';
import { clearFogClient } from '../fog';
import { clearPiholeClient } from '../pihole';
import {
    findOrganizationByJoinKey,
    withUniqueJoinKey,
} from '../join-key';
import { getLogger } from '../logger';
import { createApp } from './context';

const logger = getLogger(['labs', 'organizations']);
type DeletionProtectionReason = 'institution_creator' | 'self' | 'demo' | null;

function deletionProtectionReason(
    actorId: string,
    target: { id: string; username: string | null },
    ownsOrganization: boolean,
): DeletionProtectionReason {
    if (target.id === actorId) return 'self';
    if (isDemoUser(target)) return 'demo';
    return ownsOrganization ? 'institution_creator' : null;
}

export async function regenerateOrganizationJoinKey(
    orgId: string,
    database = db,
) {
    return withUniqueJoinKey(database, (tx, joinKey) => tx
        .update(organization)
        .set({ joinKey, updatedAt: new Date() })
        .where(eq(organization.id, orgId))
        .returning()
        .get());
}

export function createOrganizationsRouter(
    database = db,
    authentication = auth,
) {
    const organizationsRouter = createApp();
    // Bound both retained failures and concurrent expensive password verifications.
    const confirmations = new Map<
        string,
        { failures: number; expiresAt: number; inFlight: boolean }
    >();
    const confirmationWindowMs = 15 * 60 * 1000;
    const maxConfirmationActors = 1000;

    organizationsRouter.use('/organizations/*', async (c, next) => {
        if (
            !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
            isDemoUser(c.get('user'))
        ) {
            return c.json(
                {
                    error: 'Demo users cannot change organization membership',
                    code: 'DEMO_READ_ONLY',
                },
                403,
            );
        }
        await next();
    });

    organizationsRouter.get('/organizations', async (c) => {
        const user = c.get('user');
        if (!user) {
            return c.json({ error: 'Not authenticated' }, 401);
        }

        try {
            const userData = await database
                .select({
                    organizationId: userTable.organizationId,
                    emailVerified: userTable.emailVerified,
                    username: userTable.username,
                })
                .from(userTable)
                .where(eq(userTable.id, user.id))
                .get();

            if (!userData?.organizationId) {
                return c.json({ organizations: [] });
            }

            const orgData = await database
                .select()
                .from(organization)
                .where(eq(organization.id, userData.organizationId))
                .get();

            if (!orgData) {
                return c.json({ organizations: [] });
            }
            const canDeleteMembers =
                orgData.createdByUserId === user.id &&
                userData.emailVerified &&
                !isDemoUser(userData) &&
                !isDemoUser(user);

            // Get all members of the organization
            const members = await database
                .select({
                    id: userTable.id,
                    name: userTable.name,
                    email: userTable.email,
                    displayUsername: userTable.displayUsername,
                    username: userTable.username,
                    lastLoginAt: userTable.lastLoginAt,
                    emailVerified: userTable.emailVerified,
                    hasActiveSession: sql<number>`count(${session.id})`,
                    ownsOrganization: sql<number>`count(${organization.id})`,
                })
                .from(userTable)
                .leftJoin(
                    session,
                    and(
                        eq(session.userId, userTable.id),
                        gt(session.expiresAt, new Date()),
                    ),
                )
                .leftJoin(
                    organization,
                    eq(organization.createdByUserId, userTable.id),
                )
                .where(eq(userTable.organizationId, orgData.id))
                .groupBy(userTable.id);

            return c.json({
                organizations: [
                    {
                        id: orgData.id,
                        name: orgData.name,
                        email: orgData.email,
                        phoneNumber: orgData.phoneNumber,
                        joinKey: isDemoUser(user) ? '' : orgData.joinKey,
                        createdByUserId: orgData.createdByUserId,
                        canDeleteMembers,
                        members: members.map((m) => {
                            const protection = canDeleteMembers
                                ? deletionProtectionReason(
                                      user.id,
                                      m,
                                      Boolean(m.ownsOrganization),
                                  )
                                : null;
                            return {
                                id: m.id,
                                name: m.name,
                                email: m.email,
                                username: m.displayUsername,
                                lastLoginAt:
                                    m.lastLoginAt?.toISOString() ?? null,
                                hasActiveSession: Boolean(m.hasActiveSession),
                                canReceiveOwnership: m.id !== user.id && m.emailVerified && !isDemoUser(m),
                                canDeleteAccount:
                                    canDeleteMembers && protection === null,
                                deletionProtectionReason: protection,
                            };
                        }),
                    },
                ],
            });
        } catch (error) {
            return c.json({ error: String(error) }, 500);
        }
    });

    organizationsRouter.post('/organizations', async (c) => {
        const user = c.get('user');
        if (!user) {
            return c.json({ error: 'Not authenticated' }, 401);
        }

        try {
            const body = await c.req.json();

            const orgSchema = z.object({
                name: z
                    .string()
                    .min(4, 'Organization name must be at least 4 characters'),
                email: z
                    .email('Invalid email address')
                    .min(1, 'Contact information is required'),
                phoneNumber: z.string(),
            });
            const validatedBody = orgSchema.parse(body);
            // Create organization
            const result = withUniqueJoinKey(database, (tx, joinKey) => {
                const actor = tx.select().from(userTable)
                    .where(eq(userTable.id, user.id)).get();
                if (actor?.organizationId) {
                    throw new HTTPException(409, {
                        message: 'Leave your current organization before creating another',
                    });
                }
                const result = tx
                    .insert(organization)
                    .values({
                        name: validatedBody.name,
                        email: validatedBody.email,
                        phoneNumber: validatedBody.phoneNumber,
                        joinKey,
                        createdByUserId: user.id,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    })
                    .returning()
                    .all();

                if (!result[0])
                    throw new Error('Failed to create organization');
                const updated = tx
                    .update(userTable)
                    .set({
                        organizationId: result[0].id,
                        updatedAt: new Date(),
                    })
                    .where(eq(userTable.id, user.id))
                    .returning({ id: userTable.id })
                    .all();
                if (!updated[0]) throw new Error('User not found');
                return result;
            });

            if (!result || result.length === 0 || !result[0]) {
                return c.json({ error: 'Failed to create organization' }, 500);
            }
            const newOrgId = result[0].id;

            return c.json({
                success: true,
                organization: {
                    id: newOrgId,
                    name: result[0].name,
                    email: result[0].email,
                    phoneNumber: result[0].phoneNumber,
                    joinKey: result[0].joinKey,
                    createdByUserId: result[0].createdByUserId,
                    canDeleteMembers:
                        Boolean(user.emailVerified) && !isDemoUser(user),
                },
            });
        } catch (error) {
            if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
            if (error instanceof z.ZodError || error instanceof SyntaxError)
                return c.json({ error: 'Invalid organization details' }, 400);
            return c.json({ error: String(error) }, 500);
        }
    });

    organizationsRouter.post('/organizations/:joinKey/join', async (c) => {
        const user = c.get('user');
        if (!user) {
            return c.json({ error: 'Not authenticated' }, 401);
        }

        const joinKey = c.req.param('joinKey');

        try {
            // Serialize joins against sole-member deletion so membership cannot dangle.
            const orgData = database.transaction((tx) => {
                const destination = findOrganizationByJoinKey(tx, joinKey);
                if (!destination) throw new HTTPException(404, { message: 'Organization not found' });
                const joined = tx
                    .update(userTable)
                    .set({ organizationId: destination.id, updatedAt: new Date() })
                    .where(and(
                        eq(userTable.id, user.id),
                        or(isNull(userTable.organizationId), eq(userTable.organizationId, destination.id)),
                    ))
                    .returning({ id: userTable.id }).all();
                if (!joined[0]) throw new HTTPException(409, { message: 'Leave your current organization before joining another' });
                return destination;
            }, { behavior: 'immediate' });

            return c.json({
                success: true,
                organization: {
                    id: orgData.id,
                    name: orgData.name,
                    email: orgData.email,
                    phoneNumber: orgData.phoneNumber,
                    joinKey: orgData.joinKey,
                    createdByUserId: orgData.createdByUserId,
                    canDeleteMembers:
                        orgData.createdByUserId === user.id &&
                        Boolean(user.emailVerified) &&
                        !isDemoUser(user),
                },
            });
        } catch (error) {
            if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
            return c.json({ error: String(error) }, 500);
        }
    });

    organizationsRouter.post('/organizations/:orgId/leave', async (c) => {
        const user = c.get('user');
        if (!user) {
            return c.json({ error: 'Not authenticated' }, 401);
        }

        const orgId = c.req.param('orgId');

        try {
            const origin = c.req.header('Origin');
            if (!origin || ![new URL(c.req.url).origin, ...trustedOrigins()].includes(origin)) {
                return c.json({ error: 'Untrusted request origin' }, 403);
            }
            const body = z.object({
                confirmOrganizationName: z.string().optional(),
                newCreatorUserId: z.string().min(1).optional(),
            }).parse(await c.req.json());
            const result = database.transaction((tx) => {
                const actor = tx.select().from(userTable)
                    .where(eq(userTable.id, user.id)).get();
                const org = tx.select().from(organization)
                    .where(eq(organization.id, orgId)).get();
                if (!actor || actor.organizationId !== orgId || !actor.emailVerified || isDemoUser(actor) || !org) {
                    throw new HTTPException(403, { message: 'You are not a verified member of this organization' });
                }
                const members = tx.select().from(userTable)
                    .where(eq(userTable.organizationId, orgId)).all();
                const soleMember = members.length === 1;
                if (soleMember) {
                    if (body.newCreatorUserId) {
                        throw new HTTPException(409, {
                            message: 'Membership changed. Confirm organization deletion before leaving',
                        });
                    }
                    if (body.confirmOrganizationName !== org.name) {
                        throw new HTTPException(400, {
                            message: 'Type the exact organization name to permanently delete it and all its data',
                        });
                    }
                } else {
                    if (body.confirmOrganizationName !== undefined) {
                        throw new HTTPException(409, {
                            message: 'Other members remain. Refresh and review the leave options',
                        });
                    }
                    if (org.createdByUserId === user.id) {
                        const successor = members.find((member) =>
                            member.id === body.newCreatorUserId && member.id !== user.id);
                        if (!successor || isDemoUser(successor) || !successor.emailVerified) {
                            throw new HTTPException(400, {
                                message: 'Select another verified member as the new admin (creator) before leaving',
                            });
                        }
                        tx.update(organization)
                            .set({ createdByUserId: successor.id, updatedAt: new Date() })
                            .where(eq(organization.id, orgId)).run();
                    } else if (body.newCreatorUserId) {
                        throw new HTTPException(409, { message: 'Only the current creator can transfer admin ownership' });
                    }
                }
                tx.update(userTable).set({ organizationId: null, updatedAt: new Date() })
                    .where(eq(userTable.id, user.id)).run();
                if (!soleMember) return { deleted: false, fogUrls: [], piholeUrls: [] };

                // Explicit cleanup also covers installations with legacy non-cascading foreign keys.
                const fogUrls = tx.select({ url: fogConfig.url }).from(fogConfig)
                    .where(eq(fogConfig.organizationId, orgId)).all().map((config) => config.url);
                const piholeUrls = tx.select({ url: piholeConfig.url }).from(piholeConfig)
                    .where(eq(piholeConfig.organizationId, orgId)).all().map((config) => config.url);
                const firewalls = tx.select({ id: firewallConfig.id }).from(firewallConfig)
                    .where(eq(firewallConfig.organizationId, orgId));
                const labs = tx.select({ id: lab.id }).from(lab)
                    .where(inArray(lab.firewallConfigId, firewalls));
                tx.delete(activationHistory).where(inArray(activationHistory.labId, labs)).run();
                tx.delete(dataUsageHistory).where(inArray(dataUsageHistory.labId, labs)).run();
                tx.delete(organizationDeviceLab).where(eq(organizationDeviceLab.organizationId, orgId)).run();
                tx.delete(lab).where(inArray(lab.firewallConfigId, firewalls)).run();
                for (const table of [
                    firewallConfig, piholeConfig, fogConfig, veyonConfig,
                    veyonComputer, organizationDeviceCache, organizationComputerInventory,
                ]) {
                    tx.delete(table).where(eq(table.organizationId, orgId)).run();
                }
                tx.delete(organization).where(eq(organization.id, orgId)).run();
                return { deleted: true, fogUrls, piholeUrls };
            }, { behavior: 'immediate' });
            if (result.deleted) {
                veyonPoller.forgetOrganization(orgId);
                result.fogUrls.forEach(clearFogClient);
                result.piholeUrls.forEach(clearPiholeClient);
                clearVeyonConnections(orgId);
                // The service uses the application database; injected test databases have no runtime cache.
                if (database === db) invalidateOrganizationDevices(orgId);
            }
            return c.json({ success: true, deleted: result.deleted });
        } catch (error) {
            if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
            if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: 'Invalid leave confirmation' }, 400);
            logger.error('Organization leave failed: {error}', { error });
            return c.json({ error: 'Failed to leave organization' }, 500);
        }
    });

    organizationsRouter.post(
        '/organizations/:orgId/regenerate-join-key',
        async (c) => {
            const user = c.get('user');
            if (!user) {
                return c.json({ error: 'Not authenticated' }, 401);
            }

            const orgId = c.req.param('orgId');

            try {
                // Verify user is member of this organization
                const userData = await database
                    .select({ organizationId: userTable.organizationId })
                    .from(userTable)
                    .where(eq(userTable.id, user.id))
                    .get();

                if (!userData || userData.organizationId !== orgId) {
                    return c.json(
                        { error: 'You are not a member of this organization' },
                        403,
                    );
                }

                // Regenerate join key
                const updatedOrg = await regenerateOrganizationJoinKey(
                    orgId,
                    database,
                );

                if (!updatedOrg) {
                    return c.json({ error: 'Organization not found' }, 404);
                }

                return c.json({
                    success: true,
                    organization: {
                        id: updatedOrg.id,
                        name: updatedOrg.name,
                        email: updatedOrg.email,
                        phoneNumber: updatedOrg.phoneNumber,
                        joinKey: updatedOrg.joinKey,
                        createdByUserId: updatedOrg.createdByUserId,
                        canDeleteMembers:
                            updatedOrg.createdByUserId === user.id &&
                            Boolean(user.emailVerified) &&
                            !isDemoUser(user),
                    },
                });
            } catch (error) {
                return c.json({ error: String(error) }, 500);
            }
        },
    );

    organizationsRouter.delete(
        '/organizations/:orgId/members/:userId/account',
        async (c) => {
            const requester = c.get('user');
            if (!requester) return c.json({ error: 'Not authenticated' }, 401);
            const origin = c.req.header('Origin');
            // Password confirmation is not a substitute for browser CSRF protection.
            if (
                !origin ||
                origin === 'null' ||
                ![new URL(c.req.url).origin, ...trustedOrigins()].includes(
                    origin,
                )
            ) {
                return c.json({ error: 'Untrusted request origin' }, 403);
            }
            const parsed = z
                .object({
                    password: z.string().min(1).max(1024),
                    confirmEmail: z.string().min(1).max(320),
                })
                .safeParse(await c.req.json().catch(() => null));
            if (!parsed.success)
                return c.json(
                    { error: 'Invalid account deletion details' },
                    400,
                );

            const orgId = c.req.param('orgId');
            const targetId = c.req.param('userId');
            let reservation:
                | { failures: number; expiresAt: number; inFlight: boolean }
                | undefined;
            try {
                const currentSession = c.get('session');
                const actor =
                    currentSession &&
                    database
                        .select({ username: userTable.username })
                        .from(userTable)
                        .innerJoin(
                            organization,
                            and(
                                eq(organization.id, orgId),
                                eq(organization.createdByUserId, userTable.id),
                            ),
                        )
                        .innerJoin(
                            session,
                            and(
                                eq(session.id, currentSession.id),
                                eq(session.userId, userTable.id),
                                gt(session.expiresAt, new Date()),
                            ),
                        )
                        .where(
                            and(
                                eq(userTable.id, requester.id),
                                eq(userTable.organizationId, orgId),
                                eq(userTable.emailVerified, true),
                            ),
                        )
                        .get();
                if (!actor || isDemoUser(actor)) {
                    if (!confirmations.get(requester.id)?.inFlight)
                        confirmations.delete(requester.id);
                    return c.json(
                        {
                            error: 'Only the verified organization creator can delete member accounts',
                        },
                        403,
                    );
                }

                const now = Date.now();
                for (const [id, entry] of confirmations) {
                    if (!entry.inFlight && entry.expiresAt <= now)
                        confirmations.delete(id);
                }
                const existing = confirmations.get(requester.id);
                if (
                    existing?.inFlight ||
                    (existing && existing.failures >= 5) ||
                    (!existing && confirmations.size >= maxConfirmationActors)
                ) {
                    const retryAfter = existing?.inFlight
                        ? 1
                        : Math.max(
                              1,
                              Math.ceil(
                                  ((existing?.expiresAt ??
                                      now + confirmationWindowMs) -
                                      now) /
                                      1000,
                              ),
                          );
                    c.header('Retry-After', String(retryAfter));
                    return c.json(
                        {
                            error: 'Too many password confirmation attempts. Try again later.',
                            code: 'CONFIRMATION_RATE_LIMITED',
                        },
                        429,
                    );
                }
                reservation = existing ?? {
                    failures: 0,
                    expiresAt: now + confirmationWindowMs,
                    inFlight: false,
                };
                reservation.inFlight = true;
                reservation.failures++;
                confirmations.set(requester.id, reservation);

                const credential = database
                    .select({ id: account.id, password: account.password })
                    .from(account)
                    .where(
                        and(
                            eq(account.userId, requester.id),
                            eq(account.providerId, 'credential'),
                        ),
                    )
                    .get();
                let validPassword = false;
                if (credential?.password) {
                    try {
                        validPassword = await (
                            await authentication.$context
                        ).password.verify({
                            hash: credential.password,
                            password: parsed.data.password,
                        });
                    } catch {
                        /* Malformed/missing credentials fail closed. */
                    }
                }
                if (!validPassword || !credential?.password) {
                    logger.warn(
                        'Member account deletion password verification failed',
                        { actorId: requester.id, organizationId: orgId },
                    );
                    return c.json(
                        { error: 'Unable to verify your credentials' },
                        403,
                    );
                }
                reservation.failures = 0;

                // No await inside this write transaction. Recheck all authorization and the
                // verified credential after hashing, so concurrent logout/reset/moves fail closed.
                const result = database.transaction(
                    (tx) => {
                        const actor = tx
                            .select()
                            .from(userTable)
                            .where(eq(userTable.id, requester.id))
                            .get();
                        const org = tx
                            .select()
                            .from(organization)
                            .where(eq(organization.id, orgId))
                            .get();
                        const currentSession = c.get('session');
                        const liveSession =
                            currentSession &&
                            tx
                                .select({ id: session.id })
                                .from(session)
                                .where(
                                    and(
                                        eq(session.id, currentSession.id),
                                        eq(session.userId, requester.id),
                                        gt(session.expiresAt, new Date()),
                                    ),
                                )
                                .get();
                        const unchangedCredential = tx
                            .select({ id: account.id })
                            .from(account)
                            .where(
                                and(
                                    eq(account.id, credential.id),
                                    eq(account.userId, requester.id),
                                    eq(account.providerId, 'credential'),
                                    eq(account.password, credential.password!),
                                ),
                            )
                            .get();
                        if (
                            !actor?.emailVerified ||
                            isDemoUser(actor) ||
                            !liveSession ||
                            !unchangedCredential ||
                            actor.organizationId !== orgId ||
                            org?.createdByUserId !== actor.id
                        )
                            return 'forbidden';
                        const target = tx
                            .select()
                            .from(userTable)
                            .where(eq(userTable.id, targetId))
                            .get();
                        if (!target || target.organizationId !== orgId)
                            return 'missing';
                        const protection = deletionProtectionReason(
                            actor.id,
                            target,
                            Boolean(
                                tx
                                    .select({ id: organization.id })
                                    .from(organization)
                                    .where(
                                        eq(
                                            organization.createdByUserId,
                                            target.id,
                                        ),
                                    )
                                    .get(),
                            ),
                        );
                        if (protection) return protection;
                        if (parsed.data.confirmEmail !== target.email)
                            return 'email';

                        // Explicit cleanup also covers legacy installations without auth FKs.
                        tx.update(activationHistory)
                            .set({ triggeredBy: null })
                            .where(eq(activationHistory.triggeredBy, target.id))
                            .run();
                        tx.delete(demoState)
                            .where(eq(demoState.userId, target.id))
                            .run();
                        tx.delete(account)
                            .where(eq(account.userId, target.id))
                            .run();
                        tx.delete(session)
                            .where(eq(session.userId, target.id))
                            .run();
                        tx.delete(verification)
                            .where(
                                sql`${verification.identifier} in (${target.id}, ${target.email}, ${`email-verification-otp-${target.email}`}) or ${verification.value} = ${target.id}`,
                            )
                            .run();
                        tx.delete(userTable)
                            .where(eq(userTable.id, target.id))
                            .run();
                        return 'deleted';
                    },
                    { behavior: 'immediate' },
                );

                if (result === 'forbidden')
                    return c.json(
                        {
                            error: 'Only the verified organization creator can delete member accounts',
                        },
                        403,
                    );
                if (result === 'missing')
                    return c.json({ error: 'Member not found' }, 404);
                if (
                    result === 'self' ||
                    result === 'demo' ||
                    result === 'institution_creator'
                ) {
                    return c.json(
                        {
                            error: 'This account cannot be deleted',
                            code: 'ACCOUNT_PROTECTED',
                            deletionProtectionReason: result,
                        },
                        403,
                    );
                }
                if (result === 'email')
                    return c.json(
                        {
                            error: 'Confirmation email does not match the member account',
                        },
                        400,
                    );
                logger.info('Member account permanently deleted', {
                    actorId: requester.id,
                    organizationId: orgId,
                    deletedUserId: targetId,
                });
                return c.json({ success: true });
            } catch {
                logger.error('Member account deletion failed', {
                    actorId: requester.id,
                    organizationId: orgId,
                    targetUserId: targetId,
                });
                return c.json(
                    { error: 'Unable to delete member account' },
                    500,
                );
            } finally {
                if (reservation) {
                    reservation.inFlight = false;
                    if (
                        reservation.failures === 0 ||
                        reservation.expiresAt <= Date.now()
                    )
                        confirmations.delete(requester.id);
                }
            }
        },
    );

    return organizationsRouter;
}

export const organizationsRouter = createOrganizationsRouter();
