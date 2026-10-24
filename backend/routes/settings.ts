import { eq, inArray } from 'drizzle-orm';
import z from 'zod';
import { db } from '../../db/database';
import {
    dataUsageHistory,
    firewallConfig,
    fogConfig,
    lab,
    piholeConfig,
    veyonConfig,
} from '../../db/index';
import { isDemoUser } from '../demo';
import {
    getFirewallConfigByIdWithLabs,
    getFirewallConfigWithLabs,
    mapLabs,
} from '../firewall-config';
import { getFogConfigForOrg, isBearerToken, testFogConnection } from '../fog';
import { errorProperty, getLogger } from '../logger';
import { withLabActivation } from '../lab-activation';
import { ipv4Range } from '../../frontend/src/api/network';
import {
    callMikrotik,
    discoverLabInterface,
    getAddressLists,
    getFirewallRules,
    getLabRule,
    getRuleStatus,
    labRuleMarker,
    ruleCommentWithMarker,
    testMikrotikConnection,
} from '../mikrotik';
import { getPiholeConfigForOrg, testPiholeConnection } from '../pihole';
import {
    assertValidPrivateKeyPem,
    clearVeyonConnections,
    getVeyonConfigForOrg,
    VeyonApiError,
    VeyonClient,
} from '../veyon';
import { veyonPoller } from '../veyon-poller';
import { createApp } from './context';

export const settingsRouter = createApp();

settingsRouter.use('/settings/*', async (c, next) => {
    if (
        !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
        isDemoUser(c.get('user'))
    ) {
        return c.json(
            {
                error: 'Demo users cannot change persistent settings',
                code: 'DEMO_READ_ONLY',
            },
            403,
        );
    }
    await next();
});

const settingsLogger = getLogger(['labs', 'settings']);

function maskKey(value: string): string {
    if (!value) return '';
    // Never reveal an entire short credential or its length.
    return `${value.length > 5 ? value.slice(0, 5) : ''}********`;
}

const dnsSuffixSchema = z
    .string()
    .refine((value) => !/^\.+$/.test(value.trim()), 'Invalid DNS suffix')
    .transform((value) =>
        value
            .trim()
            .replace(/^\.|\.$/g, '')
            .toLowerCase(),
    )
    .refine(
        (value) =>
            value.length <= 253 &&
            (value === '' ||
                value
                    .split('.')
                    .every((label) =>
                        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
                    )),
        'Invalid DNS suffix: use DNS labels of 1-63 letters, digits or hyphens, up to 253 characters',
    );

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

        if (body.id) {
            const existing = await db.query.firewallConfig.findFirst({
                where: eq(firewallConfig.id, body.id),
            });
            if (existing && existing.organizationId !== user.organizationId) {
                return c.json({ error: 'Configuration not found' }, 404);
            }
        }

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
                setWhere: eq(
                    firewallConfig.organizationId,
                    user.organizationId,
                ),
                set: {
                    mikrotikBaseUrl: body.mikrotikBaseUrl,
                    mikrotikUsername: body.mikrotikUsername,
                    mikrotikPassword: body.mikrotikPassword,
                    updatedAt: new Date(),
                },
            })
            .returning();

        const saved = res[0];
        if (!saved) return c.json({ error: 'Configuration not found' }, 404);
        const configWithLabs = await getFirewallConfigByIdWithLabs(saved.id);

        return c.json({
            success: true,
            message: 'MikroTik configuration saved successfully!',
            data: configWithLabs
                ? {
                      ...configWithLabs,
                      mikrotikPassword: '*'.repeat(
                          configWithLabs.mikrotikPassword.length,
                      ),
                      labs: mapLabs(configWithLabs.labs),
                  }
                : undefined,
        });
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError)
            return c.json({ error: 'Invalid firewall configuration' }, 400);
        settingsLogger.error('Failed to save firewall settings: {error}', {
            error: errorProperty(error),
        });
        return c.json({ error: String(error) }, 500);
    }
});

settingsRouter.get('/settings/lab-interface', async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Not authenticated' }, 401);
    if (!user.organizationId)
        return c.json({ error: 'You must join an organization first' }, 403);
    const name = c.req.query('name')?.trim();
    if (!name || name.length > 128 || /[\r\n]/.test(name))
        return c.json({ error: 'A valid interface name is required' }, 400);
    const result = await discoverLabInterface(user.organizationId, name);
    return c.json(result, result.success ? 200 : 400);
});

settingsRouter.post('/settings/labs', async (c) => {
    const user = c.get('user');
    if (!user) {
        return c.json({ error: 'Not authenticated' }, 401);
    }

    if (!user.organizationId) {
        return c.json({ error: 'You must join an organization first' }, 403);
    }

    return withLabActivation(
        `lab-settings:${user.organizationId}`,
        async () => {
            try {
                const schema = z.object({
                    id: z.string().length(12).optional(),
                    defaultDnsSuffix: dnsSuffixSchema.optional(),
                    labs: z.array(
                        z.object({
                            id: z.string().optional(),
                            firewallId: z
                                .string()
                                .trim()
                                .regex(/^\*[0-9a-f]+$/i),
                            name: z.string().trim().min(1),
                            description: z.string().optional(),
                            subnet: z.string().optional(),
                            dhcpServer: z.string().optional(),
                            interface: z
                                .string()
                                .trim()
                                .max(128)
                                .refine((value) => !/[\r\n]/.test(value))
                                .optional(),
                            dnsSuffix: dnsSuffixSchema.nullable().optional(),
                        }),
                    ),
                });

                const body = schema.parse(await c.req.json());

                if (!body.id) {
                    return c.json(
                        { error: 'Configuration ID is required' },
                        400,
                    );
                }

                const existingConfig = await getFirewallConfigByIdWithLabs(
                    body.id,
                );

                if (
                    !existingConfig ||
                    existingConfig.organizationId !== user.organizationId
                ) {
                    return c.json({ error: 'Configuration not found' }, 404);
                }

                const existingIds = new Set(
                    existingConfig.labs.map((item) => item.id),
                );
                const submittedIds = body.labs.flatMap((item) =>
                    item.id ? [item.id] : [],
                );
                if (
                    submittedIds.some((id) => !existingIds.has(id)) ||
                    new Set(submittedIds).size !== submittedIds.length
                ) {
                    return c.json(
                        { error: 'Invalid or duplicate lab ID' },
                        400,
                    );
                }
                const interfaces = body.labs
                    .map((item) => item.interface)
                    .filter(Boolean);
                if (new Set(interfaces).size !== interfaces.length)
                    return c.json(
                        { error: 'Each lab must use a different interface' },
                        400,
                    );

                // Validate every mapping before making any router or database changes.
                const prepared: Array<
                    Omit<
                        (typeof body.labs)[number],
                        'subnet' | 'dhcpServer'
                    > & {
                        subnet?: string | null;
                        dhcpServer?: string | null;
                        ruleMarker: string | null;
                        rule: Record<string, any> | null;
                    }
                > = [];
                for (const item of body.labs) {
                    const old = existingConfig.labs.find(
                        (entry) => entry.id === item.id,
                    );
                    if (!item.interface) {
                        if (
                            !old ||
                            old.interface ||
                            old.ruleId !== item.firewallId
                        )
                            return c.json(
                                {
                                    error: `Interface is required for lab ${item.name}`,
                                },
                                400,
                            );
                        prepared.push({
                            ...item,
                            subnet: old.subnet,
                            dhcpServer: old.dhcpServer,
                            ruleMarker: null,
                            rule: null,
                        });
                        continue;
                    }
                    const details = await discoverLabInterface(
                        user.organizationId!,
                        item.interface,
                    );
                    if (!details.success)
                        return c.json(
                            { error: `${item.name}: ${details.error}` },
                            400,
                        );
                    const response = await getLabRule(
                        user.organizationId!,
                        item.firewallId,
                        old?.interface || item.interface,
                        Boolean(old?.ruleMarker),
                    );
                    if (!response.success)
                        return c.json(
                            { error: `${item.name}: ${response.error}` },
                            400,
                        );
                    const rule = response.data;
                    if (
                        !/^\*[0-9a-f]+$/i.test(rule?.['.id'] ?? '') ||
                        rule.chain !== 'forward' ||
                        !['accept', 'drop'].includes(rule.action) ||
                        [true, 'true'].includes(rule.dynamic) ||
                        [true, 'true'].includes(rule.invalid)
                    )
                        return c.json(
                            {
                                error: `${item.name}: Select a static forward-chain accept/drop rule`,
                            },
                            400,
                        );

                    const subnet = ipv4Range(details.data.subnet)!;
                    const withinSubnet = (value: string) => {
                        const range = ipv4Range(value);
                        return (
                            range &&
                            range[0] >= subnet[0] &&
                            range[1] <= subnet[1]
                        );
                    };
                    let scoped = rule['in-interface'] === item.interface;
                    if (rule['in-interface'] && !scoped)
                        return c.json(
                            {
                                error: `${item.name}: Firewall rule matches a different incoming interface`,
                            },
                            400,
                        );
                    if (rule['src-address']) {
                        if (!withinSubnet(rule['src-address']))
                            return c.json(
                                {
                                    error: `${item.name}: Firewall source address must be within the lab subnet`,
                                },
                                400,
                            );
                        scoped = true;
                    }
                    // Rule matchers are ANDed: an explicit lab interface/source
                    // already scopes a shared address list to this lab.
                    if (rule['src-address-list'] && !scoped) {
                        const lists = await getAddressLists(
                            user.organizationId!,
                        );
                        if (!lists.success || !Array.isArray(lists.data))
                            return c.json(
                                {
                                    error: `${item.name}: Could not verify firewall address list`,
                                },
                                400,
                            );
                        const entries = lists.data.filter(
                            (entry: any) =>
                                entry.list === rule['src-address-list'] &&
                                ![true, 'true'].includes(entry.disabled),
                        );
                        if (
                            !entries.length ||
                            entries.some(
                                (entry: any) => !withinSubnet(entry.address),
                            )
                        )
                            return c.json(
                                {
                                    error: `${item.name}: Firewall rule must be limited to this lab (${details.data.subnet}).`,
                                },
                                400,
                            );
                        scoped = true;
                    }
                    if (!scoped)
                        return c.json(
                            {
                                error: `${item.name}: Firewall rule must explicitly match the lab interface or source subnet`,
                            },
                            400,
                        );
                    const ruleMarker = labRuleMarker(item.interface);
                    prepared.push({
                        ...item,
                        ...details.data,
                        firewallId: rule['.id'] as string,
                        ruleMarker,
                        rule,
                    });
                }
                if (
                    new Set(
                        prepared.map((item) => item.firewallId.toLowerCase()),
                    ).size !== prepared.length
                )
                    return c.json(
                        {
                            error: 'Each lab must use a different firewall rule',
                        },
                        400,
                    );

                // Detect conflicting markers before tagging, including on interface renames.
                if (prepared.some((item) => item.rule)) {
                    const rules = await getFirewallRules(user.organizationId!);
                    if (!rules.success || !Array.isArray(rules.data))
                        return c.json(
                            {
                                error:
                                    rules.error ||
                                    'Could not verify firewall ownership',
                            },
                            400,
                        );
                    for (const item of prepared) {
                        const marker = item.ruleMarker;
                        if (
                            marker &&
                            rules.data.some(
                                (rule: any) =>
                                    rule['.id'] !== item.firewallId &&
                                    String(rule.comment || '')
                                        .split(/\r?\n/)
                                        .includes(marker),
                            )
                        )
                            return c.json(
                                {
                                    error: `Firewall marker ${item.ruleMarker} is already used by another rule`,
                                },
                                400,
                            );
                    }
                }
                const changedComments: Array<{
                    id: string;
                    before: string;
                    after: string;
                }> = [];
                try {
                    for (const item of prepared) {
                        if (!item.rule || !item.interface) continue;
                        const old = existingConfig.labs.find(
                            (entry) => entry.id === item.id,
                        );
                        const before = String(item.rule.comment || '');
                        const after = ruleCommentWithMarker(
                            before,
                            item.interface,
                            old?.interface || undefined,
                        );
                        if (after === before) continue;
                        // A failed response may still mean the router applied the write.
                        changedComments.push({
                            id: item.firewallId,
                            before,
                            after,
                        });
                        const tagged = await callMikrotik(
                            user.organizationId!,
                            `/ip/firewall/filter/${encodeURIComponent(item.firewallId)}`,
                            'PATCH',
                            { comment: after },
                        );
                        if (!tagged.success)
                            throw new Error(
                                tagged.error || 'Failed to tag firewall rule',
                            );
                        const verified = await getRuleStatus(
                            user.organizationId!,
                            item.firewallId,
                        );
                        if (
                            !verified.success ||
                            verified.data?.comment !== after
                        )
                            throw new Error(
                                `Could not verify firewall marker ${item.ruleMarker}`,
                            );
                    }
                    db.transaction((tx) => {
                        if (body.defaultDnsSuffix !== undefined) {
                            tx.update(firewallConfig)
                                .set({
                                    defaultDnsSuffix: body.defaultDnsSuffix,
                                    updatedAt: new Date(),
                                })
                                .where(eq(firewallConfig.id, existingConfig.id))
                                .run();
                        }
                        const removedIds = [...existingIds].filter(
                            (id) => !submittedIds.includes(id),
                        );
                        if (removedIds.length)
                            tx.delete(lab)
                                .where(inArray(lab.id, removedIds))
                                .run();
                        for (const l of prepared) {
                            const values = {
                                firewallConfigId: existingConfig.id,
                                name: l.name,
                                ruleId: l.firewallId,
                                ruleMarker: l.ruleMarker,
                                description: l.description ?? null,
                                subnet: l.subnet ?? null,
                                dhcpServer: l.dhcpServer ?? null,
                                interface: l.interface || null,
                                ...(l.dnsSuffix !== undefined
                                    ? { dnsSuffix: l.dnsSuffix || null }
                                    : {}),
                                updatedAt: new Date(),
                            };
                            if (l.id) {
                                const old = existingConfig.labs.find(
                                    (item) => item.id === l.id,
                                )!;
                                if (
                                    (old.interface || '') !==
                                        (l.interface || '') ||
                                    (!l.interface &&
                                        old.ruleId !== l.firewallId)
                                ) {
                                    tx.delete(dataUsageHistory)
                                        .where(eq(dataUsageHistory.labId, l.id))
                                        .run();
                                }
                                tx.update(lab)
                                    .set(values)
                                    .where(eq(lab.id, l.id))
                                    .run();
                            } else {
                                tx.insert(lab).values(values).run();
                            }
                        }
                    });
                } catch (error) {
                    const failures = [];
                    for (const change of changedComments.reverse()) {
                        const current = await getRuleStatus(
                            user.organizationId!,
                            change.id,
                        );
                        if (
                            current.success &&
                            current.data?.comment === change.before
                        )
                            continue;
                        if (
                            !current.success ||
                            current.data?.comment !== change.after
                        ) {
                            failures.push(change.id);
                            continue;
                        }
                        const restored = await callMikrotik(
                            user.organizationId!,
                            `/ip/firewall/filter/${encodeURIComponent(change.id)}`,
                            'PATCH',
                            { comment: change.before },
                        );
                        const verified = restored.success
                            ? await getRuleStatus(
                                  user.organizationId!,
                                  change.id,
                              )
                            : null;
                        if (
                            !verified?.success ||
                            (verified.data?.comment || '') !== change.before
                        )
                            failures.push(change.id);
                    }
                    return c.json(
                        {
                            error: `${error instanceof Error ? error.message : String(error)}. Labs were not saved.${failures.length ? ` Could not restore comments for ${failures.join(', ')}; check the router before retrying.` : ''}`,
                        },
                        502,
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
                              mikrotikPassword: '*'.repeat(
                                  configWithLabs.mikrotikPassword.length,
                              ),
                              labs: mapLabs(configWithLabs.labs),
                          }
                        : undefined,
                });
            } catch (error) {
                if (error instanceof z.ZodError || error instanceof SyntaxError)
                    return c.json({ error: 'Invalid lab configuration' }, 400);
                settingsLogger.error(
                    'Failed to save firewall settings: {error}',
                    {
                        error: errorProperty(error),
                    },
                );
                return c.json({ error: String(error) }, 500);
            }
        },
    );
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
            defaultDnsSuffix: storedConfig.defaultDnsSuffix,
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

        if (body.id) {
            const existing = await db.query.piholeConfig.findFirst({
                where: eq(piholeConfig.id, body.id),
            });
            if (existing && existing.organizationId !== user.organizationId) {
                return c.json({ error: 'Configuration not found' }, 404);
            }
        }

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
                setWhere: eq(piholeConfig.organizationId, user.organizationId),
                set: {
                    url: body.url,
                    password: body.password,
                    verifyTls: body.verifyTls,
                    updatedAt: new Date(),
                },
            })
            .returning();

        if (!res[0]) return c.json({ error: 'Configuration not found' }, 404);

        return c.json({
            success: true,
            message: 'Pi-hole configuration saved successfully!',
            data: {
                configured: true,
                url: body.url,
                verifyTls: body.verifyTls,
                password: new Array(body.password.length).fill('*').join(''),
            },
        });
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError)
            return c.json({ error: 'Invalid Pi-hole configuration' }, 400);
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
            apiToken: maskKey(stored.apiToken),
            userToken: maskKey(stored.userToken),
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

        if (body.id) {
            const existing = await db.query.fogConfig.findFirst({
                where: eq(fogConfig.id, body.id),
            });
            if (existing && existing.organizationId !== user.organizationId) {
                return c.json({ error: 'Configuration not found' }, 404);
            }
        }

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

        const res = await db
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
                setWhere: eq(fogConfig.organizationId, user.organizationId),
                set: {
                    url: body.url,
                    apiToken: body.apiToken,
                    userToken: body.userToken,
                    updatedAt: new Date(),
                },
            })
            .returning();

        if (!res[0]) return c.json({ error: 'Configuration not found' }, 404);

        return c.json({
            success: true,
            message: 'FOG configuration saved successfully!',
            data: {
                configured: true,
                url: body.url,
                apiToken: maskKey(body.apiToken),
                userToken: maskKey(body.userToken),
            },
        });
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError)
            return c.json({ error: 'Invalid FOG configuration' }, 400);
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
        keyPreview: maskKey(stored?.keyData ?? ''),
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
            keyPreview: maskKey(credentials.keyData),
            verifyTls: body.verifyTls,
        });
    } catch (error) {
        settingsLogger.error('Failed to save Veyon settings: {error}', {
            error: errorProperty(error),
        });
        if (error instanceof VeyonApiError) {
            const status =
                error.status >= 400 && error.status <= 599 ? error.status : 400;
            return c.json(
                { error: error.message, code: error.code },
                status as any,
            );
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
