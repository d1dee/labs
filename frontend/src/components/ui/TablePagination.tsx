import { Group, Pagination, Text } from '@mantine/core';
import { useState } from 'react';

const PAGE_SIZE = 20;

export function useTablePagination<T>(items: readonly T[], resetKey: string) {
    const [state, setState] = useState({ page: 1, resetKey });
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const page = state.resetKey === resetKey ? Math.min(state.page, totalPages) : 1;

    // Persist resets and clamps so subsequent snapshots cannot restore a stale page.
    if (state.resetKey !== resetKey || state.page !== page) {
        setState({ page, resetKey });
    }

    return {
        pageItems: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
        page,
        totalPages,
        totalItems: items.length,
        pageSize: PAGE_SIZE,
        setPage: (nextPage: number) => setState({
            page: Math.max(1, Math.min(nextPage, totalPages)),
            resetKey,
        }),
    };
}

interface TablePaginationProps {
    pagination: {
        page: number;
        totalPages: number;
        totalItems: number;
        pageSize: number;
        setPage: (page: number) => void;
    };
    label: string;
}

export function TablePagination({ pagination, label }: TablePaginationProps) {
    const { page, totalPages, totalItems, pageSize, setPage } = pagination;
    if (totalItems === 0) return null;

    return (
        <Group justify='space-between' gap='sm' wrap='wrap'>
            <Text size='sm' c='dimmed'>
                Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, totalItems)} of {totalItems} {label}
            </Text>
            {totalPages > 1 && (
                <Pagination
                    aria-label={`${label} pagination`}
                    value={page}
                    onChange={setPage}
                    total={totalPages}
                    siblings={0}
                    size='sm'
                    getControlProps={(control) => ({ 'aria-label': `${control} page` })}
                    getItemProps={(item) => ({ 'aria-label': `Page ${item}` })}
                />
            )}
        </Group>
    );
}
