import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { firewallConfig, lab } from '../db/index';

export interface ConfigLab {
    id: string;
    name: string;
    ruleId: string;
    ruleMarker?: string | null;
    dhcpServer: string;
    subnet: string;
    interface?: string;
    dnsSuffix?: string | null;
}

export function mapLabs(labs: (typeof lab.$inferSelect)[]): ConfigLab[] {
    return labs.map((l) => ({
        id: l.id,
        name: l.name,
        ruleId: l.ruleId ?? '',
        ruleMarker: l.ruleMarker ?? null,
        dhcpServer: l.dhcpServer ?? '',
        subnet: l.subnet ?? '',
        interface: l.interface ?? '',
        dnsSuffix: l.dnsSuffix ?? null,
    }));
}

export async function getFirewallConfigWithLabs(organizationId: string) {
    return db.query.firewallConfig.findFirst({
        where: eq(firewallConfig.organizationId, organizationId),
        with: { labs: true },
    });
}

export async function getFirewallConfigByIdWithLabs(id: string) {
    return db.query.firewallConfig.findFirst({
        where: eq(firewallConfig.id, id),
        with: { labs: true },
    });
}
