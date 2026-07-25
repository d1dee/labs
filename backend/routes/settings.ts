import { eq } from 'drizzle-orm';
import z from 'zod';
import { db } from '../../db/database';
import { firewallConfig, fogConfig, lab, piholeConfig } from '../../db/schema';
import {
    getFirewallConfigByIdWithLabs,
    getFirewallConfigWithLabs,
    mapLabs,
} from '../firewall-config';
import { getFogConfigForOrg, testFogConnection } from '../fog';
import { testMikrotikConnection } from '../mikrotik';
import {
    getPiholeConfigForOrg,
    testPiholeConnection,
} from '../pihole';
import { createApp } from './context';

export const settingsRouter = createApp();

settingsRouter.post('/settings/mikrotik', async (c) => {
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
        });

        const body = schema.parse(await c.req.json());

        // Verify connection to MikroTik with the provided credentials before saving
        const connectionTest = await testMikrotikConnection({
            baseUrl: body.mikrotikBaseUrl,
            username: body.mikrotikUsername,
            password: body.mikrotikPassword,
        });

        if (!connectionTest.success) {
            return c.json(
                {
                    message: `Failed to connect to MikroTik: ${connectionTest.error}`,
                    code: 'CONNECTION_FAILED',
                },
                400,
            );
        }

        const res = await db
            .insert(firewallConfig)
            .values({
                id: body.id,
                organizationId: user.organizationId,
                mikrotikBaseUrl: body.mikrotikBaseUrl,
                mikrotikUsername: body.mikrotikUsername,
                mikrotikPassword: body.mikrotikPassword,
                updatedAt: new Date(),
            })
            .onConflictDoUpdate({
                target: firewallConfig.id,
                set: {
                    mikrotikBaseUrl: body.mikrotikBaseUrl,
                    mikrotikUsername: body.mikrotikUsername,
                    mikrotikPassword: body.mikrotikPassword,
                    updatedAt: new Date(),
                },
            })
            .returning();

        const saved = res[0];
        const configWithLabs = saved
            ? await getFirewallConfigByIdWithLabs(saved.id)
            : undefined;

        return c.json({
            success: true,
            message: 'MikroTik configuration saved successfully!',
            data: configWithLabs
                ? {
                      ...configWithLabs,
                      labs: mapLabs(configWithLabs.labs),
                  }
                : undefined,
        });
    } catch (error) {
        console.error('Failed to save firewall settings:', error);
        return c.json({ error: String(error) }, 500);
    }
});

settingsRouter.post('/settings/labs', async (c) => {
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
            labs: z.array(
                z.object({
                    firewallId: z.string(),
                    name: z.string(),
                    description: z.string().optional(),
                }),
            ),
        });

        const body = schema.parse(await c.req.json());

        if (!body.id) {
            return c.json({ error: 'Configuration ID is required' }, 400);
        }

        const existingConfig = await getFirewallConfigByIdWithLabs(body.id);

        if (
            !existingConfig ||
            existingConfig.organizationId !== user.organizationId
        ) {
            return c.json({ error: 'Configuration not found' }, 404);
        }

        await db
            .delete(lab)
            .where(eq(lab.firewallConfigId, existingConfig.id));

        if (body.labs.length > 0) {
            await db.insert(lab).values(
                body.labs.map((l) => ({
                    firewallConfigId: existingConfig.id,
                    name: l.name,
                    ruleId: l.firewallId,
                    description: l.description ?? null,
                })),
            );
        }

        const configWithLabs = await getFirewallConfigByIdWithLabs(
            existingConfig.id,
        );

        return c.json({
            success: true,
            message: 'Labs saved successfully!',
            data: configWithLabs
                ? {
                      ...configWithLabs,
                      labs: mapLabs(configWithLabs.labs),
                  }
                : undefined,
        });
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
        const storedConfig = await getFirewallConfigWithLabs(
            user.organizationId,
        );

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
            mikrotikBaseUrl: storedConfig.mikrotikBaseUrl,
            mikrotikUsername: storedConfig.mikrotikUsername,
            mikrotikPassword: new Array(storedConfig.mikrotikPassword.length)
                .fill('*')
                .join(''),
            labs: mapLabs(storedConfig.labs),
        });
    } catch (error) {
        console.error('Failed to load firewall settings:', error);
        return c.json({ error: String(error) }, 500);
    }
});

// ===================== Pi-hole settings =====================

settingsRouter.get('/settings/pihole', async (c) => {
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
        const stored = await getPiholeConfigForOrg(user.organizationId);

        if (!stored) {
            return c.json({
                configured: false,
                url: '',
                password: '',
            });
        }

        return c.json({
            configured: true,
            url: stored.url,
            // Mask the password so the secret is never exposed to the client
            password: new Array(stored.password.length).fill('*').join(''),
        });
    } catch (error) {
        console.error('Failed to load Pi-hole settings:', error);
        return c.json({ error: String(error) }, 500);
    }
});

settingsRouter.post('/settings/pihole', async (c) => {
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
        const schema = z.object({
            id: z.string().length(12).optional(),
            url: z.url(),
            password: z.string().min(1),
        });

        const body = schema.parse(await c.req.json());

        // Verify connection to Pi-hole with the provided credentials before saving
        const connectionTest = await testPiholeConnection({
            url: body.url,
            password: body.password,
        });

        if (!connectionTest.success) {
            return c.json(
                {
                    message: `Failed to connect to Pi-hole: ${connectionTest.error}`,
                    code: 'CONNECTION_FAILED',
                },
                400,
            );
        }

        const existing = await getPiholeConfigForOrg(user.organizationId);

        const res = await db
            .insert(piholeConfig)
            .values({
                id: body.id ?? existing?.id,
                organizationId: user.organizationId,
                url: body.url,
                password: body.password,
                updatedAt: new Date(),
            })
            .onConflictDoUpdate({
                target: piholeConfig.id,
                set: {
                    url: body.url,
                    password: body.password,
                    updatedAt: new Date(),
                },
            })
            .returning();

        return c.json({
            success: true,
            message: 'Pi-hole configuration saved successfully!',
            data: {
                configured: true,
                url: body.url,
                password: new Array(body.password.length)
                    .fill('*')
                    .join(''),
            },
        });
    } catch (error) {
        console.error('Failed to save Pi-hole settings:', error);
        return c.json({ error: String(error) }, 500);
    }
});

// ===================== FOG settings =====================

settingsRouter.get('/settings/fog', async (c) => {
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
        const stored = await getFogConfigForOrg(user.organizationId);

        if (!stored) {
            return c.json({
                configured: false,
                url: '',
                apiToken: '',
                userToken: '',
            });
        }

        return c.json({
            configured: true,
            url: stored.url,
            // Mask tokens so secrets are never exposed to the client
            apiToken: new Array(stored.apiToken.length).fill('*').join(''),
            userToken: new Array(stored.userToken.length).fill('*').join(''),
        });
    } catch (error) {
        console.error('Failed to load FOG settings:', error);
        return c.json({ error: String(error) }, 500);
    }
});

settingsRouter.post('/settings/fog', async (c) => {
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
        const schema = z.object({
            id: z.string().length(12).optional(),
            url: z.url(),
            apiToken: z.string().min(1),
            userToken: z.string().min(1),
        });

        const body = schema.parse(await c.req.json());

        // Verify connection to FOG with the provided credentials before saving
        const connectionTest = await testFogConnection({
            url: body.url,
            apiToken: body.apiToken,
            userToken: body.userToken,
        });

        if (!connectionTest.success) {
            return c.json(
                {
                    message: `Failed to connect to FOG: ${connectionTest.error}`,
                    code: 'CONNECTION_FAILED',
                },
                400,
            );
        }

        const existing = await getFogConfigForOrg(user.organizationId);

        await db
            .insert(fogConfig)
            .values({
                id: body.id ?? existing?.id,
                organizationId: user.organizationId,
                url: body.url,
                apiToken: body.apiToken,
                userToken: body.userToken,
                updatedAt: new Date(),
            })
            .onConflictDoUpdate({
                target: fogConfig.id,
                set: {
                    url: body.url,
                    apiToken: body.apiToken,
                    userToken: body.userToken,
                    updatedAt: new Date(),
                },
            });

        return c.json({
            success: true,
            message: 'FOG configuration saved successfully!',
            data: {
                configured: true,
                url: body.url,
                apiToken: new Array(body.apiToken.length)
                    .fill('*')
                    .join(''),
                userToken: new Array(body.userToken.length)
                    .fill('*')
                    .join(''),
            },
        });
    } catch (error) {
        console.error('Failed to save FOG settings:', error);
        return c.json({ error: String(error) }, 500);
    }
});
