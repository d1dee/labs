import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import * as schema from '../db/schema';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'teachers.db');

// Initialize Bun's built-in SQLite database
const sqliteDb = new Database(DB_PATH);
sqliteDb.exec('PRAGMA journal_mode = WAL');
sqliteDb.exec('PRAGMA foreign_keys = ON');

// Create Drizzle database instance with Better Auth schema
export const db = drizzle({ client: sqliteDb, schema });
