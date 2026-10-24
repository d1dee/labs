import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { firewallConfig } from '../db/index';
import { addressInRange, ipv4Range } from '../frontend/src/api/network';

export interface MikrotikResponse {
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

function restBaseUrl(baseUrl: string): string {
    return `${baseUrl.trim().replace(/\/+$/, '').replace(/\/rest$/i, '')}/rest`;
}

async function readMikrotikResponse(response: Response): Promise<MikrotikResponse> {
    const text = await response.text();
    let data: any = null;
    if (text.trim()) {
        try {
            data = JSON.parse(text);
        } catch {
            // RouterOS and proxies can return HTML, including for authentication errors.
            if (response.status !== 401 && response.status !== 403) {
                return {
                    success: false,
                    error: `MikroTik returned a non-JSON response (HTTP ${response.status}). Check the router address and HTTP/HTTPS port, and ensure RouterOS v7 REST API is available through www-ssl or www, not a WebFig login page or proxy.`,
                };
            }
        }
    }
    if (response.status === 401) {
        return { success: false, error: 'Authentication failed (HTTP 401). Check the MikroTik username and password.' };
    }
    if (response.status === 403) {
        return { success: false, error: 'Access denied (HTTP 403). Check the MikroTik user permissions and REST API access restrictions.' };
    }
    if (!response.ok) {
        return { success: false, error: typeof data?.message === 'string' ? data.message : `MikroTik REST request failed (HTTP ${response.status})` };
    }
    if (!text.trim() && response.status !== 204) {
        return { success: false, error: 'MikroTik returned an empty response. Check the router address and REST API service.' };
    }
    return { success: true, data };
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

        const url = `${restBaseUrl(mikrotikConfig.baseUrl)}${path}`;
        const headers: Record<string, string> = {
            Authorization: getBasicAuth(mikrotikConfig),
            'Content-Type': 'application/json',
            Accept: 'application/json',
        };

        const opts: any = {
            method,
            headers,
            signal: AbortSignal.timeout(15_000),
            tls: {
                rejectUnauthorized:
                    process.env.MIKROTIK_INSECURE_FETCH !== 'true',
            },
        };

        if (body) {
            opts.body = JSON.stringify(body);
        }

        const response = await fetch(url, opts);

        return await readMikrotikResponse(response);
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
        const response = await fetch(`${restBaseUrl(config.baseUrl)}/system/identity`, {
            method: 'GET',
            signal: AbortSignal.timeout(15_000),
            tls: {
                rejectUnauthorized:
                    process.env.MIKROTIK_INSECURE_FETCH !== 'true',
            },
            headers: {
                Authorization: getBasicAuth(mikrotikConfig),
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
        });

        return await readMikrotikResponse(response);
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
        `/ip/firewall/filter/${encodeURIComponent(ruleId)}`,
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
        `/ip/firewall/filter/${encodeURIComponent(ruleId)}`,
        'PATCH',
        {
            disabled: 'false',
            action: enabled ? 'accept' : 'drop',
        },
    );

    if (!result.success) {
        return result;
    }

    if (!enabled && addressInSubnet(cidr.split('/')[0] ?? '', cidr)) {
        const connections = await callMikrotik(
            organizationId,
            '/ip/firewall/connection',
        );
        if (connections.success && Array.isArray(connections.data)) {
            const toDelete = connections.data.filter((conn: any) => {
                const source = conn?.['src-address'];
                return (
                    typeof source === 'string' &&
                    /^\*[0-9a-f]+$/i.test(conn['.id'] ?? '') &&
                    addressInSubnet(source.replace(/:\d+$/, ''), cidr)
                );
            });
            for (const conn of toDelete) {
                await callMikrotik(
                    organizationId,
                    `/ip/firewall/connection/${encodeURIComponent(conn['.id'])}`,
                    'DELETE',
                );
            }
        }
    }

    return { success: true };
}

export async function getDHCPLeases(
    organizationId: string,
    pool?: string,
): Promise<MikrotikResponse> {
    // Get DHCP leases
    return callMikrotik(
        organizationId,
        `/ip/dhcp-server/lease${pool ? `?server=${encodeURIComponent(pool)}` : ''}`,
    );
}

export function parseByteCounter(value: unknown): number | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    if (typeof value === 'string' && !/^\d+$/.test(value)) return null;
    const bytes = Number(value);
    return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

export async function getInterfaceUsage(
    organizationId: string,
    name: string,
): Promise<number | null> {
    const response = await callMikrotik(
        organizationId,
        '/interface/print',
        'POST',
        {
            stats: '',
            '.query': [`name=${name}`],
            '.proplist': 'name,rx-byte,tx-byte',
        },
    );
    const row =
        response.success && Array.isArray(response.data)
            ? response.data.find((item: any) => item.name === name)
            : null;
    const rx = parseByteCounter(row?.['rx-byte']);
    const tx = parseByteCounter(row?.['tx-byte']);
    return rx !== null && tx !== null && Number.isSafeInteger(rx + tx)
        ? rx + tx
        : null;
}

export function addressInSubnet(address: string, subnet: string): boolean {
    return addressInRange(address, subnet);
}

export function countOnlineDevices(
    arp: any[] | null,
    leases: any[] | null,
    details: { interface?: string; subnet?: string; dhcpServer?: string },
): { connected: number | null; source: 'arp' | 'dhcp' | 'unavailable' } {
    if (details.subnet && !ipv4Range(details.subnet)) {
        return { connected: null, source: 'unavailable' };
    }
    const scopedLeases =
        leases?.filter(
            (lease) =>
                lease &&
                lease.disabled !== true &&
                lease.disabled !== 'true' &&
                lease.invalid !== true &&
                lease.invalid !== 'true' &&
                lease.status === 'bound' &&
                (!details.dhcpServer ||
                    (lease['active-server'] || lease.server) ===
                        details.dhcpServer) &&
                (!details.subnet ||
                    addressInSubnet(
                        lease['active-address'] || lease.address || '',
                        details.subnet,
                    )),
        ) ?? null;
    const leaseAddresses = new Set(
        scopedLeases?.map((lease) => lease['active-address'] || lease.address),
    );
    // Never count the entire router when no lab-specific scope is known.
    if (
        arp &&
        (details.interface ||
            details.subnet ||
            (details.dhcpServer && scopedLeases))
    ) {
        const devices = new Set<string>();
        for (const row of arp) {
            if (!['reachable', 'delay', 'probe'].includes(row.status)) continue;
            if (row.disabled === 'true' || row.disabled === true) continue;
            if (
                row.invalid === 'true' ||
                row.invalid === true ||
                row.published === 'true' ||
                row.published === true
            )
                continue;
            if (details.interface && row.interface !== details.interface)
                continue;
            if (
                details.subnet &&
                !addressInSubnet(row.address || '', details.subnet)
            )
                continue;
            if (
                !details.interface &&
                !details.subnet &&
                !leaseAddresses.has(row.address)
            )
                continue;
            const identity = row['mac-address'] || row.address;
            if (identity) devices.add(String(identity).toLowerCase());
        }
        // An empty reachability cache does not mean the lab has no DHCP devices.
        if (devices.size > 0 || !scopedLeases?.length) {
            return { connected: devices.size, source: 'arp' };
        }
    }
    if (scopedLeases && (details.dhcpServer || details.subnet)) {
        const devices = new Set(
            scopedLeases
                .map(
                    (lease) =>
                        lease['active-mac-address'] ||
                        lease['mac-address'] ||
                        lease.address,
                )
                .filter(Boolean)
                .map((id) => String(id).toLowerCase()),
        );
        return { connected: devices.size, source: 'dhcp' };
    }
    return { connected: null, source: 'unavailable' };
}

export async function getOnlineDevices(
    organizationId: string,
    details: { interface?: string; subnet?: string; dhcpServer?: string },
) {
    const [arp, leases] = await Promise.all([
        details.interface || details.subnet || details.dhcpServer
            ? callMikrotik(organizationId, '/ip/arp')
            : Promise.resolve({ success: false, data: null }),
        details.dhcpServer
            ? getDHCPLeases(organizationId, details.dhcpServer)
            : Promise.resolve({ success: false, data: null }),
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

export function labRuleMarker(interfaceName: string): string {
    if (!interfaceName.trim() || /[\r\n]/.test(interfaceName)) {
        throw new Error('A non-empty, single-line interface name is required.');
    }
    return `fcd-${interfaceName}`;
}

export function ruleCommentWithMarker(
    comment: string,
    interfaceName: string,
    previousInterface?: string,
): string {
    const marker = labRuleMarker(interfaceName);
    const previous = previousInterface ? labRuleMarker(previousInterface) : marker;
    const newline = comment.includes('\r\n') ? '\r\n' : '\n';
    const description = comment.split(/\r?\n/)
        .filter((line) => line !== marker && line !== previous).join(newline);
    return description ? `${description}${description.endsWith(newline) ? '' : newline}${marker}` : marker;
}

function ruleMarkers(rule: any): string[] {
    return typeof rule?.comment === 'string'
        ? rule.comment.split(/\r?\n/).filter((line: string) => /^fcd-.+$/.test(line))
        : [];
}

// Read-only resolution. Callers must validate chain/action before tagging or mutating.
export async function getLabRule(
    organizationId: string,
    ruleId: string,
    interfaceName?: string,
    requireMarker = false,
): Promise<MikrotikResponse> {
    if (interfaceName === undefined) {
        if (requireMarker) return { success: false, error: 'An interface is required to resolve an fcd marker.' };
        if (!ruleId) return { success: false, error: 'A firewall rule ID is required.' };
        const response = await getRuleStatus(organizationId, ruleId);
        if (!response.success) return response;
        if (!response.data || typeof response.data['.id'] !== 'string') {
            return { success: false, error: 'Firewall rule not found or missing its internal ID.' };
        }
        if (ruleMarkers(response.data).length) {
            return { success: false, error: 'An interface is required to validate fcd rule ownership.' };
        }
        return response;
    }
    if (!interfaceName.trim() || /[\r\n]/.test(interfaceName)) {
        return { success: false, error: 'A non-empty, single-line interface name is required.' };
    }
    const response = await getFirewallRules(organizationId);
    if (!response.success) return response;
    if (!Array.isArray(response.data)) return { success: false, error: 'Invalid firewall rule response.' };
    const marker = labRuleMarker(interfaceName);
    const byId = response.data.filter((rule: any) =>
        typeof rule?.['.id'] === 'string' && rule['.id'].toLowerCase() === ruleId.toLowerCase());
    const tagged = response.data.filter((rule: any) => ruleMarkers(rule).includes(marker));
    if (byId.length > 1 || tagged.length > 1) {
        return { success: false, error: `Ambiguous firewall rules for ${marker}.` };
    }
    if (byId.some((rule: any) => ruleMarkers(rule).some((line) => line !== marker))) {
        return { success: false, error: 'Firewall rule ID is owned by a different fcd interface.' };
    }
    if (requireMarker && !tagged.length) {
        return { success: false, error: `Required firewall marker ${marker} was not found.` };
    }
    const rule = tagged[0] ?? byId[0];
    if (!rule || typeof rule['.id'] !== 'string' || !rule['.id']) {
        return { success: false, error: `Firewall rule not found for ${marker}.` };
    }
    if (ruleMarkers(rule).some((line) => line !== marker)) {
        return { success: false, error: 'Firewall rule has conflicting fcd ownership markers.' };
    }
    return { success: true, data: rule };
}

function usableRouterResource(row: any): boolean {
    return row && ![true, 'true', 'yes'].includes(row.disabled) &&
        ![true, 'true', 'yes'].includes(row.invalid);
}

export async function discoverLabInterface(
    organizationId: string,
    name: string,
): Promise<MikrotikResponse> {
    const fail = (error: string): MikrotikResponse => ({ success: false, error });
    if (!name.trim() || /[\r\n]/.test(name)) return fail('A non-empty, single-line interface name is required.');
    const interfaces = await callMikrotik(organizationId, `/interface?name=${encodeURIComponent(name)}`);
    if (!interfaces.success) return interfaces;
    const exact = Array.isArray(interfaces.data) ? interfaces.data.filter((row: any) => row?.name === name) : [];
    if (exact.length !== 1 || !usableRouterResource(exact[0])) {
        return fail(`Expected one usable interface named exactly ${name}.`);
    }
    const servers = await callMikrotik(organizationId, `/ip/dhcp-server?interface=${encodeURIComponent(name)}`);
    if (!servers.success) return servers;
    const attached = Array.isArray(servers.data) ? servers.data.filter((row: any) => row?.interface === name && usableRouterResource(row)) : [];
    if (attached.length !== 1 || typeof attached[0].name !== 'string' || !attached[0].name) {
        return fail(`Expected one usable DHCP server attached to ${name}.`);
    }
    const server = attached[0];
    const poolName = server['address-pool'];
    if (poolName === 'static-only') return fail('Static-only DHCP servers are not supported for lab discovery.');
    if (typeof poolName !== 'string' || !poolName) return fail('DHCP server has no address-pool.');
    const pools = await callMikrotik(organizationId, `/ip/pool?name=${encodeURIComponent(poolName)}`);
    if (!pools.success) return pools;
    const matchingPools = Array.isArray(pools.data) ? pools.data.filter((row: any) => row?.name === poolName) : [];
    if (matchingPools.length !== 1 || !usableRouterResource(matchingPools[0])) return fail('DHCP address-pool is missing, invalid, or ambiguous.');
    const pool = matchingPools[0];
    if (pool['next-pool'] && pool['next-pool'] !== 'none') return fail('Chained DHCP address-pools are not supported for lab discovery.');
    const ranges = typeof pool.ranges === 'string' ? pool.ranges.split(',').map((range: string) => ipv4Range(range)) : [];
    if (!ranges.length || ranges.some((range: [number, number] | null) => !range)) return fail('DHCP address-pool has invalid or missing IPv4 ranges.');
    const addresses = await callMikrotik(organizationId, `/ip/address?interface=${encodeURIComponent(name)}`);
    if (!addresses.success) return addresses;
    const attachedAddresses = Array.isArray(addresses.data) ? addresses.data.filter((row: any) => row?.interface === name && usableRouterResource(row)) : [];
    const subnets = new Map<string, [number, number]>();
    for (const row of attachedAddresses) {
        if (typeof row.address !== 'string' || !/^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(row.address)) return fail('Interface has an invalid IPv4 address.');
        const bounds = ipv4Range(row.address);
        if (!bounds) return fail('Interface has an invalid IPv4 subnet.');
        const prefix = Number(row.address.split('/')[1]);
        const network = [24, 16, 8, 0].map((shift) => (bounds[0] >>> shift) & 255).join('.');
        subnets.set(`${network}/${prefix}`, bounds);
    }
    if (subnets.size !== 1) return fail('Interface IPv4 subnet is missing or ambiguous.');
    const [subnet, bounds] = [...subnets.entries()][0]!;
    if (ranges.some((range: [number, number]) => range[0] <= bounds[0] || range[1] >= bounds[1])) {
        return fail('DHCP address-pool must contain usable addresses within the interface IPv4 subnet.');
    }
    if (attachedAddresses.some((row: any) => ranges.some((range: [number, number]) => {
        const address = ipv4Range(row.address.split('/')[0])![0];
        return address >= range[0] && address <= range[1];
    }))) return fail('DHCP address-pool includes an interface address.');
    return { success: true, data: { subnet, dhcpServer: server.name, pool: pool.name } };
}

// Legacy rule-based inference only; new interface-backed labs use discoverLabInterface.
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
