import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { firewallConfig, lab } from '../db/schema';

export interface ConfigLab {
    id: string;
    name: string;
    ruleId: string;
    dhcpServer: string;
    subnet: string;
}

export function mapLabs(labs: typeof lab.$inferSelect[]): ConfigLab[] {
    return labs.map((l) => ({
        id: l.id,
        name: l.name,
        ruleId: l.ruleId ?? '',
        dhcpServer: l.dhcpServer ?? '',
        subnet: l.subnet ?? '',
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
