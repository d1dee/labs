import { useCallback, useEffect, useState } from 'react';
import { useSessionContext } from '@/context/SessionContext';
import type { FogHost } from './fog';
import type { DeviceIdentity, DeviceLookup } from './devices';
import { normalizeDeviceMac } from './devices';
import type { VeyonComputer } from './veyon';
import { useApiStream } from './useApiStream';

// FOG probes port 445: success and connection refusal both establish reachability.
function fogReachable(host: FogHost) {
    return host.pingstatuscode === 0 || host.pingstatuscode === 111;
}

export function useFogHostStatus(hosts: FogHost[], lookup: (query: DeviceLookup) => DeviceIdentity | null) {
    const { user, organizationId } = useSessionContext();
    const scope = user && organizationId ? `${user.id}:${organizationId}` : null;
    const needed = Boolean(scope && hosts.some((host) => !fogReachable(host) &&
        lookup({ fogHostId: host.id, macAddress: host.primac || host.macs?.[0] })?.veyonComputerIds.length));
    const [configuredScope, setConfiguredScope] = useState<string | null>(null);
    const [live, setLive] = useState<{ scope: string | null; computers: VeyonComputer[]; online: Record<string, boolean> }>(
        { scope: null, computers: [], online: {} },
    );
    useApiStream<{ configured: boolean }>(needed ? '/api/veyon/status' : null,
        (status) => setConfiguredScope(status.configured ? scope : null), () => setConfiguredScope(null));

    useEffect(() => {
        setLive({ scope, computers: [], online: {} });
        if (!needed || !scope || configuredScope !== scope) return;
        let cancelled = false;
        let source: EventSource | undefined;
        let retry: number | undefined;
        const clear = () => { if (!cancelled) setLive({ scope, computers: [], online: {} }); };
        const stop = () => { source?.close(); source = undefined; window.clearTimeout(retry); };
        const connect = () => {
            if (cancelled || document.hidden || source) return;
            try {
                const connection = new EventSource('/api/veyon/information/stream?mode=status');
                source = connection;
                const active = () => !cancelled && !document.hidden && source === connection;
                connection.addEventListener('directory', (event) => {
                    if (!active()) return;
                    const { computers } = JSON.parse((event as MessageEvent<string>).data) as { computers: VeyonComputer[] };
                    setLive((current) => ({ scope, computers, online: Object.fromEntries(computers.flatMap((computer) => {
                        const old = current.computers.find((entry) => entry.id === computer.id);
                        return old?.host === computer.host && normalizeDeviceMac(old.macAddress ?? '') === normalizeDeviceMac(computer.macAddress ?? '') &&
                            current.online[computer.id] !== undefined ? [[computer.id, current.online[computer.id]]] : [];
                    })) }));
                });
                connection.addEventListener('information', (event) => {
                    if (!active()) return;
                    const data = JSON.parse((event as MessageEvent<string>).data) as { computerId: string; state: string };
                    if (data.state !== 'online' && data.state !== 'offline') return;
                    setLive((current) => current.computers.some((computer) => computer.id === data.computerId)
                        ? { ...current, online: { ...current.online, [data.computerId]: data.state === 'online' } } : current);
                });
                connection.addEventListener('unavailable', () => { if (active()) clear(); });
                connection.onerror = () => {
                    if (!active()) return;
                    clear();
                    if (connection.readyState === EventSource.CLOSED) {
                        stop();
                        retry = window.setTimeout(connect, 10_000);
                    }
                };
            } catch {
                clear();
                retry = window.setTimeout(connect, 10_000);
            }
        };
        const visibility = () => { if (document.hidden) { stop(); clear(); } else connect(); };
        document.addEventListener('visibilitychange', visibility);
        connect();
        return () => { cancelled = true; stop(); document.removeEventListener('visibilitychange', visibility); };
    }, [needed, scope, configuredScope]);

    return useCallback((host: FogHost): 'Online' | 'Offline' => {
        if (fogReachable(host)) return 'Online';
        if (!needed || !scope || live.scope !== scope || configuredScope !== scope) return 'Offline';
        const identity = lookup({ fogHostId: host.id, macAddress: host.primac || host.macs?.[0] });
        return identity && live.computers.some((computer) => identity.veyonComputerIds.includes(computer.id) && live.online[computer.id] &&
            lookup({ veyonComputerId: computer.id, macAddress: computer.macAddress })?.id === identity.id) ? 'Online' : 'Offline';
    }, [needed, scope, configuredScope, live, lookup]);
}
