import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import * as schema from '../db/schema';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'teachers.db');

// Initialize Bun's built-in SQLite database
const sqliteDb = new Database(DB_PATH);
sqliteDb.run('PRAGMA journal_mode = WAL');
sqliteDb.run('PRAGMA foreign_keys = ON');

// This project predates checked-in Drizzle migrations. Keep the additive
// Veyon tables self-initializing so existing installations can upgrade safely.
sqliteDb.run(`CREATE TABLE IF NOT EXISTS veyonConfig (
    id TEXT PRIMARY KEY NOT NULL,
    organizationId TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    authMethod TEXT NOT NULL,
    username TEXT,
    password TEXT,
    keyName TEXT,
    keyData TEXT,
    verifyTls INTEGER NOT NULL DEFAULT 1,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE
)`);
sqliteDb.run(`CREATE TABLE IF NOT EXISTS veyonComputer (
    id TEXT PRIMARY KEY NOT NULL,
    organizationId TEXT NOT NULL,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    macAddress TEXT,
    location TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE,
    UNIQUE (organizationId, host)
)`);
sqliteDb.run(
    'CREATE INDEX IF NOT EXISTS veyonComputer_organizationId_idx ON veyonComputer(organizationId)',
);

// Create Drizzle database instance with Better Auth schema
export const db = drizzle({ client: sqliteDb, schema });
