import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { user as userTable } from '../db/schema';

/**
 * Get a user by email using Drizzle.
 */
export async function getUserByEmail(email: string) {
    return await db
        .select()
        .from(userTable)
        .where(eq(userTable.email, email))
        .limit(1);
}

/**
 * Get a user by username using Drizzle.
 */
export async function getUserByUsername(username: string) {
    return await db
        .select()
        .from(userTable)
        .where(eq(userTable.username, username))
        .limit(1);
}

/**
 * Get a user by ID using Drizzle.
 */
export async function getUserById(userId: string) {
    return await db
        .select()
        .from(userTable)
        .where(eq(userTable.id, userId))
        .limit(1);
}
