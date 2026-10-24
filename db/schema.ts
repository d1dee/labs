import { relations, sql } from 'drizzle-orm';
import {
    index,
    integer,
    primaryKey,
    sqliteTable,
    text,
    uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { ComputerInventorySnapshot } from '../backend/computer-inventory';
import type { DeviceDirectory } from '../frontend/src/api/devices';
import { generateJoinKey } from '../frontend/src/lib/join-key';
import { user } from './auth-schema';

// Organizations table — stores organization details
export const organization = sqliteTable(
    'organization',
    {
        id: text('id')
            .primaryKey()
            .$defaultFn(() =>
                crypto.randomUUID().replace(/-/g, '').slice(0, 12),
            ),
        name: text('name').notNull(),
        phoneNumber: text('phoneNumber').notNull(),
        email: text('email').notNull(),
        // Current creator/admin authority; transferred when the creator leaves.
        createdByUserId: text('createdByUserId'),
        // Eight letter code shared with colleagues; shown as `ABCD-EFGH`.
        joinKey: text('joinKey')
            .notNull()
            .$defaultFn(() => generateJoinKey()),
        createdAt: integer('createdAt', { mode: 'timestamp' })
            .notNull()
            .$defaultFn(() => new Date()),
        updatedAt: integer('updatedAt', { mode: 'timestamp' })
            .notNull()
            .$defaultFn(() => new Date()),
    },
    (t) => [
        index('organization_createdByUserId_idx').on(t.createdByUserId),
        uniqueIndex('organization_joinKey_unique').on(sql`${t.joinKey} COLLATE NOCASE`),
    ],
);

// Activation history table — stores lab activation/deactivation events
export const activationHistory = sqliteTable(
    'activationHistory',
    {
        id: text('id').primaryKey(),
        labId: text('labId').notNull(),
        enabled: integer('enabled', { mode: 'boolean' }).notNull(),
        triggeredBy: text('triggeredBy').references(() => user.id, {
            onDelete: 'set null',
        }),
        source: text('source', { enum: ['app', 'external'] })
            .notNull()
            .default('app'),
        createdAt: integer('createdAt', { mode: 'timestamp' })
            .notNull()
            .$defaultFn(() => new Date()),
    },
    (t) => [
        index('activationHistory_labId_idx').on(t.labId),
        index('activationHistory_createdAt_idx').on(t.createdAt),
    ],
);

// Data usage history table — stores periodic data usage snapshots for labs
export const dataUsageHistory = sqliteTable(
    'dataUsageHistory',
    {
        id: text('id').primaryKey(),
        labId: text('labId').notNull(),
        totalBytes: integer('totalBytes', { mode: 'number' }).notNull(),
        usageMB: integer('usageMB', { mode: 'number' }).notNull(),
        createdAt: integer('createdAt', { mode: 'timestamp' })
            .notNull()
            .$defaultFn(() => new Date()),
    },
    (t) => [
        index('dataUsageHistory_labId_idx').on(t.labId),
        index('dataUsageHistory_createdAt_idx').on(t.createdAt),
    ],
);

// Demo state table — stores simulated state changes for demo users
export const demoState = sqliteTable(
    'demoState',
    {
        id: text('id').primaryKey(),
        userId: text('userId').notNull(),
        category: text('category').notNull(),
        resourceId: text('resourceId'),
        action: text('action').notNull(),
        data: text('data').notNull(),
        createdAt: integer('createdAt', { mode: 'timestamp' })
            .notNull()
            .$defaultFn(() => new Date()),
    },
    (t) => [
        index('demoState_userId_idx').on(t.userId),
        index('demoState_category_idx').on(t.category, t.userId),
    ],
);

// Firewall configuration table — stores MikroTik connection configuration
export const firewallConfig = sqliteTable(
    'firewallConfig',
    {
        id: text('id')
            .primaryKey()
            .$defaultFn(() =>
                crypto.randomUUID().replace(/-/g, '').slice(0, 12),
            ),
        organizationId: text('organizationId')
            .notNull()
            .references(() => organization.id, { onDelete: 'cascade' }),
        mikrotikBaseUrl: text('mikrotikBaseUrl').notNull(),
        mikrotikUsername: text('mikrotikUsername').notNull(),
        mikrotikPassword: text('mikrotikPassword').notNull(),
        defaultDnsSuffix: text('defaultDnsSuffix').notNull().default(''),

        createdAt: integer('createdAt', { mode: 'timestamp' })
            .$defaultFn(() => new Date())
            .notNull(),
        updatedAt: integer('updatedAt', { mode: 'timestamp' })
            .$defaultFn(() => new Date())
            .notNull(),
    },
    (t) => [index('firewallConfig_organizationId_idx').on(t.organizationId)],
);

// Pi-hole configuration table — stores per-organization Pi-hole connection config
export const piholeConfig = sqliteTable(
    'piholeConfig',
    {
        id: text('id')
            .primaryKey()
            .$defaultFn(() =>
                crypto.randomUUID().replace(/-/g, '').slice(0, 12),
            ),
        organizationId: text('organizationId')
            .notNull()
            .references(() => organization.id, { onDelete: 'cascade' }),
        url: text('url').notNull(),
        password: text('password').notNull(),
        verifyTls: integer('verifyTls', { mode: 'boolean' })
            .notNull()
            .default(true),

        createdAt: integer('createdAt', { mode: 'timestamp' })
            .$defaultFn(() => new Date())
            .notNull(),
        updatedAt: integer('updatedAt', { mode: 'timestamp' })
            .$defaultFn(() => new Date())
            .notNull(),
    },
    (t) => [index('piholeConfig_organizationId_idx').on(t.organizationId)],
);

// FOG configuration table — stores per-organization FOG connection config
export const fogConfig = sqliteTable(
    'fogConfig',
    {
        id: text('id')
            .primaryKey()
            .$defaultFn(() =>
                crypto.randomUUID().replace(/-/g, '').slice(0, 12),
            ),
        organizationId: text('organizationId')
            .notNull()
            .references(() => organization.id, { onDelete: 'cascade' }),
        url: text('url').notNull(),
        apiToken: text('apiToken').notNull(),
        userToken: text('userToken').notNull(),

        createdAt: integer('createdAt', { mode: 'timestamp' })
            .$defaultFn(() => new Date())
            .notNull(),
        updatedAt: integer('updatedAt', { mode: 'timestamp' })
            .$defaultFn(() => new Date())
            .notNull(),
    },
    (t) => [index('fogConfig_organizationId_idx').on(t.organizationId)],
);

// Veyon WebAPI proxy configuration. Credentials remain server-side and are
// never returned by the settings API.
export const veyonConfig = sqliteTable(
    'veyonConfig',
    {
        id: text('id')
            .primaryKey()
            .$defaultFn(() =>
                crypto.randomUUID().replace(/-/g, '').slice(0, 12),
            ),
        organizationId: text('organizationId')
            .notNull()
            .references(() => organization.id, { onDelete: 'cascade' }),
        url: text('url').notNull(),
        // Key file authentication (AuthKeys) is the only supported method.
        // keyName selects the public key deployed on the Veyon Servers;
        // keyData is the PEM-encoded RSA private key used to sign the
        // server challenge. Both are required.
        keyName: text('keyName').notNull(),
        keyData: text('keyData').notNull(),
        verifyTls: integer('verifyTls', { mode: 'boolean' })
            .notNull()
            .default(true),
        createdAt: integer('createdAt', { mode: 'timestamp' })
            .$defaultFn(() => new Date())
            .notNull(),
        updatedAt: integer('updatedAt', { mode: 'timestamp' })
            .$defaultFn(() => new Date())
            .notNull(),
    },
    (t) => [uniqueIndex('veyonConfig_organizationId_idx').on(t.organizationId)],
);

// Manual Veyon targets and legacy stable identity links. FOG-owned identity
// fields are read from organizationComputerInventory, never edited here.
export const veyonComputer = sqliteTable(
    'veyonComputer',
    {
        id: text('id')
            .primaryKey()
            .$defaultFn(() =>
                crypto.randomUUID().replace(/-/g, '').slice(0, 12),
            ),
        organizationId: text('organizationId')
            .notNull()
            .references(() => organization.id, { onDelete: 'cascade' }),
        name: text('name').notNull(),
        host: text('host').notNull(),
        macAddress: text('macAddress'),
        location: text('location'),
        fogHostId: integer('fogHostId'),
        createdAt: integer('createdAt', { mode: 'timestamp' })
            .$defaultFn(() => new Date())
            .notNull(),
        updatedAt: integer('updatedAt', { mode: 'timestamp' })
            .$defaultFn(() => new Date())
            .notNull(),
    },
    (t) => [
        index('veyonComputer_organizationId_idx').on(t.organizationId),
        uniqueIndex('veyonComputer_org_host_idx').on(t.organizationId, t.host),
    ],
);

// Labs table — stores individual lab configurations linked to a firewall config
export const lab = sqliteTable(
    'lab',
    {
        id: text('id')
            .primaryKey()
            .$defaultFn(() =>
                crypto.randomUUID().replace(/-/g, '').slice(0, 12),
            ),
        firewallConfigId: text('firewallConfigId')
            .notNull()
            .references(() => firewallConfig.id, { onDelete: 'cascade' }),
        name: text('name').notNull(),
        ruleId: text('ruleId'),
        ruleMarker: text('ruleMarker'),
        dhcpServer: text('dhcpServer'),
        interface: text('interface'),
        subnet: text('subnet'),
        description: text('description'),
        dnsSuffix: text('dnsSuffix'),
        createdAt: integer('createdAt', { mode: 'timestamp' })
            .notNull()
            .$defaultFn(() => new Date()),
        updatedAt: integer('updatedAt', { mode: 'timestamp' })
            .notNull()
            .$defaultFn(() => new Date()),
    },
    (t) => [index('lab_firewallConfigId_idx').on(t.firewallConfigId)],
);

// Request-driven device observations; no router credentials are stored here.
export const organizationDeviceCache = sqliteTable('organizationDeviceCache', {
    organizationId: text('organizationId')
        .primaryKey()
        .references(() => organization.id, { onDelete: 'cascade' }),
    signature: text('signature').notNull(),
    expiresAt: integer('expiresAt').notNull(),
    snapshot: text('snapshot', { mode: 'json' })
        .$type<DeviceDirectory>()
        .notNull(),
});

// Complete FOG identity snapshots do not expire: an outage must not erase targets.
export const organizationComputerInventory = sqliteTable(
    'organizationComputerInventory',
    {
        organizationId: text('organizationId')
            .primaryKey()
            .references(() => organization.id, { onDelete: 'cascade' }),
        source: text('source').notNull(),
        snapshot: text('snapshot', { mode: 'json' })
            .$type<ComputerInventorySnapshot>()
            .notNull(),
    },
);

// Durable lab identity only; never retain network addresses or hostname aliases.
export const organizationDeviceLab = sqliteTable(
    'organizationDeviceLab',
    {
        organizationId: text('organizationId')
            .notNull()
            .references(() => organization.id, { onDelete: 'cascade' }),
        fingerprint: text('fingerprint').notNull(),
        labId: text('labId').references(() => lab.id, { onDelete: 'set null' }),
        observedAt: integer('observedAt').notNull().default(0),
    },
    (t) => [primaryKey({ columns: [t.organizationId, t.fingerprint] })],
);

export const firewallConfigRelations = relations(
    firewallConfig,
    ({ many }) => ({
        labs: many(lab),
    }),
);

export const labRelations = relations(lab, ({ one }) => ({
    firewallConfig: one(firewallConfig, {
        fields: [lab.firewallConfigId],
        references: [firewallConfig.id],
    }),
}));
