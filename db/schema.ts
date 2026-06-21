import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Users table — stores auth users with username support
export const user = sqliteTable('user', {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull(),
    username: text('username'),
    displayUsername: text('displayUsername'),
    image: text('image'),
    createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
});

// Accounts table — stores OAuth/credential provider links
export const account = sqliteTable('account', {
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
    createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
});

// Sessions table — stores auth sessions
export const session = sqliteTable('session', {
    id: text('id').primaryKey(),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    token: text('token').notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    userId: text('userId')
        .notNull()
        .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
});

// Verifications table — stores email verification tokens
export const verification = sqliteTable('verification', {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp' }),
    updatedAt: integer('updatedAt', { mode: 'timestamp' }),
});

// Activation history table — stores lab activation/deactivation events
export const activationHistory = sqliteTable('activationHistory', {
    id: text('id').primaryKey(),
    labId: text('labId').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    triggeredBy: text('triggeredBy')
        .notNull()
        .references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
});

// Data usage history table — stores periodic data usage snapshots for labs
export const dataUsageHistory = sqliteTable('dataUsageHistory', {
    id: text('id').primaryKey(),
    labId: text('labId').notNull(),
    totalBytes: integer('totalBytes', { mode: 'number' }).notNull(),
    usageMB: integer('usageMB', { mode: 'number' }).notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
});

// Demo state table — stores simulated state changes for demo users
export const demoState = sqliteTable('demoState', {
    id: text('id').primaryKey(),
    userId: text('userId').notNull(),
    category: text('category').notNull(),
    resourceId: text('resourceId'),
    action: text('action').notNull(),
    data: text('data').notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
});
