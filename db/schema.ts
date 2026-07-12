import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Users table — stores auth users with username support
export const user = sqliteTable(
    'user',
    {
        id: text('id').primaryKey(),
        name: text('name').notNull(),
        email: text('email').notNull(),
        emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull(),
        username: text('username'),
        displayUsername: text('displayUsername'),
        image: text('image'),
        organizationId: text('organizationId').references(
            () => organization.id,
            {
                onDelete: 'set null',
            },
        ),
        createdAt: integer('createdAt', { mode: 'timestamp' })
            .notNull()
            .$defaultFn(() => new Date()),
        updatedAt: integer('updatedAt', { mode: 'timestamp' })
            .notNull()
            .$defaultFn(() => new Date()),
    },
    (t) => [
        index('user_email_idx').on(t.email),
        index('user_username_idx').on(t.username),
        index('user_organizationId_idx').on(t.organizationId),
    ],
);

// Organizations table — stores organization details
export const organization = sqliteTable('organization', {
    id: text('id')
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID().replace(/-/g, '').slice(0, 12)),
    name: text('name').notNull(),
    phoneNumber: text('phoneNumber').notNull(),
    email: text('email').notNull(),
    joinKey: text('joinKey')
        .notNull()
        .$defaultFn(() => crypto.randomUUID().replace(/-/g, '').slice(0, 6)),
    createdAt: integer('createdAt', { mode: 'timestamp' })
        .notNull()
        .$defaultFn(() => new Date())
        .$defaultFn(() => new Date()),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
        .notNull()
        .$defaultFn(() => new Date())
        .$defaultFn(() => new Date()),
});

// Accounts table — stores OAuth/credential provider links
export const account = sqliteTable(
    'account',
    {
        id: text('id').primaryKey(),
        accountId: text('accountId').notNull(),
        providerId: text('providerId').notNull(),
        userId: text('userId')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        password: text('password'),
        access_token: text('access_token'),
        refresh_token: text('refresh_token'),
        expires_at: integer('expires_at'),
        id_token: text('id_token'),
        scope: text('scope'),
        session_id: text('session_id').references(() => session.id, {
            onDelete: 'cascade',
        }),
        createdAt: integer('createdAt', { mode: 'timestamp' })
            .notNull()
            .$defaultFn(() => new Date()),
        updatedAt: integer('updatedAt', { mode: 'timestamp' })
            .notNull()
            .$defaultFn(() => new Date()),
    },
    (t) => [
        index('account_userId_idx').on(t.userId),
        index('account_provider_idx').on(t.providerId, t.accountId),
    ],
);

// Sessions table — stores auth sessions
export const session = sqliteTable(
    'session',
    {
        id: text('id').primaryKey(),
        expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
        token: text('token').notNull(),
        ipAddress: text('ipAddress'),
        userAgent: text('userAgent'),
        userId: text('userId')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
        createdAt: integer('createdAt', { mode: 'timestamp' })
            .notNull()
            .$defaultFn(() => new Date()),
        updatedAt: integer('updatedAt', { mode: 'timestamp' })
            .notNull()
            .$defaultFn(() => new Date()),
    },
    (t) => [
        index('session_token_idx').on(t.token),
        index('session_userId_idx').on(t.userId),
    ],
);

// Verifications table — stores email verification tokens
export const verification = sqliteTable(
    'verification',
    {
        id: text('id').primaryKey(),
        identifier: text('identifier').notNull(),
        value: text('value').notNull(),
        expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
        createdAt: integer('createdAt', { mode: 'timestamp' }),
        updatedAt: integer('updatedAt', { mode: 'timestamp' }),
    },
    (t) => [index('verification_identifier_idx').on(t.identifier)],
);

// Activation history table — stores lab activation/deactivation events
export const activationHistory = sqliteTable(
    'activationHistory',
    {
        id: text('id').primaryKey(),
        labId: text('labId').notNull(),
        enabled: integer('enabled', { mode: 'boolean' }).notNull(),
        triggeredBy: text('triggeredBy')
            .notNull()
            .references(() => user.id, { onDelete: 'set null' }),
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

// Firewall configuration table — stores MikroTik and labs configuration
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

        labs: text('labs').notNull(),
        createdAt: integer('createdAt', { mode: 'timestamp' })
            .$defaultFn(() => new Date())
            .notNull(),
        updatedAt: integer('updatedAt', { mode: 'timestamp' })
            .$defaultFn(() => new Date())
            .notNull(),
    },
    (t) => [index('firewallConfig_organizationId_idx').on(t.organizationId)],
);
