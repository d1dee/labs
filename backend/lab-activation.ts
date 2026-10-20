import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/database';
import { activationHistory } from '../db/index';

const pending = new Map<string, Promise<unknown>>();

// Serialize router reads with app toggles so a stale poll cannot undo history.
export async function withLabActivation<T>(
    labId: string,
    work: () => Promise<T>,
): Promise<T> {
    const previous = pending.get(labId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    pending.set(labId, next);
    try {
        return await next;
    } finally {
        if (pending.get(labId) === next) pending.delete(labId);
    }
}

export function reconcileLabActivation(labId: string, enabled: boolean) {
    // Synchronous immediate transaction also deduplicates across DB connections.
    db.transaction(
        (tx) => {
            const latest = tx
                .select()
                .from(activationHistory)
                .where(eq(activationHistory.labId, labId))
                .orderBy(desc(activationHistory.createdAt), sql`rowid desc`)
                .limit(1)
                .get();
            if (latest?.enabled === enabled) return;
            // First observation is a baseline, not a claim about earlier access.
            tx.insert(activationHistory)
                .values({
                    id: crypto.randomUUID(),
                    labId,
                    enabled,
                    triggeredBy: null,
                    source: 'external',
                    createdAt: new Date(),
                })
                .run();
        },
        { behavior: 'immediate' },
    );
}
