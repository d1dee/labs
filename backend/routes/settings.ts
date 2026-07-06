import { eq } from 'drizzle-orm';
import z from 'zod';
import { db } from '../../db/database';
import { firewallConfig } from '../../db/schema';
import { createApp } from './context';

export const settingsRouter = createApp();

settingsRouter.post('/settings/firewall', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    try {
        const schema = z.object({
            id: z.string().length(12).optional(),
            mikrotikBaseUrl: z.url(),
            mikrotikUsername: z.string(),
            mikrotikPassword: z.string(),
            mikrotikInsecure: z.boolean(),

            labs: z
                .array(
                    z.object({
                        name: z.string(),
                        ruleId: z.string(),
                    }),
                )
                .optional(),
        });

        const body = schema.parse(await c.req.json());

        const existingConfig = body.id
            ? await db
                  .select()
                  .from(firewallConfig)
                  .where(eq(firewallConfig.id, body.id))
                  .get()
            : null;

        if (existingConfig && body.id) {
            const data = {
                mikrotikBaseUrl: body.mikrotikBaseUrl,
                mikrotikUsername: body.mikrotikUsername,
                mikrotikPassword: body.mikrotikPassword,
                mikrotikInsecure: body.mikrotikInsecure,

                labs: body.labs
                    ? JSON.stringify(body.labs)
                    : existingConfig?.labs,
                updatedAt: new Date(),
            };
            const res = await db
                .update(firewallConfig)
                .set(data)
                .where(eq(firewallConfig.id, body.id))
                .returning();
            return c.json({
                success: true,
                message: 'MikroTik configuration saved successfully!',
                data: res[0],
            });
        } else {
            const res = await db
                .insert(firewallConfig)
                .values({
                    id: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
                    organizationId: user.organizationId,
                    mikrotikBaseUrl: body.mikrotikBaseUrl,
                    mikrotikUsername: body.mikrotikUsername,
                    mikrotikPassword: body.mikrotikPassword,
                    mikrotikInsecure: body.mikrotikInsecure,
                    labs: body.labs ? JSON.stringify(body.labs) : '[]',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                })
                .returning();
            return c.json({
                success: true,
                message: 'MikroTik configuration saved successfully!',
                data: res[0],
            });
        }
    } catch (error) {
        console.error('Failed to save firewall settings:', error);
        return c.json({ error: String(error) }, 500);
    }
});

settingsRouter.get('/settings/firewall', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json(
            {
                error: 'You must join an organization first',
                code: 'ORG_MISSING',
            },
            403,
        );
    }

    try {
        const storedConfig = await db
            .select()
            .from(firewallConfig)
            .where(eq(firewallConfig.organizationId, user.organizationId))
            .get();

        if (!storedConfig) {
            return c.json(
                {
                    error: 'Firewall configuration not found. Please configure firewall settings in Settings.',
                    code: 'CONFIG_MISSING',
                },
                404,
            );
        }

        return c.json({
            id: storedConfig.id,
            mikrotik: {
                baseUrl: storedConfig.mikrotikBaseUrl,
                username: storedConfig.mikrotikUsername,
                password: '',
                insecure: storedConfig.mikrotikInsecure,
            },
            labs: JSON.parse(storedConfig.labs || '[]'),
        });
    } catch (error) {
        console.error('Failed to load firewall settings:', error);
        return c.json({ error: String(error) }, 500);
    }
});
