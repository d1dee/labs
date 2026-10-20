import { relations } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const user = sqliteTable(
    'user',
    {
        id: text('id').primaryKey(),
        name: text('name').notNull(),
        email: text('email').notNull().unique(),
        emailVerified: integer('emailVerified', { mode: 'boolean' })
            .default(false)
            .notNull(),
        image: text('image'),
        username: text('username').unique(),
        displayUsername: text('displayUsername'),
        organizationId: text('organizationId'),
        lastLoginAt: integer('lastLoginAt', { mode: 'timestamp' }),
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

export const session = sqliteTable(
    'session',
    {
        id: text('id').primaryKey(),
        expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
        token: text('token').notNull().unique(),
        createdAt: integer('createdAt', { mode: 'timestamp' })
            .notNull()
            .$defaultFn(() => new Date()),
        updatedAt: integer('updatedAt', { mode: 'timestamp' })
            .notNull()
            .$defaultFn(() => new Date()),
        ipAddress: text('ipAddress'),
        userAgent: text('userAgent'),
        userId: text('userId')
            .notNull()
            .references(() => user.id, { onDelete: 'cascade' }),
    },
    (t) => [
        index('session_token_idx').on(t.token),
        index('session_userId_idx').on(t.userId),
    ],
);

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
        accessToken: text('access_token'),
        refreshToken: text('refresh_token'),
        idToken: text('id_token'),
        accessTokenExpiresAt: integer('access_token_expires_at'),
        refreshTokenExpiresAt: integer('refresh_token_expires_at'),
        scope: text('scope'),
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

export const verification = sqliteTable(
    'verification',
    {
        id: text('id').primaryKey(),
        identifier: text('identifier').notNull(),
        value: text('value').notNull(),
        expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
        createdAt: integer('createdAt', { mode: 'timestamp' }).$defaultFn(
            () => new Date(),
        ),
        updatedAt: integer('updatedAt', { mode: 'timestamp' }).$defaultFn(
            () => new Date(),
        ),
    },
    (t) => [index('verification_identifier_idx').on(t.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
    sessions: many(session),
    accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
    user: one(user, {
        fields: [session.userId],
        references: [user.id],
    }),
}));

export const accountRelations = relations(account, ({ one }) => ({
    user: one(user, {
        fields: [account.userId],
        references: [user.id],
    }),
}));
