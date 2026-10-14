import type { FogHost } from '@/api/fog';
import { MobileFilterPanel, MobileFilterToggle, useMobileTableFilters } from '@/components/ui/MobileTableFilters';
import {
    ActionIcon,
    Button,
    Box,
    Flex,
    Group,
    Select,
    Stack,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { IconSearch, IconX } from '@tabler/icons-react';
import { useDeferredValue, useMemo, useState } from 'react';

export interface Filters {
    search: string;
    image: string | null;
    status: string | null;
    manufacturer: string | null;
    model: string | null;
    lab: string | null;
}

export const EMPTY_FILTERS: Filters = {
    search: '',
    image: null,
    status: null,
    manufacturer: null,
    model: null,
    lab: null,
};

function matchesSearch(host: FogHost, term: string, status: string): boolean {
    const t = term.trim().toLowerCase();
    return (
        String(host.id).includes(t) ||
        host.name?.toLowerCase().includes(t) ||
        host.macs?.some((m) => m.toLowerCase().includes(t)) ||
        host.imagename?.toLowerCase().includes(t) ||
        host.inventory?.sysman?.toLowerCase().includes(t) ||
        host.inventory?.sysproduct?.toLowerCase().includes(t) ||
        host.inventory?.cpuversion?.toLowerCase().includes(t) ||
        host.ip?.toLowerCase().includes(t) ||
        status.toLowerCase().includes(t) ||
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

export function useHostFilters(allHosts: FogHost[], statusFor: (host: FogHost) => string, identitySearchText?: (host: FogHost) => string, labIdFor?: (host: FogHost) => string | null): UseHostFiltersResult {
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
            allHosts.map(statusFor),
        );
        return [...seen].sort().map((v) => ({ value: v, label: v }));
    }, [allHosts, statusFor]);

    const filteredHosts = useMemo(() => {
        return allHosts.filter((host) => {
            if (deferredFilters.lab && labIdFor?.(host) !== deferredFilters.lab) return false;
            if (
                deferredFilters.search &&
                !matchesSearch(host, deferredFilters.search, statusFor(host)) &&
                !identitySearchText?.(host).toLowerCase().includes(deferredFilters.search.trim().toLowerCase())
            )
                return false;
            if (
                deferredFilters.image &&
                host.imagename !== deferredFilters.image
            )
                return false;
            if (
                deferredFilters.status &&
                statusFor(host) !== deferredFilters.status
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
    }, [allHosts, deferredFilters, identitySearchText, labIdFor, statusFor]);

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
    labOptions: { value: string; label: string }[];
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
    labOptions,
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
    const { opened, toggle, controlsId } = useMobileTableFilters();

    return (
            <Stack gap='md'>
                <Flex direction={{ base: 'column', sm: 'row' }} align={{ base: 'stretch', sm: 'flex-end' }} gap='md'>
                    <Box flex={1} miw={0} style={{ overflowWrap: 'anywhere' }}>
                        <Title order={4}>Registered Hosts</Title>
                        <Text size='sm' c='dimmed'>
                            Select one or more hosts to perform actions.
                        </Text>
                    </Box>
                    <Group align='flex-end' wrap='nowrap' w={{ base: '100%', sm: 300 }} style={{ flexShrink: 0 }}>
                    <TextInput
                        aria-label='Search'
                        placeholder='Search ID, name, MAC, image, manufacturer, model, IP, status...'
                        value={filters.search}
                        onChange={(e) =>
                            setFilter('search', e.currentTarget.value)
                        }
                        leftSection={<IconSearch size={14} />}
                        rightSection={
                            filters.search ? (
                                <ActionIcon
                                    size='xs'
                                    aria-label='Clear host search'
                                    variant='subtle'
                                    onClick={() => setFilter('search', '')}
                                >
                                    <IconX size={12} />
                                </ActionIcon>
                            ) : undefined
                        }
                        style={{ flex: 1, minWidth: 0 }}
                    />
                    <MobileFilterToggle
                        opened={opened}
                        onToggle={toggle}
                        controlsId={controlsId}
                        label='Toggle host filters'
                    />
                    </Group>
                </Flex>
                <MobileFilterPanel id={controlsId} opened={opened}>
                    <Group grow preventGrowOverflow={false} align='flex-end'>
                        <Select
                            miw={{ base: '100%', sm: 180 }}
                            label='Lab'
                            placeholder='All labs'
                            data={labOptions}
                            value={filters.lab}
                            onChange={(v) => setFilter('lab', v)}
                            clearable
                            searchable
                            nothingFoundMessage='No labs'
                        />
                        <Select
                            miw={{ base: '100%', sm: 180 }}
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
                            miw={{ base: '100%', sm: 180 }}
                            label='Status'
                            placeholder='All statuses'
                            data={statusOptions}
                            value={filters.status}
                            onChange={(v) => setFilter('status', v)}
                            clearable
                        />
                        <Select
                            miw={{ base: '100%', sm: 180 }}
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
                            miw={{ base: '100%', sm: 180 }}
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
                </MobileFilterPanel>
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
    );
}
