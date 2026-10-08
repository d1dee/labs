import { useEffect, useRef } from 'react';

type Snapshot = { path: string; status: number; data: unknown };
type Listener = (snapshot: Snapshot) => void;
const subscriptions = new Map<string, Set<Listener>>();
const snapshots = new Map<string, Snapshot>();
let source: EventSource | null = null;
let queued = false;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let version = 0;

function reconnect() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
        queued = false;
        const currentVersion = ++version;
        clearTimeout(reconnectTimer);
        source?.close();
        source = null;
        if (!subscriptions.size || document.hidden) return;
        const paths = [...subscriptions.keys()].sort();
        const connection = new EventSource(`/api/stream?${new URLSearchParams({ paths: JSON.stringify(paths) })}`);
        source = connection;
        connection.addEventListener('snapshot', (event) => {
            if (currentVersion !== version) return;
            let snapshot: Snapshot;
            try {
                snapshot = JSON.parse((event as MessageEvent<string>).data);
                if (!snapshot || typeof snapshot.path !== 'string' || !Number.isInteger(snapshot.status)) return;
            } catch {
                return;
            }
            if (!subscriptions.has(snapshot.path)) return;
            if (snapshot.data && typeof snapshot.data === 'object' &&
                'code' in snapshot.data && snapshot.data.code === 'STREAM_IDENTITY_CHANGED') {
                snapshots.clear();
                // A terminal identity error may arrive on any resource before
                // the organization resource gets its turn. Notify every scope
                // consumer so privileged views cannot retain the old identity.
                for (const [path, listeners] of [...subscriptions]) {
                    for (const listener of listeners) listener({ ...snapshot, path });
                }
                return;
            }
            snapshots.set(snapshot.path, snapshot);
            for (const listener of subscriptions.get(snapshot.path) ?? []) listener(snapshot);
        });
        connection.onerror = () => {
            if (currentVersion !== version) return;
            // Native EventSource reconnects transient failures; explicitly retry
            // permanent closures too, such as an expired session or server restart.
            if (connection.readyState === EventSource.CLOSED) reconnectTimer = setTimeout(reconnect, 10_000);
            for (const [path, listeners] of subscriptions) {
                const snapshot = { path, status: 503, data: { error: 'Live connection interrupted. Reconnecting automatically.' } };
                for (const listener of listeners) listener(snapshot);
            }
        };
    });
}

function visibilityChanged() {
    // Closing immediately also cancels backend polling while the page is hidden.
    version++;
    source?.close();
    source = null;
    clearTimeout(reconnectTimer);
    if (!document.hidden) reconnect();
}

export function refreshApiStreams() {
    reconnect();
}

export function resetApiStreams() {
    snapshots.clear();
    version++;
    source?.close();
    source = null;
    reconnect();
}

/** Subscribe only while a view needs a JSON resource. One shared connection
 * carries all mounted resources; the backend refreshes them every 10 seconds. */
export function useApiStream<T>(
    path: string | null,
    onData: (data: T) => void,
    onError?: (error: Error & { status?: number; code?: string }) => void,
) {
    const callbacks = useRef({ onData, onError });
    useEffect(() => { callbacks.current = { onData, onError }; });
    useEffect(() => {
        if (!path) return;
        let lastError: string | null = null;
        const listener: Listener = (snapshot) => {
            if (snapshot.status >= 200 && snapshot.status < 300) {
                lastError = null;
                callbacks.current.onData(snapshot.data as T);
            } else {
                const data = snapshot.data as { error?: string; code?: string } | null;
                const fingerprint = JSON.stringify([snapshot.status, data?.error, data?.code]);
                if (fingerprint === lastError) return;
                lastError = fingerprint;
                const error = Object.assign(new Error(data?.error || 'Unable to refresh live data'), {
                    status: snapshot.status, code: data?.code,
                });
                callbacks.current.onError?.(error);
            }
        };
        if (!subscriptions.size) document.addEventListener('visibilitychange', visibilityChanged);
        let listeners = subscriptions.get(path);
        if (!listeners) {
            listeners = new Set();
            subscriptions.set(path, listeners);
            reconnect();
        }
        listeners.add(listener);
        const cached = snapshots.get(path);
        if (cached) listener(cached);
        return () => {
            listeners.delete(listener);
            if (!listeners.size) {
                subscriptions.delete(path);
                snapshots.delete(path);
                reconnect();
            }
            if (!subscriptions.size) document.removeEventListener('visibilitychange', visibilityChanged);
        };
    }, [path]);
    return refreshApiStreams;
}
