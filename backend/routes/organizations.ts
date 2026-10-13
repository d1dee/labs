import { and, eq } from 'drizzle-orm';
import z from 'zod';
import { db } from '../../db/database';
import { organization, user as userTable } from '../../db/schema';
import { createApp } from './context';
import { isDemoUser } from '../demo';

export async function regenerateOrganizationJoinKey(orgId: string) {
    const newJoinKey = crypto.randomUUID().replace(/-/g, '');
    const updatedOrg = await db
        .update(organization)
        .set({ joinKey: newJoinKey, updatedAt: new Date() })
        .where(eq(organization.id, orgId))
        .returning();
    return updatedOrg[0];
}

export const organizationsRouter = createApp();

organizationsRouter.use('/organizations/*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && isDemoUser(c.get('user'))) {
        return c.json({ error: 'Demo users cannot change organization membership', code: 'DEMO_READ_ONLY' }, 403);
    }
    await next();
});

organizationsRouter.get('/organizations', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    try {
        const userData = await db
            .select({ organizationId: userTable.organizationId })
            .from(userTable)
            .where(eq(userTable.id, user.id))
            .get();

        if (!userData?.organizationId) {
            return c.json({ organizations: [] });
        }

        const orgData = await db
            .select()
            .from(organization)
            .where(eq(organization.id, userData.organizationId))
            .get();

        if (!orgData) {
            return c.json({ organizations: [] });
        }

        // Get all members of the organization
        const members = await db
            .select()
            .from(userTable)
            .where(eq(userTable.organizationId, orgData.id));

        return c.json({
            organizations: [
                {
                    id: orgData.id,
                    name: orgData.name,
                    email: orgData.email,
                    phoneNumber: orgData.phoneNumber,
                    joinKey: isDemoUser(user) ? '' : orgData.joinKey,
                    members: members.map((m) => ({
                        id: m.id,
                        name: m.name,
                        email: m.email,
                        username: m.displayUsername,
                    })),
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
        const result = db.transaction((tx) => {
            const result = tx
                .insert(organization)
                .values({
                    name: validatedBody.name,
                    email: validatedBody.email,
                    phoneNumber: validatedBody.phoneNumber,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                })
                .returning().all();

            if (!result[0]) throw new Error('Failed to create organization');
            const updated = tx
                .update(userTable)
                .set({ organizationId: result[0].id, updatedAt: new Date() })
                .where(eq(userTable.id, user.id))
                .returning({ id: userTable.id }).all();
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
            },
        });
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: 'Invalid organization details' }, 400);
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
        // Check if organization exists
        const orgData = await db
            .select()
            .from(organization)
            .where(eq(organization.joinKey, joinKey))
            .get();

        if (!orgData) {
            return c.json({ error: 'Organization not found' }, 404);
        }

        // Add user to organization
        await db
            .update(userTable)
            .set({ organizationId: orgData.id, updatedAt: new Date() })
            .where(eq(userTable.id, user.id));

        return c.json({
            success: true,
            organization: {
                id: orgData.id,
                name: orgData.name,
                email: orgData.email,
                phoneNumber: orgData.phoneNumber,
                joinKey: orgData.joinKey,
            },
        });
    } catch (error) {
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
        // Remove user from organization
        const removed = await db
            .update(userTable)
            .set({ organizationId: null, updatedAt: new Date() })
            .where(and(eq(userTable.id, user.id), eq(userTable.organizationId, orgId)))
            .returning({ id: userTable.id });

        if (!removed[0]) return c.json({ error: 'You are not a member of this organization' }, 403);

        return c.json({ success: true });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
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
            const userData = await db
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
            const updatedOrg = await regenerateOrganizationJoinKey(orgId);

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
                },
            });
        } catch (error) {
            return c.json({ error: String(error) }, 500);
        }
    },
);
