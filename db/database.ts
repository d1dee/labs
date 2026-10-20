import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import * as schema from '../db/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH =
    process.env.DATABASE_PATH ||
    (process.env.NODE_ENV === 'test'
        ? ':memory:'
        : path.join(__dirname, '..', 'teachers.db'));

// Initialize Bun's built-in SQLite database
const sqliteDb = new Database(DB_PATH);
sqliteDb.run('PRAGMA journal_mode = WAL');
sqliteDb.run('PRAGMA foreign_keys = ON');
// Serialize concurrent startups instead of failing instantly on lock.
sqliteDb.run('PRAGMA busy_timeout = 5000');

export function migrateOrganizationAccounts(client: Database) {
    client
        .transaction(() => {
            for (const [table, column, type] of [
                ['organization', 'createdByUserId', 'TEXT'],
                ['user', 'lastLoginAt', 'INTEGER'],
            ] as const) {
                const columns = client
                    .query(`PRAGMA table_info("${table}")`)
                    .all() as Array<{ name: string }>;
                // Fresh databases are still bootstrapped from the Drizzle schema.
                if (
                    columns.length &&
                    !columns.some((entry) => entry.name === column)
                ) {
                    client.run(
                        `ALTER TABLE "${table}" ADD COLUMN "${column}" ${type}`,
                    );
                }
            }
            if (client.query('PRAGMA table_info(organization)').all().length) {
                client.run(
                    'CREATE INDEX IF NOT EXISTS organization_createdByUserId_idx ON organization(createdByUserId)',
                );
            }
        })
        .immediate();
}

// Never infer historical ownership or login timestamps from membership/sessions.
migrateOrganizationAccounts(sqliteDb);

// SQLite cannot drop NOT NULL in place. Preserve explicit rowids because they
// break ties between history events with the same timestamp. Disable FK checks
// outside the transaction so legacy orphaned actors are preserved as well.
sqliteDb.run('PRAGMA foreign_keys = OFF');
try {
    sqliteDb
        .transaction(() => {
            const columns = sqliteDb
                .query('PRAGMA table_info(activationHistory)')
                .all() as Array<{
                name: string;
                notnull: number;
            }>;
            // Fresh databases still use the existing schema bootstrap.
            if (!columns.length) return;
            const hasSource = columns.some(
                (column) => column.name === 'source',
            );
            if (
                columns.find((column) => column.name === 'triggeredBy')?.notnull
            ) {
                const dependents = sqliteDb
                    .query(
                        `SELECT sql FROM sqlite_master
                WHERE tbl_name = 'activationHistory' AND type IN ('index', 'trigger')
                AND sql IS NOT NULL`,
                    )
                    .all() as Array<{ sql: string }>;
                sqliteDb.run(`CREATE TABLE activationHistory_upgrade (
                id TEXT PRIMARY KEY NOT NULL,
                labId TEXT NOT NULL,
                enabled INTEGER NOT NULL,
                triggeredBy TEXT,
                source TEXT NOT NULL DEFAULT 'app',
                createdAt INTEGER NOT NULL,
                FOREIGN KEY (triggeredBy) REFERENCES user(id) ON DELETE SET NULL
            )`);
                sqliteDb.run(`INSERT INTO activationHistory_upgrade
                (rowid, id, labId, enabled, triggeredBy, source, createdAt)
                SELECT rowid, id, labId, enabled, triggeredBy,
                    ${hasSource ? 'source' : "'app'"}, createdAt FROM activationHistory`);
                sqliteDb.run('DROP TABLE activationHistory');
                sqliteDb.run(
                    'ALTER TABLE activationHistory_upgrade RENAME TO activationHistory',
                );
                for (const dependent of dependents) sqliteDb.run(dependent.sql);
            } else if (!hasSource) {
                sqliteDb.run(
                    "ALTER TABLE activationHistory ADD COLUMN source TEXT NOT NULL DEFAULT 'app'",
                );
            }
        })
        .immediate();
} finally {
    sqliteDb.run('PRAGMA foreign_keys = ON');
}

// This project predates checked-in Drizzle migrations. Keep the additive
// Veyon tables self-initializing so existing installations can upgrade safely.
sqliteDb.run(`CREATE TABLE IF NOT EXISTS organizationComputerInventory (
    organizationId TEXT PRIMARY KEY NOT NULL,
    source TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE
)`);
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
    sqliteDb.run(
        'DELETE FROM veyonConfig WHERE keyName IS NULL OR keyData IS NULL',
    );
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
if (
    piholeColumns.length &&
    !piholeColumns.some((column) => column.name === 'verifyTls')
) {
    sqliteDb.run(
        'ALTER TABLE piholeConfig ADD COLUMN verifyTls INTEGER NOT NULL DEFAULT 1',
    );
}

const labColumns = sqliteDb.query('PRAGMA table_info(lab)').all() as Array<{
    name: string;
}>;
if (
    labColumns.length &&
    !labColumns.some((column) => column.name === 'interface')
) {
    sqliteDb.run('ALTER TABLE lab ADD COLUMN interface TEXT');
}
if (
    labColumns.length &&
    !labColumns.some((column) => column.name === 'dnsSuffix')
) {
    sqliteDb.run('ALTER TABLE lab ADD COLUMN dnsSuffix TEXT');
}

const firewallColumns = sqliteDb
    .query('PRAGMA table_info(firewallConfig)')
    .all() as Array<{ name: string }>;
if (
    firewallColumns.length &&
    !firewallColumns.some((column) => column.name === 'defaultDnsSuffix')
) {
    sqliteDb.run(
        "ALTER TABLE firewallConfig ADD COLUMN defaultDnsSuffix TEXT NOT NULL DEFAULT ''",
    );
}

// Preserve username access for accounts created with the old synthetic email flow.
// New signups cannot use this domain, and real addresses still require verification.
if (sqliteDb.query('PRAGMA table_info(user)').all().length) {
    sqliteDb.run(
        "UPDATE user SET emailVerified = 1 WHERE lower(email) LIKE '%@local.lan' AND emailVerified = 0",
    );
}

sqliteDb.run(`CREATE TABLE IF NOT EXISTS organizationDeviceCache (
    organizationId TEXT PRIMARY KEY NOT NULL,
    signature TEXT NOT NULL,
    expiresAt INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE
)`);

sqliteDb.run(`CREATE TABLE IF NOT EXISTS organizationDeviceLab (
    organizationId TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    labId TEXT,
    observedAt INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (organizationId, fingerprint),
    FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE,
    FOREIGN KEY (labId) REFERENCES lab(id) ON DELETE SET NULL
)`);

const retainedLabColumns = sqliteDb
    .query('PRAGMA table_info(organizationDeviceLab)')
    .all() as Array<{ name: string }>;
if (!retainedLabColumns.some((column) => column.name === 'observedAt')) {
    sqliteDb.run(
        'ALTER TABLE organizationDeviceLab ADD COLUMN observedAt INTEGER NOT NULL DEFAULT 0',
    );
}
// Preserve the newest tombstone on lab deletion instead of revealing older linked history.
const retainedLabForeignKeys = sqliteDb
    .query('PRAGMA foreign_key_list(organizationDeviceLab)')
    .all() as Array<{
    from: string;
    on_delete: string;
}>;
if (
    retainedLabForeignKeys.some(
        (key) => key.from === 'labId' && key.on_delete !== 'SET NULL',
    )
) {
    sqliteDb
        .transaction(() => {
            sqliteDb.run(`CREATE TABLE organizationDeviceLab_upgrade (
            organizationId TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            labId TEXT,
            observedAt INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (organizationId, fingerprint),
            FOREIGN KEY (organizationId) REFERENCES organization(id) ON DELETE CASCADE,
            FOREIGN KEY (labId) REFERENCES lab(id) ON DELETE SET NULL
        )`);
            sqliteDb.run(`INSERT INTO organizationDeviceLab_upgrade (organizationId, fingerprint, labId, observedAt)
            SELECT organizationId, fingerprint, labId, observedAt FROM organizationDeviceLab`);
            sqliteDb.run('DROP TABLE organizationDeviceLab');
            sqliteDb.run(
                'ALTER TABLE organizationDeviceLab_upgrade RENAME TO organizationDeviceLab',
            );
        })
        .immediate();
}

// Create Drizzle database instance with Better Auth schema
export const db = drizzle({ client: sqliteDb, schema });
