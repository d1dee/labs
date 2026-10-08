import { Group, Table, UnstyledButton } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconArrowsSort } from '@tabler/icons-react';

export type SortState<K extends string = string> = {
    key: K;
    direction: 'asc' | 'desc';
};

export function toggleTableSort<K extends string>(current: SortState<K> | null, key: K): SortState<K> {
    return { key, direction: current?.key === key && current.direction === 'asc' ? 'desc' : 'asc' };
}

export function compareTableValues(
    a: string | number | null | undefined,
    b: string | number | null | undefined,
    direction: 'asc' | 'desc',
): number {
    const aMissing = a == null || (typeof a === 'number' && !Number.isFinite(a));
    const bMissing = b == null || (typeof b === 'number' && !Number.isFinite(b));
    if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
    const comparison = typeof a === 'number' && typeof b === 'number'
        ? a - b
        : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
    return direction === 'asc' ? comparison : -comparison;
}

export function SortableTh({ label, active, direction, onSort }: {
    label: string;
    active: boolean;
    direction: 'asc' | 'desc';
    onSort: () => void;
}) {
    const Icon = active ? (direction === 'asc' ? IconArrowUp : IconArrowDown) : IconArrowsSort;
    return (
        <Table.Th aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
            <UnstyledButton
                onClick={onSort}
                aria-label={`Sort by ${label} ${active && direction === 'asc' ? 'descending' : 'ascending'}`}
                style={{ width: '100%', fontWeight: 'inherit' }}
            >
                <Group gap={6} wrap='nowrap'>
                    <span>{label}</span>
                    <Icon size={14} aria-hidden='true' />
                </Group>
            </UnstyledButton>
        </Table.Th>
    );
}
