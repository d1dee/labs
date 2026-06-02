import { eq } from 'drizzle-orm';
import { db } from '../db/database';
import { user } from '../db/schema';
import { auth } from './auth';

// Better Auth handles schema creation automatically on first run.
// The core tables created are: user, account, session, verification
// With the username plugin, a username field is added to the user table.

/**
 * Seed test teachers if the database is empty.
 * Uses Better Auth's internal sign-up API to handle ID generation and password hashing.
 */
export async function seedTestTeachers() {
    try {
        const userCount = await db.select().from(user).limit(1);
        if (userCount.length > 0) {
            return; // Already seeded
        }
    } catch (error) {
        // Tables don't exist yet — Better Auth will create them on first request
        console.log('Database tables not ready yet, skipping seed for now.');
        return;
    }

    console.log('Seeding test teachers...');

    const testTeachers = [
        { name: 'Mr. Smith', username: 'mr_smith', password: 'password123' },
        {
            name: 'Ms. Johnson',
            username: 'ms_johnson',
            password: 'password123',
        },
        {
            name: 'Dr. Williams',
            username: 'dr_williams',
            password: 'password123',
        },
    ];

    for (const teacher of testTeachers) {
        const email = `${teacher.username}@school.local`;

        // Use Better Auth's sign-up API — it handles ID generation, email hashing, and password bcrypt
        try {
            await auth.api.signUpEmail({
                body: {
                    name: teacher.name,
                    email,
                    password: teacher.password,
                    username: teacher.username,
                },
            });
            console.log(`  ✓ Seeded ${teacher.name} (${email})`);
        } catch (err) {
            console.log(`  ⚠ Could not seed ${teacher.name}: ${err}`);
        }
    }

    console.log(`Done seeding test teachers.`);
}

/**
 * Get a user by username using Drizzle.
 */
export async function getUserByUsername(username: string) {
    return await db
        .select()
        .from(user)
        .where(eq(user.username, username))
        .limit(1);
}

/**
 * Get a user by ID using Drizzle.
 */
export async function getUserById(userId: string) {
    return await db.select().from(user).where(eq(user.id, userId)).limit(1);
}
