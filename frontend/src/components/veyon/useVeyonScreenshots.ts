import { useCallback, useEffect, useRef, useState } from 'react';
import { veyonScreenshotStreamUrl, type VeyonScreenshotFrameEvent, type VeyonScreenshotStateEvent } from '@/api/veyon';

export type VeyonScreenshotFrame = {
    image: string | null;
    stale: boolean;
    /** Timestamp of the displayed, successfully decoded image only. */
    lastUpdated: number | null;
    consecutiveFailures: number;
    lastError: string | null;
};

export type UseVeyonScreenshotsOptions = {
    paused?: boolean;
    /** Requested backend polling cadence, not a frontend display throttle. */
    minFrameIntervalMs?: number | null;
    width?: number;
    quality?: number;
    priority?: 'grid' | 'viewer';
};

export type UseVeyonScreenshotsResult = {
    frames: Record<string, VeyonScreenshotFrame>;
    connected: boolean;
    refreshOnce: () => void;
};

const ONE_SHOT_TIMEOUT_MS = 15_000;
const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const MAX_CANDIDATE_BYTES = 8 * 1024 * 1024;
const MAX_RETAINED_BYTES = 24 * 1024 * 1024;
const MAX_DECODES = 4;
type Priority = 'grid' | 'viewer';
type Candidate = {
    id: string;
    frame: Omit<VeyonScreenshotFrameEvent, 'image' | 'mimeType'>;
    blob: Blob | null;
    bytes: number;
    version: number;
    stateVersion: number;
    transport: number;
    url?: string;
    image?: HTMLImageElement;
    cancelled: boolean;
    cancel: () => void;
};
// Shared budgets include a simultaneously open wall and full-size viewer.
const candidateBudget = new Set<Candidate>();
const retainedBudget = new Map<string, { bytes: number; priority: Priority; evict: () => void }>();
const decodePumps = new Map<() => void, Priority>();
let activeDecodes = 0;
function pumpDecodes() {
    for (const [pump] of [...decodePumps].sort((a, b) => Number(b[1] === 'viewer') - Number(a[1] === 'viewer'))) pump();
}
function releaseDisplayed(url: string) {
    retainedBudget.delete(url);
    URL.revokeObjectURL(url);
}
function retainImage(url: string, bytes: number, priority: Priority, previous: string | null, evict: () => void) {
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_RETAINED_BYTES) return false;
    let used = bytes;
    for (const [key, item] of retainedBudget) if (key !== previous) used += item.bytes;
    const victims: string[] = [];
    const entries = [...retainedBudget].sort((a, b) => Number(a[1].priority === 'viewer') - Number(b[1].priority === 'viewer'));
    for (const [key, item] of entries) {
        if (used <= MAX_RETAINED_BYTES) break;
        if (key === previous || (priority === 'grid' && item.priority === 'viewer')) continue;
        victims.push(key);
        used -= item.bytes;
    }
    if (used > MAX_RETAINED_BYTES) return false;
    for (const key of victims) {
        const item = retainedBudget.get(key)!;
        releaseDisplayed(key);
        item.evict();
    }
    retainedBudget.set(url, { bytes, priority, evict });
    return true;
}
const emptyFrame: VeyonScreenshotFrame = {
    image: null, stale: false, lastUpdated: null, consecutiveFailures: 0, lastError: null,
};

function parsePayload(event: Event): Record<string, unknown> | null {
    try {
        const value: unknown = JSON.parse((event as MessageEvent<string>).data);
        return value !== null && typeof value === 'object' && !Array.isArray(value)
            ? value as Record<string, unknown> : null;
    } catch {
        return null;
    }
}

function validStatus(payload: Record<string, unknown>): boolean {
    return typeof payload.stale === 'boolean' &&
        typeof payload.consecutiveFailures === 'number' &&
        Number.isSafeInteger(payload.consecutiveFailures) && payload.consecutiveFailures >= 0 &&
        (payload.initial === undefined || typeof payload.initial === 'boolean');
}

function validTimestamp(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function imageBlob(payload: Record<string, unknown>): Blob | null {
    if (typeof payload.image !== 'string' ||
        payload.image.length > Math.ceil(MAX_FRAME_BYTES / 3) * 4 ||
        payload.image.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.image) ||
        !payload.image.length || typeof payload.mimeType !== 'string' ||
        !/^image\/(jpeg|png|webp|gif|bmp|avif)$/.test(payload.mimeType)) return null;
    try {
        const binary = atob(payload.image);
        if (binary.length > MAX_FRAME_BYTES) return null;
        return new Blob([Uint8Array.from(binary, (char) => char.charCodeAt(0))], { type: payload.mimeType });
    } catch {
        return null;
    }
}

export function useVeyonScreenshots(
    computerIds: string[],
    { paused = false, minFrameIntervalMs = 5000, width = 320, quality = 50, priority = 'grid' }: UseVeyonScreenshotsOptions = {},
): UseVeyonScreenshotsResult {
    const idsKey = [...new Set(computerIds)].slice(0, 64).sort().join(',');
    const [frames, setFrames] = useState<Record<string, VeyonScreenshotFrame>>({});
    const [connected, setConnected] = useState(false);
    const [refreshToken, setRefreshToken] = useState(0);
    const [oneShotVersion, setOneShotVersion] = useState(0);
    const [visible, setVisible] = useState(() => !document.hidden);
    const [visibilityVersion, setVisibilityVersion] = useState(0);
    const stopTransportRef = useRef<() => void>(() => {});
    const oneShotRequestedRef = useRef(false);
    const framesRef = useRef(frames);
    const pausedRef = useRef(paused);
    pausedRef.current = paused;
    const refreshOnce = useCallback(() => {
        if (document.hidden) return;
        oneShotRequestedRef.current = pausedRef.current;
        setRefreshToken((token) => token + 1);
    }, []);

    useEffect(() => {
        const visibility = () => {
            if (document.hidden) {
                stopTransportRef.current();
                oneShotRequestedRef.current = false;
                setConnected(false);
                const stale = Object.fromEntries(Object.entries(framesRef.current).map(([id, frame]) =>
                    [id, frame.image ? { ...frame, stale: true } : frame]));
                framesRef.current = stale;
                setFrames(stale);
            } else {
                setVisibilityVersion((version) => version + 1);
            }
            setVisible(!document.hidden);
        };
        document.addEventListener('visibilitychange', visibility);
        return () => document.removeEventListener('visibilitychange', visibility);
    }, []);

    useEffect(() => {
        const ids = idsKey ? idsKey.split(',') : [];
        const requested = new Set(ids);
        const publish = (next: Record<string, VeyonScreenshotFrame>) => {
            framesRef.current = next;
            setFrames(next);
        };
        const retained = { ...framesRef.current };
        for (const id of Object.keys(retained)) {
            if (requested.has(id)) continue;
            if (retained[id].image) releaseDisplayed(retained[id].image!);
            delete retained[id];
        }
        publish(retained);
        setConnected(false);
        if (!paused || !ids.length) oneShotRequestedRef.current = false;
        if (!ids.length || !visible || document.hidden || (paused && !oneShotRequestedRef.current)) return;

        let active = true;
        let transportVersion = 0;
        const oneShot = paused;
        const seen = new Set<string>();
        const queued = new Map<string, Candidate>();
        const decoding = new Map<string, Candidate>();
        const versions = new Map<string, number>();
        const stateVersions = new Map<string, number>();
        const timestamps = new Map<string, number>();
        let timer: number | undefined;
        const update = (id: string, value: VeyonScreenshotFrame) => {
            publish({ ...framesRef.current, [id]: value });
        };
        const finish = () => {
            if (!active || !oneShot || !oneShotRequestedRef.current) return;
            oneShotRequestedRef.current = false;
            setOneShotVersion((version) => version + 1);
        };
        const markSeen = (id: string) => {
            if (!oneShot) return;
            seen.add(id);
            if (ids.every((value) => seen.has(value))) finish();
        };
        const pump = () => {
            if (!active || document.hidden) return;
            for (const candidate of queued.values()) {
                if (activeDecodes >= MAX_DECODES) break;
                if (decoding.has(candidate.id)) continue;
                queued.delete(candidate.id);
                const { id, frame, version, stateVersion, transport, bytes } = candidate;
                const url = URL.createObjectURL(candidate.blob!);
                const image = new Image();
                candidate.blob = null;
                candidate.url = url;
                candidate.image = image;
                decoding.set(id, candidate);
                activeDecodes += 1;
                let settled = false;
                const complete = (success: boolean) => {
                    if (settled) return;
                    settled = true;
                    activeDecodes -= 1;
                    if (decoding.get(id) === candidate) decoding.delete(id);
                    if (active && !document.hidden && !candidate.cancelled && candidateBudget.has(candidate) && versions.get(id) === version) {
                        const previous = framesRef.current[id] ?? emptyFrame;
                        const cost = image.naturalWidth * image.naturalHeight * 4 + bytes;
                        const evict = () => {
                            const current = framesRef.current[id];
                            if (current?.image === url) update(id, {
                                ...current, image: null, lastUpdated: null, stale: true, lastError: 'Screenshot cache limit reached',
                            });
                        };
                        if (success && image.naturalWidth > 0 && image.naturalHeight > 0 &&
                            retainImage(url, cost, priority, previous.image, evict)) {
                            candidateBudget.delete(candidate);
                            candidate.url = undefined;
                            const newerState = (stateVersions.get(id) ?? 0) !== stateVersion;
                            update(id, {
                                image: url,
                                stale: frame.stale || transportVersion !== transport ||
                                    (Boolean(frame.initial) && previous.stale) || (newerState && previous.stale),
                                lastUpdated: frame.lastUpdated,
                                consecutiveFailures: newerState ? previous.consecutiveFailures : frame.consecutiveFailures,
                                lastError: newerState ? previous.lastError : null,
                            });
                            if (previous.image) releaseDisplayed(previous.image);
                        } else {
                            candidate.cancel();
                            update(id, { ...previous, stale: true,
                                lastError: success ? 'Screenshot exceeds image memory limit' : 'Could not decode screenshot' });
                        }
                        markSeen(id);
                    } else candidate.cancel();
                    image.onload = null;
                    image.onerror = null;
                    image.removeAttribute('src');
                    pumpDecodes();
                };
                if (typeof image.decode === 'function') {
                    image.src = url;
                    try {
                        void image.decode().then(() => complete(true), () => complete(false));
                    } catch {
                        complete(false);
                    }
                } else {
                    const cancel = candidate.cancel;
                    candidate.cancel = () => { cancel(); complete(false); };
                    image.onload = () => complete(true);
                    image.onerror = () => complete(false);
                    image.src = url;
                }
            }
        };
        decodePumps.set(pump, priority);
        const source = new EventSource(veyonScreenshotStreamUrl(ids, {
            intervalMs: minFrameIntervalMs,
            refresh: refreshToken > 0 || visibilityVersion > 0,
            width, quality, priority,
        }));
        source.onopen = () => { if (active) setConnected(true); };
        source.addEventListener('hello', () => { if (active) setConnected(true); });
        source.onerror = () => {
            if (!active) return;
            transportVersion += 1;
            setConnected(false);
            publish(Object.fromEntries(Object.entries(framesRef.current).map(([id, value]) =>
                [id, value.image ? { ...value, stale: true } : value])));
            if (source.readyState === EventSource.CLOSED) finish();
        };
        const payloadFor = (event: Event) => {
            if (!active || document.hidden) return null;
            const payload = parsePayload(event);
            if (!payload || typeof payload.computerId !== 'string' ||
                !requested.has(payload.computerId)) return null;
            return payload;
        };
        source.addEventListener('reset', (event) => {
            const payload = payloadFor(event);
            if (!payload) return;
            const id = payload.computerId as string;
            versions.set(id, (versions.get(id) ?? 0) + 1);
            timestamps.delete(id);
            seen.delete(id);
            queued.get(id)?.cancel();
            decoding.get(id)?.cancel();
            const previous = framesRef.current[id]?.image;
            if (previous) releaseDisplayed(previous);
            update(id, { ...emptyFrame });
        });
        source.addEventListener('state', (event) => {
            const payload = payloadFor(event);
            if (!payload || !validStatus(payload) ||
                !(payload.lastUpdated === null || validTimestamp(payload.lastUpdated)) ||
                !(payload.lastError === null || typeof payload.lastError === 'string') ||
                ((oneShot || visibilityVersion > 0) && payload.initial)) return;
            const state = payload as unknown as VeyonScreenshotStateEvent;
            stateVersions.set(state.computerId, (stateVersions.get(state.computerId) ?? 0) + 1);
            const previous = framesRef.current[state.computerId] ?? emptyFrame;
            update(state.computerId, {
                ...previous,
                stale: previous.image ? previous.stale || state.stale : state.stale,
                consecutiveFailures: state.consecutiveFailures,
                lastError: state.lastError,
            });
            markSeen(state.computerId);
        });
        source.addEventListener('frame', (event) => {
            const payload = payloadFor(event);
            if (!payload || !validStatus(payload) || !validTimestamp(payload.lastUpdated) ||
                ((oneShot || visibilityVersion > 0) && payload.initial)) return;
            const blob = imageBlob(payload);
            if (!blob) return;
            const frame = payload as unknown as VeyonScreenshotFrameEvent;
            const id = frame.computerId;
            const latest = timestamps.get(id) ?? framesRef.current[id]?.lastUpdated ?? -1;
            if (frame.lastUpdated < latest) return;
            timestamps.set(id, frame.lastUpdated);
            const version = (versions.get(id) ?? 0) + 1;
            versions.set(id, version);
            queued.get(id)?.cancel();
            decoding.get(id)?.cancel();
            let pendingBytes = blob.size;
            for (const candidate of candidateBudget) pendingBytes += candidate.bytes;
            // Latest pending candidate wins. Evict oldest queued bytes before
            // admitting another; running native decodes retain their slot until settled.
            for (const candidate of candidateBudget) {
                if (pendingBytes <= MAX_CANDIDATE_BYTES) break;
                if (candidate.image) continue;
                pendingBytes -= candidate.bytes;
                candidate.cancel();
            }
            if (pendingBytes > MAX_CANDIDATE_BYTES) return;
            const { image: _encodedImage, mimeType: _mimeType, ...metadata } = frame;
            const candidate: Candidate = {
                id, frame: metadata, blob, bytes: blob.size, version, cancelled: false,
                stateVersion: stateVersions.get(id) ?? 0, transport: transportVersion,
                cancel: () => {
                    candidate.cancelled = true;
                    if (decoding.get(id) !== candidate) candidateBudget.delete(candidate);
                    if (queued.get(id) === candidate) queued.delete(id);
                    candidate.blob = null;
                    if (candidate.image) {
                        candidate.image.onload = null;
                        candidate.image.onerror = null;
                        candidate.image.removeAttribute('src');
                    }
                    if (candidate.url) { URL.revokeObjectURL(candidate.url); candidate.url = undefined; }
                },
            };
            candidateBudget.add(candidate);
            queued.set(id, candidate);
            pumpDecodes();
        });
        if (oneShot) timer = window.setTimeout(finish, ONE_SHOT_TIMEOUT_MS);
        const stop = () => {
            if (!active) return;
            active = false;
            window.clearTimeout(timer);
            source.close();
            decodePumps.delete(pump);
            for (const candidate of queued.values()) candidate.cancel();
            for (const candidate of decoding.values()) candidate.cancel();
        };
        stopTransportRef.current = stop;
        return () => {
            stop();
            if (stopTransportRef.current === stop) stopTransportRef.current = () => {};
        };
    }, [idsKey, paused, minFrameIntervalMs, width, quality, priority, refreshToken, oneShotVersion, visible, visibilityVersion]);

    useEffect(() => () => {
        for (const frame of Object.values(framesRef.current)) {
            if (frame.image) releaseDisplayed(frame.image);
        }
        framesRef.current = {};
    }, []);

    return { frames, connected, refreshOnce };
}
