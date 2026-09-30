import {
    applyVeyonSync,
    getVeyonSyncPreview,
    type VeyonSyncApplyInput,
    type VeyonSyncApplyResult,
    type VeyonSyncPlan,
    type VeyonSyncPreview,
} from '@/api/veyon';
import {
    Alert,
    Badge,
    Box,
    Button,
    Checkbox,
    Divider,
    Group,
    Loader,
    Modal,
    Paper,
    Stack,
    Text,
    Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
    IconAlertCircle,
    IconAlertTriangle,
    IconArrowRight,
    IconCircleCheck,
    IconCircleX,
    IconCloudOff,
    IconEdit,
    IconInfoCircle,
    IconLink,
    IconPlus,
    IconRefresh,
    IconTrash,
} from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function resultKey(type: string, id: string | number) {
    return `${type}:${id}`;
}

export default function VeyonSyncModal({
    opened,
    onClose,
    onApplied,
}: {
    opened: boolean;
    onClose: () => void;
    onApplied: () => void;
}) {
    const [preview, setPreview] = useState<VeyonSyncPreview | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [checkedAdditions, setCheckedAdditions] = useState<Set<number>>(new Set());
    const [checkedRenames, setCheckedRenames] = useState<Set<string>>(new Set());
    const [checkedRemovals, setCheckedRemovals] = useState<Set<string>>(new Set());
    const [understandRemovals, setUnderstandRemovals] = useState(false);
    const [applying, setApplying] = useState(false);
    const [result, setResult] = useState<VeyonSyncApplyResult | null>(null);
    const mountedRef = useRef(true);
    const appliedRef = useRef(false);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const loadPreview = useCallback(async () => {
        setLoadingPreview(true);
        setError(null);
        setResult(null);
        setUnderstandRemovals(false);
        try {
            const data = await getVeyonSyncPreview();
            if (!mountedRef.current) return;
            setPreview(data);
            if (data.plan) {
                setCheckedAdditions(new Set(data.plan.additions.map((item) => item.fogHostId)));
                setCheckedRenames(new Set(data.plan.renames.map((item) => item.computerId)));
                setCheckedRemovals(new Set());
            }
        } catch (err) {
            if (!mountedRef.current) return;
            const message = errorMessage(err);
            setError(message);
            notifications.show({ color: 'red', title: 'Sync preview failed', message });
        } finally {
            if (mountedRef.current) setLoadingPreview(false);
        }
    }, []);

    useEffect(() => {
        if (opened) void loadPreview();
    }, [opened, loadPreview]);

    const handleClose = () => {
        if (appliedRef.current) {
            appliedRef.current = false;
            onApplied();
        }
        onClose();
    };

    const apply = async () => {
        const plan = preview?.fogConfigured ? preview.plan : null;
        if (!plan) return;
        setApplying(true);
        setError(null);
        const input: VeyonSyncApplyInput = { links: plan.links };
        if (checkedAdditions.size) input.additions = [...checkedAdditions];
        if (checkedRenames.size) input.renames = [...checkedRenames];
        if (checkedRemovals.size) {
            input.removals = [...checkedRemovals];
            input.confirmRemovals = true;
        }
        try {
            const data = await applyVeyonSync(input);
            if (!mountedRef.current) return;
            setResult(data);
            const failures = data.results.filter((item) => !item.success);
            if (!failures.length || data.results.some((item) => item.success)) {
                appliedRef.current = true;
            }
            notifications.show({
                color: data.success ? 'teal' : 'orange',
                title: data.success ? 'Sync applied' : 'Sync completed with errors',
                message: data.success
                    ? `${data.results.length} change${data.results.length === 1 ? '' : 's'} applied.`
                    : `${failures.length} of ${data.results.length} changes failed.`,
                icon: data.success ? (
                    <IconCircleCheck size={16} />
                ) : (
                    <IconAlertCircle size={16} />
                ),
            });
        } catch (err) {
            if (!mountedRef.current) return;
            const message = errorMessage(err);
            setError(message);
            notifications.show({ color: 'red', title: 'Sync failed', message });
        } finally {
            if (mountedRef.current) setApplying(false);
        }
    };

    const plan: VeyonSyncPlan | null = preview?.fogConfigured ? preview.plan : null;
    const hasOperations =
        checkedAdditions.size > 0 ||
        checkedRenames.size > 0 ||
        checkedRemovals.size > 0 ||
        (plan?.links.length ?? 0) > 0;
    const applyDisabled =
        !plan || !hasOperations || (checkedRemovals.size > 0 && !understandRemovals);
    const successCount = result ? result.results.filter((item) => item.success).length : 0;
    const failureCount = result ? result.results.length - successCount : 0;

    const toggleAddition = (fogHostId: number, checked: boolean) => {
        setCheckedAdditions((current) => {
            const next = new Set(current);
            if (checked) next.add(fogHostId);
            else next.delete(fogHostId);
            return next;
        });
    };

    const toggleRename = (computerId: string, checked: boolean) => {
        setCheckedRenames((current) => {
            const next = new Set(current);
            if (checked) next.add(computerId);
            else next.delete(computerId);
            return next;
        });
    };

    const toggleRemoval = (computerId: string, checked: boolean) => {
        setCheckedRemovals((current) => {
            const next = new Set(current);
            if (checked) next.add(computerId);
            else next.delete(computerId);
            return next;
        });
        if (!checked) setUnderstandRemovals(false);
    };

    return (
        <Modal opened={opened} onClose={handleClose} title='Sync with FOG' size='lg' centered>
            <Stack gap='md'>
                {loadingPreview ? (
                    <Stack align='center' py={40} gap='sm'>
                        <Loader color='teal' />
                        <Text c='dimmed' size='sm'>
                            Comparing FOG hosts with the Veyon directory...
                        </Text>
                    </Stack>
                ) : null}

                {!loadingPreview && error ? (
                    <Alert color='red' icon={<IconAlertCircle size={16} />} title='Sync failed'>
                        {error}
                    </Alert>
                ) : null}

                {!loadingPreview && preview && !preview.fogConfigured ? (
                    <Alert
                        color='yellow'
                        icon={<IconCloudOff size={16} />}
                        title='FOG is not configured'
                    >
                        Configure the FOG server for your organization in Settings → FOG before
                        synchronizing computers.
                    </Alert>
                ) : null}

                {!loadingPreview && !error && result ? (
                    <Box aria-live='polite'>
                        <Stack gap='sm'>
                            <Alert
                                color={result.success ? 'teal' : 'orange'}
                                icon={
                                    result.success ? (
                                        <IconCircleCheck size={16} />
                                    ) : (
                                        <IconAlertCircle size={16} />
                                    )
                                }
                                title={
                                    result.success ? 'Sync completed' : 'Sync completed with errors'
                                }
                            >
                                {successCount} of {result.results.length} change
                                {result.results.length === 1 ? '' : 's'} applied
                                {failureCount
                                    ? `, ${failureCount} failed. Refresh the preview to retry the remaining items.`
                                    : '.'}
                            </Alert>
                            {result.results.map((item) => (
                                <Group
                                    key={resultKey(item.type, item.id)}
                                    gap='xs'
                                    align='flex-start'
                                    wrap='nowrap'
                                >
                                    {item.success ? (
                                        <IconCircleCheck
                                            size={16}
                                            style={{
                                                color: 'var(--mantine-color-teal-6)',
                                                flexShrink: 0,
                                                marginTop: 2,
                                            }}
                                        />
                                    ) : (
                                        <IconCircleX
                                            size={16}
                                            style={{
                                                color: 'var(--mantine-color-red-6)',
                                                flexShrink: 0,
                                                marginTop: 2,
                                            }}
                                        />
                                    )}
                                    <div>
                                        <Text size='sm' fw={500} tt='capitalize'>
                                            {item.type} · {item.name}
                                        </Text>
                                        {item.error ? (
                                            <Text size='xs' c='red'>
                                                {item.error}
                                            </Text>
                                        ) : null}
                                    </div>
                                </Group>
                            ))}
                        </Stack>
                    </Box>
                ) : null}

                {!loadingPreview && !result && plan ? (
                    <Stack gap='md'>
                        {plan.warnings.length ? (
                            <Alert
                                color='yellow'
                                icon={<IconAlertTriangle size={16} />}
                                title='Warnings'
                            >
                                <Stack gap={4}>
                                    {plan.warnings.map((warning) => (
                                        <Text key={warning} size='sm'>
                                            {warning}
                                        </Text>
                                    ))}
                                </Stack>
                            </Alert>
                        ) : null}

                        <SyncSection
                            color='green'
                            title='Additions'
                            icon={<IconPlus size={16} />}
                            count={plan.additions.length}
                            selectAllLabel={`Select all additions (${plan.additions.length})`}
                            allChecked={
                                plan.additions.length > 0 &&
                                plan.additions.every((item) => checkedAdditions.has(item.fogHostId))
                            }
                            indeterminate={
                                plan.additions.some((item) => checkedAdditions.has(item.fogHostId)) &&
                                !plan.additions.every((item) => checkedAdditions.has(item.fogHostId))
                            }
                            onToggleAll={(checked) =>
                                setCheckedAdditions(
                                    checked
                                        ? new Set(plan.additions.map((item) => item.fogHostId))
                                        : new Set(),
                                )
                            }
                        >
                            {plan.additions.map((item) => (
                                <Checkbox
                                    key={item.fogHostId}
                                    size='xs'
                                    color='green'
                                    aria-label={`Add ${item.name}`}
                                    checked={checkedAdditions.has(item.fogHostId)}
                                    onChange={(event) =>
                                        toggleAddition(item.fogHostId, event.currentTarget.checked)
                                    }
                                    label={
                                        <Box>
                                            <Text size='sm' fw={500}>
                                                {item.name}
                                            </Text>
                                            <Text size='xs' c='dimmed'>
                                                {item.host}
                                                {item.macAddress ? ` · ${item.macAddress}` : ''}
                                            </Text>
                                        </Box>
                                    }
                                />
                            ))}
                        </SyncSection>

                        <SyncSection
                            color='blue'
                            title='Renames'
                            icon={<IconEdit size={16} />}
                            count={plan.renames.length}
                            selectAllLabel={`Select all renames (${plan.renames.length})`}
                            allChecked={
                                plan.renames.length > 0 &&
                                plan.renames.every((item) => checkedRenames.has(item.computerId))
                            }
                            indeterminate={
                                plan.renames.some((item) => checkedRenames.has(item.computerId)) &&
                                !plan.renames.every((item) => checkedRenames.has(item.computerId))
                            }
                            onToggleAll={(checked) =>
                                setCheckedRenames(
                                    checked
                                        ? new Set(plan.renames.map((item) => item.computerId))
                                        : new Set(),
                                )
                            }
                        >
                            {plan.renames.map((item) => (
                                <Checkbox
                                    key={item.computerId}
                                    size='xs'
                                    color='blue'
                                    aria-label={`Rename ${item.currentName}`}
                                    checked={checkedRenames.has(item.computerId)}
                                    onChange={(event) =>
                                        toggleRename(item.computerId, event.currentTarget.checked)
                                    }
                                    label={
                                        <Group gap={6} wrap='nowrap'>
                                            <Text size='sm'>{item.currentName}</Text>
                                            <IconArrowRight size={14} />
                                            <Text size='sm' fw={600} c='blue.6'>
                                                {item.newName}
                                            </Text>
                                            <Text size='xs' c='dimmed'>
                                                {item.host}
                                            </Text>
                                        </Group>
                                    }
                                />
                            ))}
                        </SyncSection>

                        <SyncSection
                            color='red'
                            title='Removals'
                            icon={<IconTrash size={16} />}
                            count={plan.removals.length}
                            danger
                            selectAllLabel={`Select all removals (${plan.removals.length})`}
                            allChecked={
                                plan.removals.length > 0 &&
                                plan.removals.every((item) => checkedRemovals.has(item.computerId))
                            }
                            indeterminate={
                                plan.removals.some((item) => checkedRemovals.has(item.computerId)) &&
                                !plan.removals.every((item) => checkedRemovals.has(item.computerId))
                            }
                            onToggleAll={(checked) => {
                                setCheckedRemovals(
                                    checked
                                        ? new Set(plan.removals.map((item) => item.computerId))
                                        : new Set(),
                                );
                                if (!checked) setUnderstandRemovals(false);
                            }}
                        >
                            {plan.removals.map((item) => (
                                <Checkbox
                                    key={item.computerId}
                                    size='xs'
                                    color='red'
                                    aria-label={`Remove ${item.name}`}
                                    checked={checkedRemovals.has(item.computerId)}
                                    onChange={(event) =>
                                        toggleRemoval(item.computerId, event.currentTarget.checked)
                                    }
                                    label={
                                        <Box>
                                            <Text size='sm' fw={500} c='red.7'>
                                                {item.name}
                                            </Text>
                                            <Text size='xs' c='dimmed'>
                                                {item.host} · FOG host was deleted
                                            </Text>
                                        </Box>
                                    }
                                />
                            ))}
                        </SyncSection>

                        {checkedRemovals.size ? (
                            <Checkbox
                                size='sm'
                                color='red'
                                checked={understandRemovals}
                                onChange={(event) =>
                                    setUnderstandRemovals(event.currentTarget.checked)
                                }
                                label='I understand removed computers lose their Veyon directory entry'
                            />
                        ) : null}

                        <Stack gap={6}>
                            <Group gap='xs' wrap='nowrap' align='flex-start'>
                                <IconInfoCircle
                                    size={15}
                                    style={{
                                        color: 'var(--mantine-color-gray-6)',
                                        flexShrink: 0,
                                        marginTop: 2,
                                    }}
                                />
                                <Text size='sm' c='dimmed'>
                                    {plan.unchanged} computers already match FOG and stay
                                    unchanged.
                                </Text>
                            </Group>
                            {plan.links.length ? (
                                <Group gap='xs' wrap='nowrap' align='flex-start'>
                                    <IconLink
                                        size={15}
                                        style={{
                                            color: 'var(--mantine-color-gray-6)',
                                            flexShrink: 0,
                                            marginTop: 2,
                                        }}
                                    />
                                    <Text size='sm' c='dimmed'>
                                        {plan.links.length} existing computers will be linked to
                                        FOG hosts.
                                    </Text>
                                </Group>
                            ) : null}
                            {plan.unmanaged.length ? (
                                <Group gap='xs' wrap='nowrap' align='flex-start'>
                                    <IconInfoCircle
                                        size={15}
                                        style={{
                                            color: 'var(--mantine-color-gray-6)',
                                            flexShrink: 0,
                                            marginTop: 2,
                                        }}
                                    />
                                    <Text size='sm' c='dimmed'>
                                        {plan.unmanaged.length} unmanaged computers are kept as-is
                                        and never removed: {plan.unmanaged.map((item) => item.name).join(', ')}.
                                    </Text>
                                </Group>
                            ) : null}
                        </Stack>
                    </Stack>
                ) : null}

                <Divider />

                <Group justify='space-between'>
                    <Button
                        variant={result ? 'light' : 'default'}
                        leftSection={<IconRefresh size={16} />}
                        loading={loadingPreview}
                        onClick={() => void loadPreview()}
                    >
                        {result ? 'Refresh preview' : 'Reload'}
                    </Button>
                    <Group gap='xs'>
                        <Button variant='default' onClick={handleClose}>
                            {result?.success ? 'Close' : 'Cancel'}
                        </Button>
                        {!result ? (
                            <Button
                                color='teal'
                                loading={applying}
                                disabled={applyDisabled}
                                onClick={() => void apply()}
                            >
                                Apply sync
                            </Button>
                        ) : null}
                    </Group>
                </Group>
            </Stack>
        </Modal>
    );
}

function SyncSection({
    color,
    title,
    icon,
    count,
    danger = false,
    selectAllLabel,
    allChecked,
    indeterminate,
    onToggleAll,
    children,
}: {
    color: string;
    title: string;
    icon: ReactNode;
    count: number;
    danger?: boolean;
    selectAllLabel: string;
    allChecked: boolean;
    indeterminate: boolean;
    onToggleAll: (checked: boolean) => void;
    children: ReactNode;
}) {
    return (
        <Paper
            withBorder
            radius='md'
            p='sm'
            style={
                danger
                    ? {
                          borderColor: 'var(--mantine-color-red-4)',
                          background: 'var(--mantine-color-red-light)',
                      }
                    : undefined
            }
        >
            <Stack gap='xs'>
                <Group justify='space-between'>
                    <Group gap='xs'>
                        <Box style={{ color: `var(--mantine-color-${color}-6)`, display: 'flex' }}>
                            {icon}
                        </Box>
                        <Title order={5}>{title}</Title>
                        <Badge color={color} variant='light' size='sm'>
                            {count}
                        </Badge>
                    </Group>
                    {count ? (
                        <Checkbox
                            size='xs'
                            aria-label={selectAllLabel}
                            checked={allChecked}
                            indeterminate={indeterminate}
                            onChange={(event) => onToggleAll(event.currentTarget.checked)}
                        />
                    ) : null}
                </Group>
                {count ? (
                    <Stack gap='xs'>{children}</Stack>
                ) : (
                    <Text size='sm' c='dimmed'>
                        Nothing to {title.toLowerCase()} right now.
                    </Text>
                )}
            </Stack>
        </Paper>
    );
}
