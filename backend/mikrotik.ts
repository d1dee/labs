import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { firewallConfig } from '../db/schema';

interface MikrotikResponse {
    success: boolean;
    data?: any;
    error?: string;
}

interface MikrotikConfig {
    baseUrl: string;
    username: string;
    password: string;
}

export async function getMikrotikConfig(
    organizationId: string,
): Promise<MikrotikConfig | null> {
    const row = await db
        .select({
            baseUrl: firewallConfig.mikrotikBaseUrl,
            username: firewallConfig.mikrotikUsername,
            password: firewallConfig.mikrotikPassword,
        })
        .from(firewallConfig)
        .where(eq(firewallConfig.organizationId, organizationId))
        .get();

    if (!row) {
        return null;
    }

    return {
        baseUrl: row.baseUrl,
        username: row.username,
        password: row.password,
    };
}

function getBasicAuth(mikrotikConfig: MikrotikConfig): string {
    const credentials = `${mikrotikConfig.username}:${mikrotikConfig.password}`;
    return 'Basic ' + Buffer.from(credentials).toString('base64');
}

export async function callMikrotik(
    organizationId: string,
    path: string,
    method: string = 'GET',
    body?: any,
): Promise<MikrotikResponse> {
    try {
        const mikrotikConfig = await getMikrotikConfig(organizationId);
        if (!mikrotikConfig) {
            return {
                success: false,
                error: 'MikroTik configuration not found. Please configure firewall settings in Settings.',
            };
        }

        const url = `${mikrotikConfig.baseUrl}/rest${path}`;
        const headers: Record<string, string> = {
            Authorization: getBasicAuth(mikrotikConfig),
            'Content-Type': 'application/json',
        };

        const opts: any = {
            method,
            headers,
            signal: AbortSignal.timeout(15_000),
        };

        if (body) {
            opts.body = JSON.stringify(body);
        }

        const response = await fetch(url, opts);

        const text = await response.text();
        const data = text ? JSON.parse(text) : null;

        if (!response.ok) {
            return {
                success: false,
                error: data?.message || `HTTP ${response.status}`,
            };
        }

        return {
            success: true,
            data,
        };
    } catch (error) {
        if (error instanceof Error) {
            return {
                success: false,
                error: `${(error as any).code ?? 'unknown error'}: ${error.message}`,
            };
        }
        return {
            success: false,
            error: String(error),
        };
    }
}

export async function testMikrotikConnection(config: {
    baseUrl: string;
    username: string;
    password: string;
}): Promise<MikrotikResponse> {
    try {
        const mikrotikConfig: MikrotikConfig = {
            baseUrl: config.baseUrl,
            username: config.username,
            password: config.password,
        };
        const response = await fetch(`${config.baseUrl}/rest/system/identity`, {
            method: 'GET',
            signal: AbortSignal.timeout(15_000),
            headers: {
                Authorization: getBasicAuth(mikrotikConfig),
                'Content-Type': 'application/json',
            },
        });

        const text = await response.text();
        const data = text ? JSON.parse(text) : null;

        if (!response.ok) {
            return {
                success: false,
                error:
                    data?.message ||
                    `Authentication failed: HTTP ${response.status}`,
            };
        }

        return {
            success: true,
            data,
        };
    } catch (error) {
        if (error instanceof Error) {
            return {
                success: false,
                error: `${(error as any).code ?? 'unknown error'}: ${error.message}`,
            };
        }
        return {
            success: false,
            error: String(error),
        };
    }
}

export async function getFirewallRules(
    organizationId: string,
): Promise<MikrotikResponse> {
    return callMikrotik(organizationId, '/ip/firewall/filter');
}

export async function getRuleStatus(
    organizationId: string,
    ruleId: string,
): Promise<MikrotikResponse> {
    const response = await callMikrotik(
        organizationId,
        `/ip/firewall/filter/${ruleId}`,
    );
    return response;
}

export async function toggleRuleDisabled(
    organizationId: string,
    ruleId: string,
    enabled: boolean,
    cidr: string,
): Promise<MikrotikResponse> {
    await callMikrotik(
        organizationId,
        `/ip/firewall/filter/${ruleId}`,
        'PATCH',
        {
            disabled: 'false',
            action: enabled ? 'accept' : 'drop',
        },
    );

    if (!enabled) {
        const prefix = cidr.replace(/0\/\d+$/, '');
        const connections = await callMikrotik(
            organizationId,
            '/ip/firewall/connection',
        );
        if (connections.success && Array.isArray(connections.data)) {
            const toDelete = connections.data.filter((conn: any) =>
                conn['src-address']?.startsWith(prefix),
            );
            for (const conn of toDelete) {
                await callMikrotik(
                    organizationId,
                    `/ip/firewall/connection/${conn['.id']}`,
                    'DELETE',
                );
            }
        }
    }

    return { success: true };
}

export async function getDHCPLeases(
    organizationId: string,
    pool: string,
): Promise<MikrotikResponse> {
    // Get DHCP leases
    return callMikrotik(
        organizationId,
        `/ip/dhcp-server/lease?server=${pool}`,
    );
}

export async function getAddressLists(
    organizationId: string,
): Promise<MikrotikResponse> {
    return callMikrotik(organizationId, '/ip/firewall/address-list');
}

export async function getQueueSimple(
    organizationId: string,
): Promise<MikrotikResponse> {
    // Get traffic queues for bandwidth info
    return callMikrotik(organizationId, '/queue/simple');
}

export async function getConnections(
    organizationId: string,
): Promise<MikrotikResponse> {
    // Get active connections
    return callMikrotik(organizationId, '/ip/firewall/connection/print');
}

export async function resolveSubnetAndDhcpServer(
    organizationId: string,
    rule: any,
): Promise<{ subnet: string; dhcpServer: string }> {
    // Resolve the subnet from a direct address first, falling back to an
    // address-list reference when the rule uses one instead of a literal CIDR.
    let subnet =
        rule['src-address'] || rule['dst-address'] || rule['src-cidr'] || '';

    if (!subnet) {
        const addressList =
            rule['src-address-list'] || rule['dst-address-list'];
        if (addressList) {
            const lists = await getAddressLists(organizationId);
            if (lists.success && Array.isArray(lists.data)) {
                const entries = lists.data.filter(
                    (item: any) => item.list === addressList && item.address,
                );
                const match =
                    entries.find((item: any) =>
                        item.address.includes('10.0.'),
                    ) ?? entries[0];
                if (match) {
                    subnet = match.address;
                }
            }
        }
    }

    // Extract VLAN number from subnet to determine DHCP server
    let vlan = '';
    if (subnet.includes('10.0.')) {
        const match = subnet.match(/10\.0\.(\d+)\./);
        if (match) {
            vlan = match[1];
        }
    }

    const dhcpServer = vlan ? `server::labs::vlan${vlan}` : '';

    return { subnet, dhcpServer };
}

export async function getLabDetailsByRuleId(
    organizationId: string,
    ruleId: string,
): Promise<MikrotikResponse> {
    const response = await getRuleStatus(organizationId, ruleId);
    if (!response.success || !response.data) {
        return response;
    }

    const rule = response.data;
    const { subnet, dhcpServer } = await resolveSubnetAndDhcpServer(
        organizationId,
        rule,
    );

    return {
        success: true,
        data: {
            dhcpServer,
            subnet,
            ruleId,
            comment: rule.comment || '',
        },
    };
}
