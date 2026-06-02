import config from '../config.json';

interface MikrotikResponse {
    success: boolean;
    data?: any;
    error?: string;
}

// Load config
const MIKROTIK_BASE = config.mikrotik.baseUrl;
const MIKROTIK_USER = config.mikrotik.username;
const MIKROTIK_PASS = config.mikrotik.password;
const INSECURE = config.mikrotik.insecure;

function getBasicAuth(): string {
    const credentials = `${MIKROTIK_USER}:${MIKROTIK_PASS}`;
    return 'Basic ' + Buffer.from(credentials).toString('base64');
}

export async function callMikrotik(
    path: string,
    method: string = 'GET',
    body?: any,
): Promise<MikrotikResponse> {
    try {
        const url = `${MIKROTIK_BASE}/rest${path}`;
        const headers: Record<string, string> = {
            Authorization: getBasicAuth(),
            'Content-Type': 'application/json',
        };

        const opts: any = {
            method,
            headers,
        };

        if (body) {
            opts.body = JSON.stringify(body);
        }

        // Disable SSL certificate validation for self-signed certs
        if (INSECURE) {
            opts.rejectUnauthorized = false;
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
                error: `${error?.code! ?? 'unknown error'}: ${error?.message}`,
            };
        }
        return {
            success: false,
            error: String(error),
        };
    }
}

export async function getFirewallRules(): Promise<MikrotikResponse> {
    return callMikrotik('/ip/firewall/filter');
}

export async function getRuleStatus(ruleId: string): Promise<MikrotikResponse> {
    const response = await callMikrotik(`/ip/firewall/filter/${ruleId}`);
    return response;
}

export async function toggleRuleDisabled(
    ruleId: string,
    enabled: boolean,
    cidr: string,
): Promise<MikrotikResponse> {
    await callMikrotik(`/ip/firewall/filter/${ruleId}`, 'PATCH', {
        disabled: 'false',
        action: enabled ? 'accept' : 'drop',
    });

    if (!enabled) {
        const prefix = cidr.replace(/0\/\d+$/, '');
        const connections = await callMikrotik('/ip/firewall/connection');
        if (connections.success && Array.isArray(connections.data)) {
            const toDelete = connections.data.filter((conn: any) =>
                conn['src-address']?.startsWith(prefix),
            );
            for (const conn of toDelete) {
                await callMikrotik(
                    `/ip/firewall/connection/${conn['.id']}`,
                    'DELETE',
                );
            }
        }
    }

    return { success: true };
}

export async function getDHCPLeases(pool: string): Promise<MikrotikResponse> {
    // Get DHCP leases
    return callMikrotik(`/ip/dhcp-server/lease?server=${pool}`);
}

export async function getAddressLists(): Promise<MikrotikResponse> {
    return callMikrotik('/ip/firewall/address-list');
}

export async function getQueueSimple(): Promise<MikrotikResponse> {
    // Get traffic queues for bandwidth info
    return callMikrotik('/queue/simple');
}

export async function getConnections(): Promise<MikrotikResponse> {
    // Get active connections
    return callMikrotik('/ip/firewall/connection/print');
}
