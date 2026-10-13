import { type ActivationHistoryEntry } from '@/api/firewall';
import { Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';

const DAY_MS = 24 * 60 * 60 * 1000;

interface CurrentNetworkStatus {
    enabled: boolean;
    timestamp: string;
}

export function buildNetworkPeriods(
    history: ActivationHistoryEntry[],
    now: number,
    currentStatus?: CurrentNetworkStatus,
) {
    const start = now - DAY_MS;
    const events: {
        time: number;
        enabled: boolean;
        changedAt: number | null;
    }[] = history
        .slice().reverse()
        .map((entry) => {
            const time = Date.parse(entry.createdAt);
            return { time, enabled: entry.enabled, changedAt: time };
        })
        .filter((entry) => Number.isFinite(entry.time) && entry.time <= now)
        .sort((a, b) => a.time - b.time);
    const latestEvent = events[events.length - 1];
    const observedAt = currentStatus
        ? Date.parse(currentStatus.timestamp)
        : NaN;
    const currentIsKnown =
        currentStatus !== undefined &&
        Number.isFinite(observedAt) &&
        observedAt <= now;
    // Router observations establish the current state, not an activation time.
    if (
        currentIsKnown &&
        latestEvent &&
        observedAt >= latestEvent.time &&
        latestEvent.enabled !== currentStatus.enabled
    ) {
        events.push({
            time: observedAt,
            enabled: currentStatus.enabled,
            changedAt: null,
        });
    }
    const periods: {
        start: number;
        end: number;
        enabled: boolean | null;
        changedAt: number | null;
    }[] = [];
    let cursor = start;
    let enabled: boolean | null =
        events.length === 0 && currentIsKnown ? currentStatus.enabled : null;
    let changedAt: number | null = null;

    for (const event of events) {
        if (event.time <= start) {
            if (enabled !== event.enabled) changedAt = event.changedAt;
            enabled = event.enabled;
            continue;
        }
        if (enabled === event.enabled) continue;
        if (event.time > cursor) {
            periods.push({
                start: cursor,
                end: event.time,
                enabled,
                changedAt,
            });
        }
        cursor = event.time;
        enabled = event.enabled;
        changedAt = event.changedAt;
    }
    if (cursor < now)
        periods.push({ start: cursor, end: now, enabled, changedAt });
    return periods;
}

export default function NetworkAccessTimeline({
    history = [],
    currentStatus,
}: {
    history?: ActivationHistoryEntry[];
    currentStatus?: CurrentNetworkStatus;
}) {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const updateNow = () => setNow(Date.now());
        const interval = setInterval(updateNow, 1000);
        document.addEventListener('visibilitychange', updateNow);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', updateNow);
        };
    }, []);
    // New stream events can arrive between clock ticks.
    const end = Math.max(now, Date.now());
    const periods = buildNetworkPeriods(history, end, currentStatus);

    return (
        <Stack gap='xs'>
            <Group justify='space-between' gap='xs'>
                <Text size='sm' c='dimmed'>
                    Network access
                </Text>
                <Text size='xs' c='dimmed'>
                    Last 24 hours
                </Text>
            </Group>
            <Group gap='sm'>
                <Text size='xs' c='green.6'>
                    Network on
                </Text>
                <Text size='xs' c='red.6'>
                    Network off
                </Text>
                {periods.some((period) => period.enabled === null) && (
                    <Text size='xs' c='dimmed'>
                        Unknown
                    </Text>
                )}
            </Group>
            <Box
                style={{
                    display: 'flex',
                    height: 48,
                    overflow: 'hidden',
                    borderRadius: 4,
                }}
                aria-label='Network access history for the last 24 hours'
            >
                {periods.map((period) => {
                    const state =
                        period.enabled === null
                            ? 'Unknown'
                            : period.enabled
                              ? 'Activated'
                              : 'Deactivated';
                    const label =
                        period.changedAt === null
                            ? period.enabled === null
                                ? 'No recorded activation time'
                                : `Network ${period.enabled ? 'on' : 'off'}; transition time unavailable`
                            : history.some((entry) => entry.source === 'external' &&
                                Date.parse(entry.createdAt) === period.changedAt && entry.enabled === period.enabled)
                              ? `Network ${period.enabled ? 'on' : 'off'} detected externally at ${dayjs(period.changedAt).format('HH:mm:ss')}; actual transition time unavailable`
                              : `${state} at ${dayjs(period.changedAt).format('HH:mm:ss')}`;
                    return (
                        <Tooltip
                            key={
                                period.changedAt ??
                                (period.enabled === null
                                    ? 'unknown'
                                    : 'current')
                            }
                            label={label}
                            withArrow
                            events={{ hover: true, focus: true, touch: true }}
                        >
                            <Box
                                tabIndex={0}
                                role='img'
                                aria-label={label}
                                bg={
                                    period.enabled === null
                                        ? 'gray.6'
                                        : period.enabled
                                          ? 'green.6'
                                          : 'red.6'
                                }
                                style={{
                                    width: `${((period.end - period.start) / DAY_MS) * 100}%`,
                                    flexShrink: 0,
                                }}
                            />
                        </Tooltip>
                    );
                })}
            </Box>
            <Group justify='space-between' gap={0} wrap='nowrap'>
                {[24, 18, 12, 6, 0].map((hours) => (
                    <Text key={hours} size='xs' c='dimmed'>
                        {hours === 0
                            ? `Now ${dayjs(end).format('HH:mm:ss')}`
                            : dayjs(end - hours * 60 * 60 * 1000).format(
                                  'HH:mm',
                              )}
                    </Text>
                ))}
            </Group>
        </Stack>
    );
}
