import { useEffect, useRef } from 'react';
import { vi } from 'vitest';

export const snapshots = new Map<string, unknown>();
export const listeners = new Map<string, { data: (data: unknown) => void; error: (error: Error) => void }>();
export const subscriptions = vi.fn();
export const refresh = vi.fn();

export function resetStreams() {
    snapshots.clear();
    listeners.clear();
    subscriptions.mockClear();
    refresh.mockClear();
}

export function useApiStream(path: string | null, onData: (data: unknown) => void, onError: (error: Error) => void) {
    const callbacks = useRef({ onData, onError });
    useEffect(() => { callbacks.current = { onData, onError }; });
    useEffect(() => {
        if (!path) return;
        subscriptions(path);
        const listener = {
            data: (data: unknown) => callbacks.current.onData(data),
            error: (error: Error) => callbacks.current.onError(error),
        };
        listeners.set(path, listener);
        if (snapshots.has(path)) {
            const value = snapshots.get(path);
            if (value instanceof Error) listener.error(value);
            else listener.data(value);
        }
        return () => { listeners.delete(path); };
    }, [path]);
    return refresh;
}
