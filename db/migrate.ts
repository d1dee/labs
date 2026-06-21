import { Database } from 'bun:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'teachers.db');

/**
 * Create Better Auth tables using raw SQL.
 * This is needed because Better Auth's Drizzle adapter doesn't auto-create tables,
 * and drizzle-kit/better-auth CLI don't support bun:sqlite driver.
 */
export function createAuthTables() {
    const db = new Database(DB_PATH);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');

    const createTables = `
        CREATE TABLE IF NOT EXISTS "user" (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            emailVerified INTEGER NOT NULL DEFAULT 0,
            username TEXT,
            displayUsername TEXT,
            image TEXT,
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS "account" (
            id TEXT PRIMARY KEY NOT NULL,
            accountId TEXT NOT NULL,
            providerId TEXT NOT NULL,
            userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
            password TEXT,
            access_token TEXT,
            refresh_token TEXT,
            expires_at INTEGER,
            id_token TEXT,
            scope TEXT,
            session_id TEXT REFERENCES "session"(id) ON DELETE CASCADE,
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS "session" (
            id TEXT PRIMARY KEY NOT NULL,
            expiresAt INTEGER NOT NULL,
            token TEXT NOT NULL,
            ipAddress TEXT,
            userAgent TEXT,
            userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS "verification" (
            id TEXT PRIMARY KEY NOT NULL,
            identifier TEXT NOT NULL,
            value TEXT NOT NULL,
            expiresAt INTEGER NOT NULL,
            createdAt INTEGER,
            updatedAt INTEGER
        );

        CREATE TABLE IF NOT EXISTS "activationHistory" (
            id TEXT PRIMARY KEY NOT NULL,
            labId TEXT NOT NULL,
            enabled INTEGER NOT NULL,
            triggeredBy TEXT NOT NULL REFERENCES "user"(id) ON DELETE SET NULL,
            createdAt INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS "dataUsageHistory" (
            id TEXT PRIMARY KEY NOT NULL,
            labId TEXT NOT NULL,
            totalBytes INTEGER NOT NULL,
            usageMB INTEGER NOT NULL,
            createdAt INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS "demoState" (
            id TEXT PRIMARY KEY NOT NULL,
            userId TEXT NOT NULL,
            category TEXT NOT NULL,
            resourceId TEXT,
            action TEXT NOT NULL,
            data TEXT NOT NULL,
            createdAt INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS "user_email_idx" ON "user"(email);
        CREATE INDEX IF NOT EXISTS "user_username_idx" ON "user"(username);
        CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account"(userId);
        CREATE INDEX IF NOT EXISTS "account_provider_idx" ON "account"(providerId, accountId);
        CREATE INDEX IF NOT EXISTS "session_token_idx" ON "session"(token);
        CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session"(userId);
        CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification"(identifier);
        CREATE INDEX IF NOT EXISTS "activationHistory_labId_idx" ON "activationHistory"(labId);
        CREATE INDEX IF NOT EXISTS "activationHistory_createdAt_idx" ON "activationHistory"(createdAt);
        CREATE INDEX IF NOT EXISTS "dataUsageHistory_labId_idx" ON "dataUsageHistory"(labId);
        CREATE INDEX IF NOT EXISTS "dataUsageHistory_createdAt_idx" ON "dataUsageHistory"(createdAt);
        CREATE INDEX IF NOT EXISTS "demoState_userId_idx" ON "demoState"(userId);
        CREATE INDEX IF NOT EXISTS "demoState_category_idx" ON "demoState"(category, userId);
    `;

    db.exec(createTables);
    db.close();
    console.log('✓ Auth tables created successfully');
}
