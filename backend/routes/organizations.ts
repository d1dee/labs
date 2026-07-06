import { eq } from 'drizzle-orm';
import { db } from '../../db/database';
import { organization, user as userTable } from '../../db/schema';
import { createApp } from './context';

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
                    ...orgData,
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
        const body = await c.req.json<{
            name: string;
            email: string;
            contacts: string;
        }>();

        const newOrgId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);

        // Create organization
        await db.insert(organization).values({
            id: newOrgId,
            name: body.name,
            email: body.email,
            contacts: body.contacts,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        // Add user to organization
        await db
            .update(userTable)
            .set({ organizationId: newOrgId, updatedAt: new Date() })
            .where(eq(userTable.id, user.id));

        return c.json({
            success: true,
            organization: {
                id: newOrgId,
                name: body.name,
                contacts: body.contacts,
            },
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

organizationsRouter.post('/organizations/:orgId/join', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    const orgId = c.req.param('orgId');

    try {
        // Check if organization exists
        const orgData = await db
            .select()
            .from(organization)
            .where(eq(organization.id, orgId))
            .get();

        if (!orgData) {
            return c.json({ error: 'Organization not found' }, 404);
        }

        // Add user to organization
        await db
            .update(userTable)
            .set({ organizationId: orgId, updatedAt: new Date() })
            .where(eq(userTable.id, user.id));

        return c.json({
            success: true,
            organization: orgData,
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
