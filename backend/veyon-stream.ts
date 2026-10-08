// Keep only the newest pending event per key while a slow viewer is writing.
// Serialization is deferred until delivery so replaced frames never become base64.
export function createVeyonStreamWriter<T>(
    send: (message: T) => Promise<unknown>,
    onError: (error: unknown) => void,
    timeoutMs = 30_000,
    maxPendingBytes = 8 * 1_024 ** 2,
) {
    const pending = new Map<string, { message: () => T; bytes: number }>();
    let pendingBytes = 0;
    let writing = false;
    let closed = false;

    const close = () => {
        closed = true;
        pending.clear();
        pendingBytes = 0;
    };

    const drain = async () => {
        writing = true;
        try {
            while (!closed && pending.size > 0) {
                const [key, entry] = pending.entries().next().value!;
                pending.delete(key);
                pendingBytes -= entry.bytes;
                let timer: ReturnType<typeof setTimeout> | undefined;
                try {
                    await Promise.race([
                        send(entry.message()),
                        new Promise<never>((_, reject) => {
                            timer = setTimeout(
                                () => reject(new Error('Screenshot stream write timed out')),
                                timeoutMs,
                            );
                        }),
                    ]);
                } finally {
                    clearTimeout(timer);
                }
            }
        } catch (error) {
            close();
            onError(error);
        } finally {
            writing = false;
        }
    };

    return {
        enqueue(key: string, message: () => T, bytes = 0) {
            if (closed) return;
            if (bytes > maxPendingBytes) return;
            const previous = pending.get(key);
            if (previous) pendingBytes -= previous.bytes;
            // Replace in place so a busy computer cannot starve other viewers.
            pending.set(key, { message, bytes });
            pendingBytes += bytes;
            // Drop oldest frames, never reset/state/heartbeat control events.
            for (const [oldKey, entry] of pending) {
                if (pendingBytes <= maxPendingBytes) break;
                if (entry.bytes === 0) continue;
                pending.delete(oldKey);
                pendingBytes -= entry.bytes;
            }
            if (!writing) void drain();
        },
        close,
        get pendingBytes() { return pendingBytes; },
    };
}
