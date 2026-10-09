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
// Serialize concurrent startups instead of failing instantly on lock.
sqliteDb.run('PRAGMA busy_timeout = 5000');

// This project predates checked-in Drizzle migrations. Keep the additive
// Veyon tables self-initializing so existing installations can upgrade safely.
sqliteDb.run(`CREATE TABLE IF NOT EXISTS veyonConfig (
    id TEXT PRIMARY KEY NOT NULL,
    organizationId TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    keyName TEXT NOT NULL,
    keyData TEXT NOT NULL,
    verifyTls INTEGER NOT NULL DEFAULT 1,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE
)`);
// Key file authentication is the only supported Veyon auth mode. Drop the
// legacy credential columns and remove rows that cannot authenticate with a
// PEM key. Probes first so re-runs on migrated databases are a no-op.
const veyonConfigColumns = sqliteDb
    .query('PRAGMA table_info(veyonConfig)')
    .all() as Array<{ name: string }>;
const hasLegacyAuthColumns = ['authMethod', 'username', 'password'].some(
    (column) => veyonConfigColumns.some((c) => c.name === column),
);
if (hasLegacyAuthColumns) {
    sqliteDb.run('DELETE FROM veyonConfig WHERE keyName IS NULL OR keyData IS NULL');
    for (const column of ['authMethod', 'username', 'password']) {
        if (veyonConfigColumns.some((c) => c.name === column)) {
            sqliteDb.run(`ALTER TABLE veyonConfig DROP COLUMN ${column}`);
        }
    }
}
sqliteDb.run(`CREATE TABLE IF NOT EXISTS veyonComputer (
    id TEXT PRIMARY KEY NOT NULL,
    organizationId TEXT NOT NULL,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    macAddress TEXT,
    location TEXT,
    fogHostId INTEGER,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE,
    UNIQUE (organizationId, host)
)`);
sqliteDb.run(
    'CREATE INDEX IF NOT EXISTS veyonComputer_organizationId_idx ON veyonComputer(organizationId)',
);
// Additive upgrade for databases created before the FOG sync link column.
// Probe first so the expected duplicate-column case is a no-op while real
// failures (SQLITE_BUSY, IO errors) propagate and fail startup loudly.
const veyonComputerColumns = sqliteDb
    .query('PRAGMA table_info(veyonComputer)')
    .all() as Array<{ name: string }>;
if (!veyonComputerColumns.some((column) => column.name === 'fogHostId')) {
    sqliteDb.run('ALTER TABLE veyonComputer ADD COLUMN fogHostId INTEGER');
}

// Existing installations keep certificate verification enabled during upgrade.
const piholeColumns = sqliteDb
    .query('PRAGMA table_info(piholeConfig)')
    .all() as Array<{ name: string }>;
if (piholeColumns.length && !piholeColumns.some((column) => column.name === 'verifyTls')) {
    sqliteDb.run('ALTER TABLE piholeConfig ADD COLUMN verifyTls INTEGER NOT NULL DEFAULT 1');
}

const labColumns = sqliteDb.query('PRAGMA table_info(lab)').all() as Array<{ name: string }>;
if (labColumns.length && !labColumns.some((column) => column.name === 'interface')) {
    sqliteDb.run('ALTER TABLE lab ADD COLUMN interface TEXT');
}

// Preserve username access for accounts created with the old synthetic email flow.
// New signups cannot use this domain, and real addresses still require verification.
sqliteDb.run("UPDATE user SET emailVerified = 1 WHERE lower(email) LIKE '%@local.lan' AND emailVerified = 0");

// Create Drizzle database instance with Better Auth schema
export const db = drizzle({ client: sqliteDb, schema });
