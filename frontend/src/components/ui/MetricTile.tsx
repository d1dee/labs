import { Box, Text } from '@mantine/core';
import type { ReactNode } from 'react';

export interface MetricTileProps {
    label: string;
    value: ReactNode;
    /** Highlights the metric in teal, mirroring the Veyon "Online" tile. */
    accent?: boolean;
    /** Optional explicit text color (e.g. 'red.4') overriding the accent rule. */
    color?: string;
}

/**
 * Left-bordered KPI tile rendered inside the dark hero gradient. Extracted
 * from VeyonManagementTab so every dashboard surface shares the same metric
 * structure.
 */
export function MetricTile({ label, value, accent = false, color }: MetricTileProps) {
    const valueColor = color ?? (accent ? 'teal.2' : 'white');
    return (
        <Box
            style={{
                borderLeft: `2px solid ${
                    accent ? 'var(--mantine-color-teal-4)' : 'rgba(255,255,255,.18)'
                }`,
            }}
            pl='sm'
        >
            <Text size='xs' c='gray.4' tt='uppercase' lts={0.8}>
                {label}
            </Text>
            <Text size='xl' fw={700} c={valueColor}>
                {value}
            </Text>
        </Box>
    );
}
