#!/usr/bin/env bun
import { z } from 'zod';
import { withUniqueJoinKey } from '../backend/join-key';
import { formatJoinKey } from '../frontend/src/lib/join-key';
import { db } from './database';
import { organization } from './schema';

const createOrganizationSchema = z.object({
    name: z.string().min(1, 'Organization name is required'),
    phoneNumber: z.string().min(1, 'Contact phone number is required'),
    email: z.string().email('Invalid email address'),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export async function createOrganization(params: CreateOrganizationInput) {
    const data = createOrganizationSchema.parse(params);
    const now = new Date();
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const result = withUniqueJoinKey(db, (tx, joinKey) => tx
        .insert(organization)
        .values({
            id,
            name: data.name,
            phoneNumber: data.phoneNumber,
            email: data.email,
            joinKey,
            createdAt: now,
            updatedAt: now,
        })
        .returning()
        .all());

    return result[0];
}

// Run as interactive shell script
if (import.meta.main) {
    console.log('🏢 Create Organization\n');

    const name = prompt('Organization name:');
    const phoneNumber = prompt('Contact phone number:');
    const email = prompt('Email address:');

    console.log('\nCreating organization...');

    try {
        const org = await createOrganization({
            name: name ?? '',
            phoneNumber: phoneNumber ?? '',
            email: email ?? '',
        });
        if (!org) {
            console.error('Failed to create organization');
            process.exit(1);
        }

        console.log('✓ Organization created successfully!');
        console.log(`  ID: ${org.id}`);
        console.log(`  Name: ${org.name}`);
        console.log(`  Email: ${org.email}`);
        console.log(`  Phone: ${org.phoneNumber}`);
        console.log(`  Join key: ${formatJoinKey(org.joinKey)}`);
    } catch (error) {
        if (error instanceof z.ZodError) {
            console.error('Validation failed:');
            for (const issue of error.issues) {
                console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
            }
        } else {
            console.error('Failed to create organization:', error);
        }
        process.exit(1);
    }
}
