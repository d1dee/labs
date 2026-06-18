import type { FogHost } from '@/api/fog';
import {
    ActionIcon,
    Button,
    Card,
    Group,
    Select,
    Stack,
    Text,
    TextInput,
    Tooltip,
} from '@mantine/core';
import { IconAdjustments, IconSearch, IconX } from '@tabler/icons-react';
import { useDeferredValue, useMemo, useState } from 'react';

export interface Filters {
    search: string;
    image: string | null;
    status: string | null;
    manufacturer: string | null;
    model: string | null;
}

export const EMPTY_FILTERS: Filters = {
    search: '',
    image: null,
    status: null,
    manufacturer: null,
    model: null,
};

function matchesSearch(host: FogHost, term: string): boolean {
    const t = term.toLowerCase();
    return (
        host.name?.toLowerCase().includes(t) ||
        host.macs?.some((m) => m.toLowerCase().includes(t)) ||
        host.imagename?.toLowerCase().includes(t) ||
        host.inventory?.sysman?.toLowerCase().includes(t) ||
        host.inventory?.sysproduct?.toLowerCase().includes(t) ||
        host.inventory?.cpuversion?.toLowerCase().includes(t) ||
        host.ip?.toLowerCase().includes(t) ||
        false
    );
}

function toOptions(
    values: (string | undefined | null)[],
): { value: string; label: string }[] {
    return [...new Set(values.filter(Boolean) as string[])]
        .sort()
        .map((v) => ({ value: v, label: v }));
}

export interface UseHostFiltersResult {
    filters: Filters;
    setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
    clearFilters: () => void;
    deferredFilters: Filters;
    isPending: boolean;
    filteredHosts: FogHost[];
    hasActiveFilters: boolean;
    imageOptions: { value: string; label: string }[];
    statusOptions: { value: string; label: string }[];
    manufacturerOptions: { value: string; label: string }[];
    modelOptions: { value: string; label: string }[];
}

export function useHostFilters(allHosts: FogHost[]): UseHostFiltersResult {
    const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
    const deferredFilters = useDeferredValue(filters);
    const isPending = filters !== deferredFilters;

    const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) =>
        setFilters((prev) => ({ ...prev, [key]: value }));

    const imageOptions = useMemo(
        () => toOptions(allHosts.map((h) => h.imagename)),
        [allHosts],
    );
    const manufacturerOptions = useMemo(
        () => toOptions(allHosts.map((h) => h.inventory?.sysman)),
        [allHosts],
    );
    const modelOptions = useMemo(
        () => toOptions(allHosts.map((h) => h.inventory?.sysproduct)),
        [allHosts],
    );
    const statusOptions = useMemo(() => {
        const seen = new Set(
            allHosts.map((h) => h.pingstatustext ?? 'unknown'),
        );
        return [...seen].sort().map((v) => ({ value: v, label: v }));
    }, [allHosts]);

    const filteredHosts = useMemo(() => {
        return allHosts.filter((host) => {
            if (
                deferredFilters.search &&
                !matchesSearch(host, deferredFilters.search)
            )
                return false;
            if (
                deferredFilters.image &&
                host.imagename !== deferredFilters.image
            )
                return false;
            if (
                deferredFilters.status &&
                (host.pingstatustext ?? 'unknown') !== deferredFilters.status
            )
                return false;
            if (
                deferredFilters.manufacturer &&
                host.inventory?.sysman !== deferredFilters.manufacturer
            )
                return false;
            if (
                deferredFilters.model &&
                host.inventory?.sysproduct !== deferredFilters.model
            )
                return false;
            return true;
        });
    }, [allHosts, deferredFilters]);

    const hasActiveFilters = Object.values(filters).some(
        (v) => v !== null && v !== '',
    );
    const clearFilters = () => setFilters(EMPTY_FILTERS);

    return {
        filters,
        setFilter,
        clearFilters,
        deferredFilters,
        isPending,
        filteredHosts,
        hasActiveFilters,
        imageOptions,
        statusOptions,
        manufacturerOptions,
        modelOptions,
    };
}

export interface HostFilterPanelProps {
    filters: Filters;
    setFilter: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
    clearFilters: () => void;
    hasActiveFilters: boolean;
    isPending: boolean;
    filteredCount: number;
    totalCount: number;
    selectedCount: number;
    imageOptions: { value: string; label: string }[];
    statusOptions: { value: string; label: string }[];
    manufacturerOptions: { value: string; label: string }[];
    modelOptions: { value: string; label: string }[];
}

export function HostFilterPanel({
    filters,
    setFilter,
    clearFilters,
    hasActiveFilters,
    isPending,
    filteredCount,
    totalCount,
    selectedCount,
    imageOptions,
    statusOptions,
    manufacturerOptions,
    modelOptions,
}: HostFilterPanelProps) {
    const [showFilters, setShowFilters] = useState(false);

    return (
        <Card p='md' withBorder>
            <Stack gap='sm'>
                <Group align='flex-end'>
                    <TextInput
                        label='Search'
                        placeholder='Name, MAC, image, manufacturer, model, IP…'
                        value={filters.search}
                        onChange={(e) =>
                            setFilter('search', e.currentTarget.value)
                        }
                        leftSection={<IconSearch size={14} />}
                        rightSection={
                            filters.search ? (
                                <ActionIcon
                                    size='xs'
                                    variant='subtle'
                                    onClick={() => setFilter('search', '')}
                                >
                                    <IconX size={12} />
                                </ActionIcon>
                            ) : undefined
                        }
                        style={{ flex: 1 }}
                    />
                    <Tooltip label='Filters'>
                        <ActionIcon
                            size='lg'
                            variant={showFilters ? 'filled' : 'default'}
                            onClick={() => setShowFilters((v) => !v)}
                        >
                            <IconAdjustments size={18} />
                        </ActionIcon>
                    </Tooltip>
                </Group>
                {showFilters && (
                    <Group grow align='flex-end'>
                        <Select
                            label='Image'
                            placeholder='All images'
                            data={imageOptions}
                            value={filters.image}
                            onChange={(v) => setFilter('image', v)}
                            clearable
                            searchable
                            nothingFoundMessage='No images'
                        />
                        <Select
                            label='Status'
                            placeholder='All statuses'
                            data={statusOptions}
                            value={filters.status}
                            onChange={(v) => setFilter('status', v)}
                            clearable
                        />
                        <Select
                            label='Manufacturer'
                            placeholder='All manufacturers'
                            data={manufacturerOptions}
                            value={filters.manufacturer}
                            onChange={(v) => setFilter('manufacturer', v)}
                            clearable
                            searchable
                            nothingFoundMessage='No manufacturers'
                        />
                        <Select
                            label='Model'
                            placeholder='All models'
                            data={modelOptions}
                            value={filters.model}
                            onChange={(v) => setFilter('model', v)}
                            clearable
                            searchable
                            nothingFoundMessage='No models'
                        />
                    </Group>
                )}
                {hasActiveFilters && (
                    <Group justify='space-between'>
                        <Text size='sm' c='dimmed'>
                            Showing {filteredCount} of {totalCount} hosts
                            {isPending && ' …'}
                        </Text>
                        <Button
                            size='xs'
                            variant='subtle'
                            leftSection={<IconX size={12} />}
                            onClick={clearFilters}
                        >
                            Clear filters
                        </Button>
                    </Group>
                )}
                {selectedCount > 0 && (
                    <Text size='sm' c='blue' fw={500}>
                        {selectedCount} host
                        {selectedCount !== 1 ? 's' : ''} selected
                    </Text>
                )}
            </Stack>
        </Card>
    );
}
