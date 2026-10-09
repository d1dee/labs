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
    const result = await callMikrotik(
        organizationId,
        `/ip/firewall/filter/${ruleId}`,
        'PATCH',
        {
            disabled: 'false',
            action: enabled ? 'accept' : 'drop',
        },
    );

    if (!result.success) {
        return result;
    }

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
        `/ip/dhcp-server/lease?server=${encodeURIComponent(pool)}`,
    );
}

export function parseByteCounter(value: unknown): number | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    if (typeof value === 'string' && !/^\d+$/.test(value)) return null;
    const bytes = Number(value);
    return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

export async function getInterfaceUsage(organizationId: string, name: string): Promise<number | null> {
    const response = await callMikrotik(organizationId, '/interface/print', 'POST', {
        stats: '', '.query': [`name=${name}`], '.proplist': 'name,rx-byte,tx-byte',
    });
    const row = response.success && Array.isArray(response.data)
        ? response.data.find((item: any) => item.name === name) : null;
    const rx = parseByteCounter(row?.['rx-byte']);
    const tx = parseByteCounter(row?.['tx-byte']);
    return rx !== null && tx !== null && Number.isSafeInteger(rx + tx) ? rx + tx : null;
}

function ipv4(address: string): number | null {
    const parts = address.split('.');
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
    return parts.reduce((value, part) => value * 256 + Number(part), 0) >>> 0;
}

export function addressInSubnet(address: string, subnet: string): boolean {
    const [network, prefix = '32', extra] = subnet.split('/');
    if (extra !== undefined || !/^\d{1,2}$/.test(prefix) || Number(prefix) > 32) return false;
    const ip = ipv4(address);
    const base = ipv4(network ?? '');
    if (ip === null || base === null) return false;
    const mask = Number(prefix) === 0 ? 0 : (0xffffffff << (32 - Number(prefix))) >>> 0;
    return (ip & mask) === (base & mask);
}

export function countOnlineDevices(
    arp: any[] | null,
    leases: any[] | null,
    details: { interface?: string; subnet?: string; dhcpServer?: string },
): { connected: number | null; source: 'arp' | 'dhcp' | 'unavailable' } {
    if (details.subnet && !addressInSubnet(details.subnet.split('/')[0] ?? '', details.subnet)) {
        return { connected: null, source: 'unavailable' };
    }
    const scopedLeases = leases?.filter((lease) =>
        lease.status === 'bound' &&
        (!details.dhcpServer || (lease['active-server'] || lease.server) === details.dhcpServer) &&
        (!details.subnet || addressInSubnet(lease['active-address'] || lease.address || '', details.subnet)),
    ) ?? null;
    const leaseAddresses = new Set(scopedLeases?.map((lease) => lease['active-address'] || lease.address));
    // Never count the entire router when no lab-specific scope is known.
    if (arp && (details.interface || details.subnet || (details.dhcpServer && scopedLeases))) {
        const devices = new Set<string>();
        for (const row of arp) {
            if (!['reachable', 'delay', 'probe'].includes(row.status)) continue;
            if (row.disabled === 'true' || row.disabled === true) continue;
            if (row.invalid === 'true' || row.invalid === true || row.published === 'true' || row.published === true) continue;
            if (details.interface && row.interface !== details.interface) continue;
            if (details.subnet && !addressInSubnet(row.address || '', details.subnet)) continue;
            if (!details.interface && !details.subnet && !leaseAddresses.has(row.address)) continue;
            const identity = row['mac-address'] || row.address;
            if (identity) devices.add(String(identity).toLowerCase());
        }
        return { connected: devices.size, source: 'arp' };
    }
    if (scopedLeases && (details.dhcpServer || details.subnet)) {
        const devices = new Set(scopedLeases.map((lease) => lease['active-mac-address'] || lease['mac-address'] || lease.address).filter(Boolean).map((id) => String(id).toLowerCase()));
        return { connected: devices.size, source: 'dhcp' };
    }
    return { connected: null, source: 'unavailable' };
}

export async function getOnlineDevices(organizationId: string, details: { interface?: string; subnet?: string; dhcpServer?: string }) {
    const [arp, leases] = await Promise.all([
        details.interface || details.subnet || details.dhcpServer
            ? callMikrotik(organizationId, '/ip/arp') : Promise.resolve({ success: false, data: null }),
        details.dhcpServer ? getDHCPLeases(organizationId, details.dhcpServer) : Promise.resolve({ success: false, data: null }),
    ]);
    return countOnlineDevices(
        arp.success && Array.isArray(arp.data) ? arp.data : null,
        leases.success && Array.isArray(leases.data) ? leases.data : null,
        details,
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
