import { useSessionContext } from '@/context/SessionContext';
import { useEffect, useMemo, useState } from 'react';
import {
    createDeviceIdentityLookup,
    labForAddresses,
    type DeviceDirectory,
    type DeviceIdentity,
    type DeviceLookup,
} from './devices';
import { useApiStream } from './useApiStream';

const MAX_DIRECTORY_AGE = 90_000;

export function deviceIdentitySearchText(identity: DeviceIdentity | null) {
    return identity
        ? [
              identity.hostname,
              ...identity.hostnames,
              ...identity.addresses,
              ...identity.macAddresses,
              identity.lab?.name,
              identity.lab?.dhcpServer,
              identity.location,
          ]
              .filter(Boolean)
              .join(' ')
        : '';
}

export function useDeviceIdentities() {
    const session = useSessionContext();
    const organizationId = session.organizationId;
    const enabled = Boolean(session.user && organizationId);
    const scope = `${session.user?.id ?? ''}:${organizationId ?? ''}`;
    const [snapshot, setSnapshot] = useState<{
        scope: string;
        directory: DeviceDirectory | null;
        error: string | null;
    }>({
        scope,
        directory: null,
        error: null,
    });
    const [now, setNow] = useState(Date.now);
    if (snapshot.scope !== scope)
        setSnapshot({ scope, directory: null, error: null });

    useApiStream<DeviceDirectory>(
        enabled ? '/api/devices' : null,
        (directory) => {
            if (directory.organizationId !== organizationId) {
                setSnapshot({
                    scope,
                    directory: null,
                    error: 'Device directory organization changed.',
                });
                return;
            }
            setNow(Date.now());
            setSnapshot({ scope, directory, error: null });
        },
        (error) =>
            setSnapshot({ scope, directory: null, error: error.message }),
    );

    const directory =
        enabled && snapshot.scope === scope ? snapshot.directory : null;
    const updatedAt = directory?.updatedAt ?? null;
    const expiresAt = updatedAt
        ? Date.parse(updatedAt) + MAX_DIRECTORY_AGE
        : NaN;
    const isFresh = Boolean(
        directory && Number.isFinite(expiresAt) && now < expiresAt,
    );
    useEffect(() => {
        if (!Number.isFinite(expiresAt)) return;
        const timer = window.setTimeout(
            () => setNow(Date.now()),
            Math.max(0, expiresAt - Date.now()),
        );
        return () => window.clearTimeout(timer);
    }, [expiresAt]);
    const lookup = useMemo(
        () => createDeviceIdentityLookup(isFresh ? directory!.devices : []),
        [directory, isFresh],
    );
    const sourceErrors =
        directory && isFresh
            ? Object.entries(directory.sources)
                  .filter(([, source]) => source.state === 'unavailable')
                  .map(([source]) => source)
            : [];
    const partialSources =
        directory && isFresh
            ? Object.entries(directory.sources)
                  .filter(([, source]) => source.state === 'partial')
                  .map(([source]) => source)
            : [];
    const error = snapshot.scope === scope ? snapshot.error : null;
    const warning = error
        ? `Current device associations unavailable: ${error}`
        : directory && !isFresh
          ? 'Current device associations expired. Waiting for a fresh directory.'
          : sourceErrors.length
             ? `Device directory sources unavailable: ${sourceErrors.join(', ')}.`
             : null;
    const labs = useMemo(() => isFresh && directory
        ? [...new Map([
            ...(directory.labs ?? []),
            ...directory.devices.flatMap((device) => device.lab ? [device.lab] : []),
        ].map((lab) => [lab.id, lab])).values()].sort((a, b) => a.name.localeCompare(b.name))
        : [], [directory, isFresh]);
    const labFor = useMemo(() => (query: DeviceLookup) => {
        if (!isFresh || !directory) return null;
        const device = lookup(query);
        return device?.lab ?? labForAddresses(device?.addresses ?? (query.address ? [query.address] : []), directory.labs ?? []);
    }, [directory, isFresh, lookup]);
    return {
        lookup,
        labFor,
        labs,
        error,
        warning,
        updatedAt,
        isFresh,
        sourceErrors,
        partialSources,
    };
}
