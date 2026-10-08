import { resetApiStreams } from '@/api/useApiStream';
import { vi } from 'vitest';

export const streamFixtures = new Map<string, unknown>();

export class SettingsEventSource extends EventTarget {
    static CLOSED = 2;
    static instances: SettingsEventSource[] = [];
    closed = false;
    readonly paths: string[];

    constructor(url: string) {
        super();
        this.paths = JSON.parse(new URL(url, 'http://localhost').searchParams.get('paths')!);
        SettingsEventSource.instances.push(this);
        queueMicrotask(() => {
            for (const path of this.paths) {
                if (streamFixtures.has(path)) this.emit(path, streamFixtures.get(path));
            }
        });
    }

    close() { this.closed = true; }

    emit(path: string, data: unknown, status = 200) {
        if (!this.closed && this.paths.includes(path)) {
            this.dispatchEvent(new MessageEvent('snapshot', { data: JSON.stringify({ path, data, status }) }));
        }
    }
}

export function installSettingsStream() {
    streamFixtures.clear();
    SettingsEventSource.instances = [];
    vi.stubGlobal('EventSource', SettingsEventSource);
    Object.defineProperty(document, 'fonts', { configurable: true, value: new EventTarget() });
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    resetApiStreams();
}

export function emitSettingsSnapshot(path: string, data: unknown, status = 200) {
    streamFixtures.set(path, data);
    for (const source of SettingsEventSource.instances) source.emit(path, data, status);
}

export function settingsPaths() {
    return SettingsEventSource.instances.filter((source) => !source.closed).flatMap((source) => source.paths);
}
