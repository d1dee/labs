import { eq } from 'drizzle-orm';
import z from 'zod';
import { db } from '../../db/database';
import {
    firewallConfig,
    fogConfig,
    lab,
    piholeConfig,
    veyonConfig,
} from '../../db/schema';
import {
    getFirewallConfigByIdWithLabs,
    getFirewallConfigWithLabs,
    mapLabs,
} from '../firewall-config';
import { getFogConfigForOrg, isBearerToken, testFogConnection } from '../fog';
import { errorProperty, getLogger } from '../logger';
import { testMikrotikConnection } from '../mikrotik';
import {
    assertValidPrivateKeyPem,
    clearVeyonConnections,
    getVeyonConfigForOrg,
    VeyonApiError,
    VeyonClient,
} from '../veyon';
import {
    getPiholeConfigForOrg,
    testPiholeConnection,
} from '../pihole';
import { createApp } from './context';
import { veyonPoller } from '../veyon-poller';

export const settingsRouter = createApp();

const settingsLogger = getLogger(['labs', 'settings']);

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
        settingsLogger.error('Failed to save firewall settings: {error}', {
            error: errorProperty(error),
        });
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
                    subnet: z.string().optional(),
                    dhcpServer: z.string().optional(),
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
                    subnet: l.subnet ?? null,
                    dhcpServer: l.dhcpServer ?? null,
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
        settingsLogger.error('Failed to save firewall settings: {error}', {
            error: errorProperty(error),
        });
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
        settingsLogger.error('Failed to load firewall settings: {error}', {
            error: errorProperty(error),
        });
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
                verifyTls: true,
            });
        }

        return c.json({
            configured: true,
            url: stored.url,
            verifyTls: stored.verifyTls,
            // Mask the password so the secret is never exposed to the client
            password: new Array(stored.password.length).fill('*').join(''),
        });
    } catch (error) {
        settingsLogger.error('Failed to load Pi-hole settings: {error}', {
            error: errorProperty(error),
        });
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
            verifyTls: z.boolean().default(true),
        });

        const body = schema.parse(await c.req.json());

        // Verify connection to Pi-hole with the provided credentials before saving
        const connectionTest = await testPiholeConnection({
            url: body.url,
            password: body.password,
            verifyTls: body.verifyTls,
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
                verifyTls: body.verifyTls,
                updatedAt: new Date(),
            })
            .onConflictDoUpdate({
                target: piholeConfig.id,
                set: {
                    url: body.url,
                    password: body.password,
                    verifyTls: body.verifyTls,
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
                verifyTls: body.verifyTls,
                password: new Array(body.password.length)
                    .fill('*')
                    .join(''),
            },
        });
    } catch (error) {
        settingsLogger.error('Failed to save Pi-hole settings: {error}', {
            error: errorProperty(error),
        });
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
        settingsLogger.error('Failed to load FOG settings: {error}', {
            error: errorProperty(error),
        });
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
            // Optional for FOG 1.6 bearer tokens (fog_ prefixed); legacy
            // header auth still requires the per-user token.
            userToken: z.string().optional().default(''),
        });

        const body = schema.parse(await c.req.json());

        if (!isBearerToken(body.apiToken) && !body.userToken) {
            return c.json(
                {
                    message:
                        'A user token is required for legacy (non-bearer) API tokens. FOG 1.6 bearer tokens start with "fog_" and need no user token.',
                    code: 'USER_TOKEN_REQUIRED',
                },
                400,
            );
        }

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
        settingsLogger.error('Failed to save FOG settings: {error}', {
            error: errorProperty(error),
        });
        return c.json({ error: String(error) }, 500);
    }
});

// ===================== Veyon settings =====================

// Key file authentication (AuthKeys) is the only supported mode: the
// organization stores a key name plus the PEM private key; the WebAPI
// server signs each Veyon Server challenge with it.

settingsRouter.get('/settings/veyon', async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Not authenticated' }, 401);
    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    const stored = await getVeyonConfigForOrg(user.organizationId);
    return c.json({
        configured: Boolean(stored),
        url: stored?.url ?? '',
        keyName: stored?.keyName ?? '',
        keyConfigured: Boolean(stored?.keyData),
        verifyTls: stored?.verifyTls ?? true,
    });
});

settingsRouter.post('/settings/veyon', async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Not authenticated' }, 401);
    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    try {
        const schema = z.object({
            url: z.url(),
            keyName: z.string().trim().min(1).max(100),
            keyData: z.string().optional(),
            verifyTls: z.boolean().default(true),
            testHost: z.string().trim().min(1),
        });
        const body = schema.parse(await c.req.json());

        // An omitted keyData reuses the stored private key so the form can
        // update URL/TLS/test settings without re-uploading the secret.
        const stored = body.keyData
            ? undefined
            : await getVeyonConfigForOrg(user.organizationId);
        const keyData = body.keyData?.trim() || stored?.keyData;
        if (!keyData) {
            return c.json(
                {
                    error: 'PEM private key is required (none stored for this organization)',
                    code: 'INVALID_KEY',
                },
                400,
            );
        }
        assertValidPrivateKeyPem(keyData);

        const credentials = {
            url: body.url,
            keyName: body.keyName,
            keyData,
            verifyTls: body.verifyTls,
        };

        // Prove the key pair works end to end before persisting: the WebAPI
        // server signs the challenge of testHost with the PEM private key.
        const testClient = new VeyonClient(
            credentials,
            user.organizationId,
            user.id,
        );
        await testClient.authenticate(body.testHost);
        await testClient.close(body.testHost);

        await db
            .insert(veyonConfig)
            .values({ organizationId: user.organizationId, ...credentials })
            .onConflictDoUpdate({
                target: veyonConfig.organizationId,
                set: { ...credentials, updatedAt: new Date() },
            });
        clearVeyonConnections(user.organizationId);
        veyonPoller.invalidateOrganization(user.organizationId);
        return c.json({
            success: true,
            configured: true,
            url: body.url,
            keyName: body.keyName,
            keyConfigured: true,
            verifyTls: body.verifyTls,
        });
    } catch (error) {
        settingsLogger.error('Failed to save Veyon settings: {error}', {
            error: errorProperty(error),
        });
        if (error instanceof VeyonApiError) {
            const status = error.status >= 400 && error.status <= 599 ? error.status : 400;
            return c.json({ error: error.message, code: error.code }, status as any);
        }
        const message =
            error instanceof z.ZodError
                ? error.issues[0]?.message
                : error instanceof Error
                  ? error.message
                  : 'Failed to connect to Veyon';
        return c.json({ error: message, code: 'CONNECTION_FAILED' }, 400);
    }
});

settingsRouter.delete('/settings/veyon', async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Not authenticated' }, 401);
    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    await db
        .delete(veyonConfig)
        .where(eq(veyonConfig.organizationId, user.organizationId));
    clearVeyonConnections(user.organizationId);
    veyonPoller.invalidateOrganization(user.organizationId);
    return c.json({ success: true, configured: false });
});
