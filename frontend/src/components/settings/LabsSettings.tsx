import { betterFetch } from '@better-fetch/fetch';
import {
    ActionIcon,
    Badge,
    Button,
    Card,
    Flex,
    Group,
    Loader,
    SimpleGrid,
    Stack,
    Text,
    TextInput,
    Title,
} from '@mantine/core';
import { schemaResolver, useForm } from '@mantine/form';
import {
    randomId,
    useDebouncedValue,
    useForceUpdate,
    useMask,
} from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconCheck,
    IconPencil,
    IconPlus,
    IconRefresh,
    IconTrash,
    IconX,
} from '@tabler/icons-react';
import {
    type ReactNode,
    useCallback,
    useEffect,
    useRef,
    useState,
} from 'react';
import z from 'zod';
import { FirewallConfig, Lab } from './FirewallSettings';

const labSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1, 'Lab name is required'),
    ruleId: z.string().min(1, 'Firewall ID is required'),
    dhcpServer: z.string(),
    subnet: z.string(),
    key: z.string(),
});

const labsFormSchema = z.object({
    labs: z.array(labSchema).superRefine((labs, ctx) => {
        const groups = new Map<string, number[]>();
        labs.forEach((lab, index) => {
            if (!lab.ruleId) return;
            const arr = groups.get(lab.ruleId) ?? [];
            arr.push(index);
            groups.set(lab.ruleId, arr);
        });
        groups.forEach((indices) => {
            if (indices.length > 1) {
                indices.forEach((index) => {
                    ctx.addIssue({
                        code: 'custom',
                        message:
                            'This firewall ID is already used by another lab',
                        path: [index, 'ruleId'],
                    });
                });
            }
        });
    }),
});

type LabsFormValues = z.infer<typeof labsFormSchema>;

const toFormLab = (lab: Lab) => ({
    id: lab.id,
    name: lab.name ?? '',
    ruleId: lab.ruleId ?? '',
    dhcpServer: lab.dhcpServer ?? '',
    subnet: lab.subnet ?? '',
    key: randomId(),
});

// Firewall rule IDs always start with a literal "*". The mask below prepends
// it automatically (the first entry is a literal) and the remaining slots are
// editable alphanumeric characters — if the user types the "*" themselves it
// is rejected because it does not match the slot pattern.
const RULE_ID_MASK: Array<string | RegExp> = [
    '*',
    ...Array(20).fill(/[0-9A-Za-z_-]/),
];

interface LabRuleIdInputProps {
    index: number;
    ruleId: string;
    error?: ReactNode;
    fetching: boolean;
    onChangeRuleId: (masked: string) => void;
    onFetch: (index: number, ruleId: string) => void;
}

/**
 * Rule ID field with an auto-prepended "*" mask and auto-fetch behaviour:
 * details are fetched when the (debounced) value settles or when the field
 * loses focus (mouse leave), without re-fetching the same value twice.
 */
function LabRuleIdInput({
    index,
    ruleId,
    error,
    fetching,
    onChangeRuleId,
    onFetch,
}: LabRuleIdInputProps) {
    const lastFetchedRef = useRef('');
    const mountedRef = useRef(false);

    const { ref } = useMask({
        mask: RULE_ID_MASK,
        slotChar: null,
        onChangeRaw: (_raw, masked) => onChangeRuleId(masked),
    });

    const [debounced] = useDebouncedValue(ruleId, 600);

    const triggerFetch = useCallback(
        (value: string) => {
            const hasContent = value.replace(/^\*/, '').trim().length > 0;
            if (!hasContent || lastFetchedRef.current === value) return;
            lastFetchedRef.current = value;
            onFetch(index, value);
        },
        [index, onFetch],
    );

    // Auto-fetch once the user stops editing the field (debounced). The initial
    // mount value is seeded as "already fetched" so configured labs are not
    // re-fetched on load.
    useEffect(() => {
        if (!mountedRef.current) {
            mountedRef.current = true;
            lastFetchedRef.current = debounced;
            return;
        }
        triggerFetch(debounced);
    }, [debounced, triggerFetch]);

    return (
        <TextInput
            label='Rule ID'
            placeholder='*11'
            required
            error={error}
            ref={ref}
            defaultValue={ruleId}
            onBlur={() => triggerFetch(ruleId)}
            rightSection={
                fetching ? (
                    <Loader size={16} />
                ) : ruleId ? (
                    <ActionIcon
                        variant='subtle'
                        onClick={() => triggerFetch(ruleId)}
                    >
                        <IconRefresh
                            size={16}
                            color='var(--mantine-color-blue-6)'
                        />
                    </ActionIcon>
                ) : undefined
            }
        />
    );
}

function LabField({ label, value }: { label: string; value?: string }) {
    return (
        <div>
            <Text size='xs' c='dimmed'>
                {label}
            </Text>
            <Text size='sm' ff='monospace'>
                {value || '—'}
            </Text>
        </div>
    );
}

export function LabsSettings({
    firewallConfig,
}: {
    firewallConfig?: FirewallConfig;
}) {
    const [fetchingLab, setFetchingLab] = useState<Record<number, boolean>>({});
    const [saving, setSaving] = useState(false);
    // Tracks which saved labs are currently expanded into their edit form.
    // Labs without an id are always in edit mode.
    const [editingKeys, setEditingKeys] = useState<Set<string>>(new Set());

    const form = useForm<LabsFormValues>({
        initialValues: {
            labs: firewallConfig?.labs?.map(toFormLab) ?? [],
        },
        validate: schemaResolver(labsFormSchema),
    });

    useEffect(() => {
        form.setValues({
            labs: firewallConfig?.labs?.map(toFormLab) ?? [],
        });
        setEditingKeys(new Set());
    }, [firewallConfig]);

    const fetchLabDetails = useCallback(
        async (index: number, ruleId: string): Promise<void> => {
            if (!ruleId) return;

            setFetchingLab((prev) => ({ ...prev, [index]: true }));

            try {
                const { data, error } = await betterFetch<{
                    success: boolean;
                    data: {
                        subnet?: string;
                        dhcpServer?: string;
                        ruleId?: string;
                    };
                    error?: string;
                }>(`/api/labs/by-rule/${ruleId}`);

                if (error) {
                    throw new Error(
                        error.message ?? 'Failed to fetch lab details',
                    );
                }

                if (data?.success && data.data) {
                    form.setFieldValue(
                        `labs.${index}.subnet`,
                        data.data.subnet || '',
                    );
                    form.setFieldValue(
                        `labs.${index}.dhcpServer`,
                        data.data.dhcpServer || '',
                    );
                    form.setFieldValue(
                        `labs.${index}.ruleId`,
                        data.data.ruleId || ruleId,
                    );

                    notifications.show({
                        title: 'Success',
                        message: 'Lab details fetched successfully!',
                        color: 'green',
                        icon: <IconCheck size={16} />,
                    });
                } else {
                    throw new Error(
                        data?.error || 'Failed to fetch lab details',
                    );
                }
            } catch (err) {
                console.error(err);
                notifications.show({
                    title: 'Error',
                    message:
                        'Failed to fetch lab details. Please check the rule ID.',
                    color: 'red',
                    icon: <IconX size={16} />,
                });
            } finally {
                setFetchingLab((prev) => ({ ...prev, [index]: false }));
            }
        },
        [],
    );

    const forceUpdate = useForceUpdate();
    async function submit(values: LabsFormValues) {
        setSaving(true);
        try {
            const { error } = await betterFetch<{
                success: boolean;
                message: string;
                data: FirewallConfig;
            }>('/api/settings/labs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: firewallConfig?.id,
                    labs: values.labs.map((lab) => ({
                        firewallId: lab.ruleId,
                        name: lab.name,
                    })),
                }),
            });

            if (error) {
                notifications.show({
                    title: 'Error',
                    message:
                        error.message ??
                        'Failed to save labs. Please try again.',
                    color: 'red',
                    icon: <IconX size={16} />,
                });
                return;
            }

            notifications.show({
                title: 'Success',
                message: 'Labs saved successfully!',
                color: 'green',
                icon: <IconCheck size={16} />,
            });
            forceUpdate();
        } catch (err) {
            notifications.show({
                title: 'Error',
                message: 'Failed to save labs. Please try again.',
                color: 'red',
                icon: <IconX size={16} />,
            });
            console.error(err);
        } finally {
            setSaving(false);
        }
    }

    return (
        <Card withBorder p='md'>
            <form onSubmit={form.onSubmit(submit)}>
                <Flex justify='space-between' align='center' mb='md'>
                    <Title order={5}>Labs Configuration</Title>
                    <Button
                        type='button'
                        variant='light'
                        leftSection={<IconPlus size={14} />}
                        onClick={() =>
                            form.insertListItem(
                                'labs',
                                {
                                    id: undefined,
                                    name: '',
                                    ruleId: '',
                                    dhcpServer: '',
                                    subnet: '',
                                    key: randomId(),
                                },
                                0,
                            )
                        }
                    >
                        Add Lab
                    </Button>
                </Flex>
                <Stack>
                    {form.values.labs.length === 0 && (
                        <Text c='dimmed' ta='center' size='sm'>
                            No labs configured. Click &quot;Add Lab&quot; to
                            create one.
                        </Text>
                    )}
                    {form.values.labs.map((lab, index) => {
                        const isExisting = !!lab.id;
                        const isEditing =
                            !isExisting || editingKeys.has(lab.key);

                        if (!isEditing) {
                            return (
                                <Card key={lab.key} withBorder p='md'>
                                    <Group
                                        justify='space-between'
                                        align='flex-start'
                                    >
                                        <Stack gap={2}>
                                            <Text fw={600} size='lg'>
                                                {lab.name || 'Unnamed Lab'}
                                            </Text>
                                            <Badge
                                                variant='light'
                                                size='sm'
                                                color='gray'
                                            >
                                                {lab.ruleId || 'No rule'}
                                            </Badge>
                                        </Stack>
                                        <Group gap={4}>
                                            <ActionIcon
                                                variant='subtle'
                                                title='Edit'
                                                onClick={() =>
                                                    setEditingKeys((prev) =>
                                                        new Set(prev).add(
                                                            lab.key,
                                                        ),
                                                    )
                                                }
                                            >
                                                <IconPencil
                                                    size={16}
                                                    color='var(--mantine-color-blue-6)'
                                                />
                                            </ActionIcon>
                                            <ActionIcon
                                                color='red'
                                                variant='subtle'
                                                title='Delete'
                                                onClick={() =>
                                                    form.removeListItem(
                                                        'labs',
                                                        index,
                                                    )
                                                }
                                            >
                                                <IconTrash size={16} />
                                            </ActionIcon>
                                        </Group>
                                    </Group>
                                    <SimpleGrid
                                        cols={{ base: 1, sm: 2 }}
                                        mt='md'
                                    >
                                        <LabField
                                            label='Subnet / IP range'
                                            value={lab.subnet}
                                        />
                                        <LabField
                                            label='DHCP Server'
                                            value={lab.dhcpServer}
                                        />
                                    </SimpleGrid>
                                </Card>
                            );
                        }

                        return (
                            <Card
                                key={lab.key}
                                withBorder
                                style={{ position: 'relative' }}
                            >
                                <Stack>
                                    <TextInput
                                        label='Lab Name'
                                        placeholder='Lab name'
                                        required
                                        {...form.getInputProps(
                                            `labs.${index}.name`,
                                        )}
                                    />
                                    <LabRuleIdInput
                                        index={index}
                                        ruleId={lab.ruleId}
                                        fetching={!!fetchingLab[index]}
                                        error={
                                            form.getInputProps(
                                                `labs.${index}.ruleId`,
                                            ).error
                                        }
                                        onChangeRuleId={(masked) =>
                                            form.setFieldValue(
                                                `labs.${index}.ruleId`,
                                                masked,
                                            )
                                        }
                                        onFetch={fetchLabDetails}
                                    />
                                    <TextInput
                                        label='DHCP Server'
                                        readOnly
                                        placeholder='Fetched from MikroTik'
                                        {...form.getInputProps(
                                            `labs.${index}.dhcpServer`,
                                        )}
                                    />
                                    <TextInput
                                        label='Subnet / IP range'
                                        readOnly
                                        placeholder='Fetched from MikroTik'
                                        {...form.getInputProps(
                                            `labs.${index}.subnet`,
                                        )}
                                    />
                                    <Flex justify='flex-end' gap='md'>
                                        {isExisting ? (
                                            <Button
                                                title='Done'
                                                onClick={() =>
                                                    setEditingKeys((prev) => {
                                                        const next = new Set(
                                                            prev,
                                                        );
                                                        next.delete(lab.key);
                                                        return next;
                                                    })
                                                }
                                                leftSection={
                                                    <IconCheck size={16} />
                                                }
                                            >
                                                Save
                                            </Button>
                                        ) : (
                                            <Button
                                                leftSection={
                                                    <IconCheck size={16} />
                                                }
                                                type='submit'
                                                loading={saving}
                                            >
                                                Save
                                            </Button>
                                        )}
                                        <Button
                                            color='red'
                                            title='Delete'
                                            onClick={() =>
                                                form.removeListItem(
                                                    'labs',
                                                    index,
                                                )
                                            }
                                            leftSection={
                                                <IconTrash size={16} />
                                            }
                                        >
                                            Delete
                                        </Button>
                                    </Flex>
                                </Stack>
                            </Card>
                        );
                    })}
                </Stack>
                <Group justify='flex-end' mt='md'>
                    <Button type='submit' loading={saving}>
                        Save Labs
                    </Button>
                </Group>
            </form>
        </Card>
    );
}
