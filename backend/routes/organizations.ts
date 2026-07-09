import { eq } from 'drizzle-orm';
import z from 'zod';
import { db } from '../../db/database';
import { organization, user as userTable } from '../../db/schema';
import { createApp } from './context';

export async function regenerateOrganizationJoinKey(orgId: string) {
    const newJoinKey = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const updatedOrg = await db
        .update(organization)
        .set({ joinKey: newJoinKey, updatedAt: new Date() })
        .where(eq(organization.id, orgId))
        .returning();
    return updatedOrg[0];
}

export const organizationsRouter = createApp();

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
                    joinKey: orgData.joinKey,
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
                .min(4, 'Organization name must be at least 2 characters'),
            email: z
                .email('Invalid email address')
                .min(1, 'Contact information is required'),
            phoneNumber: z.string(),
        });
        const validatedBody = orgSchema.parse(body);
        // Create organization
        const result = await db
            .insert(organization)
            .values({
                name: validatedBody.name,
                email: validatedBody.email,
                phoneNumber: validatedBody.phoneNumber,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returning();

        if (!result || result.length === 0 || !result[0]) {
            return c.json({ error: 'Failed to create organization' }, 500);
        }
        const newOrgId = result[0].id;

        // Add user to organization
        await db
            .update(userTable)
            .set({ organizationId: newOrgId, updatedAt: new Date() })
            .where(eq(userTable.id, user.id));

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
        await db
            .update(userTable)
            .set({ organizationId: null, updatedAt: new Date() })
            .where(eq(userTable.id, user.id));

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
