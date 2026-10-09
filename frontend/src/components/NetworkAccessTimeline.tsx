import { type ActivationHistoryEntry } from '@/api/firewall';
import { Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildNetworkPeriods(history: ActivationHistoryEntry[], now: number) {
    const start = now - DAY_MS;
    const events = history
        .map((entry) => ({ time: Date.parse(entry.createdAt), enabled: entry.enabled }))
        .filter((entry) => Number.isFinite(entry.time) && entry.time <= now)
        .sort((a, b) => a.time - b.time);
    const periods: {
        start: number;
        end: number;
        enabled: boolean | null;
        changedAt: number | null;
    }[] = [];
    let cursor = start;
    let enabled: boolean | null = null;
    let changedAt: number | null = null;

    for (const event of events) {
        if (event.time <= start) {
            if (enabled !== event.enabled) changedAt = event.time;
            enabled = event.enabled;
            continue;
        }
        if (enabled === event.enabled) continue;
        if (event.time > cursor) {
            periods.push({ start: cursor, end: event.time, enabled, changedAt });
        }
        cursor = event.time;
        enabled = event.enabled;
        changedAt = event.time;
    }
    if (cursor < now) periods.push({ start: cursor, end: now, enabled, changedAt });
    return periods;
}

export default function NetworkAccessTimeline({ history = [] }: {
    history?: ActivationHistoryEntry[];
}) {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(interval);
    }, []);
    // New stream events can arrive between clock ticks.
    const end = Math.max(now, Date.now());
    const periods = buildNetworkPeriods(history, end);

    return (
        <Stack gap='xs'>
            <Group justify='space-between' gap='xs'>
                <Text size='sm' c='dimmed'>Network access</Text>
                <Text size='xs' c='dimmed'>Last 24 hours</Text>
            </Group>
            <Group gap='sm'>
                <Text size='xs' c='green.6'>Network on</Text>
                <Text size='xs' c='red.6'>Network off</Text>
                {periods.some((period) => period.enabled === null) && (
                    <Text size='xs' c='dimmed'>Unknown</Text>
                )}
            </Group>
            <Box style={{ display: 'flex', height: 48, overflow: 'hidden', borderRadius: 4 }}
                aria-label='Network access history for the last 24 hours'>
                {periods.map((period) => {
                    const state = period.enabled === null ? 'Unknown' : period.enabled ? 'Activated' : 'Deactivated';
                    const label = period.changedAt === null
                        ? 'No recorded activation time'
                        : `${state} at ${dayjs(period.changedAt).format('DD MMM YYYY, HH:mm:ss')}`;
                    return (
                        <Tooltip key={period.start} label={label} withArrow events={{ hover: true, focus: true, touch: true }}>
                            <Box
                                tabIndex={0}
                                role='img'
                                aria-label={label}
                                bg={period.enabled === null ? 'gray.6' : period.enabled ? 'green.6' : 'red.6'}
                                style={{ width: `${(period.end - period.start) / DAY_MS * 100}%`, flexShrink: 0 }}
                            />
                        </Tooltip>
                    );
                })}
            </Box>
            <Group justify='space-between' gap={0} wrap='nowrap'>
                {[24, 18, 12, 6, 0].map((hours) => (
                    <Text key={hours} size='xs' c='dimmed'>
                        {hours === 0 ? 'Now' : dayjs(end - hours * 60 * 60 * 1000).format('HH:mm')}
                    </Text>
                ))}
            </Group>
        </Stack>
    );
}
