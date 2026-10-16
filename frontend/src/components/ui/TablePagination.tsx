import { Group, Pagination, Select, Text } from '@mantine/core';
import { useState } from 'react';

const PAGE_SIZE = 20;

export function useTablePagination<T>(items: readonly T[], resetKey: string) {
    const [state, setState] = useState({ page: 1, resetKey });
    const [pageSize, setPageSize] = useState(PAGE_SIZE);
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    const page = state.resetKey === resetKey ? Math.min(state.page, totalPages) : 1;

    // Persist resets and clamps so subsequent snapshots cannot restore a stale page.
    if (state.resetKey !== resetKey || state.page !== page) {
        setState({ page, resetKey });
    }

    return {
        pageItems: items.slice((page - 1) * pageSize, page * pageSize),
        page,
        totalPages,
        totalItems: items.length,
        pageSize,
        setPageSize: (nextSize: number) => {
            if (!Number.isInteger(nextSize) || nextSize < 1) return;
            setPageSize(nextSize);
            setState({ page: 1, resetKey });
        },
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
        setPageSize: (pageSize: number) => void;
    };
    label: string;
    showPageSizeSelector?: boolean;
}

export function TablePagination({ pagination, label, showPageSizeSelector = false }: TablePaginationProps) {
    const { page, totalPages, totalItems, pageSize, setPage, setPageSize } = pagination;
    if (totalItems === 0) return null;

    return (
        <Group justify='space-between' gap='sm' wrap='wrap'>
            <Text size='sm' c='dimmed'>
                Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, totalItems)} of {totalItems} {label}
            </Text>
            {showPageSizeSelector && (
                <Group gap='xs' wrap='nowrap'>
                    <Text size='sm'>Rows per page</Text>
                    <Select
                        aria-label='Rows per page'
                        size='xs'
                        w={80}
                        allowDeselect={false}
                        value={String(pageSize)}
                        onChange={(value) => {
                            if (value !== null) setPageSize(Number(value));
                        }}
                        data={['10', '20', '50', '100']}
                    />
                </Group>
            )}
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
