import { sql } from 'drizzle-orm';
import type { db } from '../db/database';
import { organization } from '../db/index';
import {
    generateJoinKey,
    normalizeJoinKey,
} from '../frontend/src/lib/join-key';

/**
 * Resolves an institution from a join key as typed by a colleague.
 * Separators and casing are ignored so `abcd-efgh` finds `ABCDEFGH`.
 */
export function findOrganizationByJoinKey(
    database: Pick<typeof db, 'select'>,
    input: string,
) {
    const key = normalizeJoinKey(input).toLowerCase();
    if (!key) return undefined;
    const matches = database
        .select()
        .from(organization)
        .where(sql`lower(${organization.joinKey}) = ${key}`)
        .limit(2)
        .all();
    // Legacy databases may contain case-insensitive duplicates. Never choose
    // an arbitrary institution when the membership credential is ambiguous.
    return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Selects and persists a key under one SQLite write lock. The callback must
 * execute its insert/update synchronously, before the transaction commits.
 */
export function withUniqueJoinKey<T>(
    database: typeof db,
    write: (
        tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
        joinKey: string,
    ) => T,
    attempts = 5,
): T {
    return database.transaction((tx) => {
        for (let attempt = 0; attempt < attempts; attempt++) {
            const candidate = generateJoinKey();
            const taken = tx
                .select({ id: organization.id })
                .from(organization)
                .where(
                    sql`lower(${organization.joinKey}) = ${candidate.toLowerCase()}`,
                )
                .get();
            if (!taken) return write(tx, candidate);
        }
        throw new Error('Unable to generate a unique organization join key');
    }, { behavior: 'immediate' });
}
