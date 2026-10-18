import { useApiStream } from '@/api/useApiStream';
import { orderLabs, useLabOrder } from '@/lib/lab-order';
import { betterFetch } from '@better-fetch/fetch';
import {
    ActionIcon,
    Alert,
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
import { randomId, useDebouncedValue, useMask } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconCheck,
    IconPencil,
    IconPlus,
    IconTrash,
    IconX,
} from '@tabler/icons-react';
import { type ReactNode, useEffect, useState } from 'react';
import z from 'zod';
import { DraggableLabCard } from './DraggableLabCard';
import { FirewallConfig, Lab } from './FirewallSettings';

const dnsSuffixSchema = z.string().refine((value) => {
    if (/^\.+$/.test(value.trim())) return false;
    const suffix = value.trim().replace(/^\.|\.$/g, '');
    return (
        suffix.length <= 253 &&
        (suffix === '' ||
            suffix
                .split('.')
                .every((label) =>
                    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
                ))
    );
}, 'Use DNS labels of 1-63 letters, digits or hyphens, up to 253 characters');

const labSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1, 'Lab name is required'),
    ruleId: z.string().min(1, 'Firewall ID is required'),
    dhcpServer: z.string(),
    subnet: z.string(),
    interface: z.string().trim().max(128),
    dnsSuffix: dnsSuffixSchema,
    key: z.string(),
});

const labsFormSchema = z.object({
    defaultDnsSuffix: dnsSuffixSchema,
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
    interface: lab.interface ?? '',
    dnsSuffix: lab.dnsSuffix ?? '',
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
    enabled: boolean;
    onChangeRuleId: (masked: string) => void;
    onDetails: (
        index: number,
        details: { subnet?: string; dhcpServer?: string },
    ) => void;
}

/**
 * Subscribe to the settled rule ID; snapshots update derived metadata only.
 */
function LabRuleIdInput({
    index,
    ruleId,
    error,
    enabled,
    onChangeRuleId,
    onDetails,
}: LabRuleIdInputProps) {
    const { ref } = useMask({
        mask: RULE_ID_MASK,
        slotChar: null,
        onChangeRaw: (_raw, masked) => onChangeRuleId(masked),
    });

    const [debounced] = useDebouncedValue(ruleId, 600);

    const [loadedRule, setLoadedRule] = useState('');
    const path =
        enabled && debounced === ruleId && ruleId.replace(/^\*/, '').trim()
            ? `/api/labs/by-rule/${encodeURIComponent(ruleId)}`
            : null;
    useApiStream<{
        success: boolean;
        data: { subnet?: string; dhcpServer?: string };
        error?: string;
    }>(
        path,
        (snapshot) => {
            setLoadedRule(ruleId);
            if (snapshot.success && snapshot.data) {
                onDetails(index, snapshot.data);
            } else {
                notifications.show({
                    title: 'Error',
                    message: snapshot.error ?? 'Failed to fetch lab details',
                    color: 'red',
                    icon: <IconX size={16} />,
                });
            }
        },
        (error) => {
            setLoadedRule(ruleId);
            notifications.show({
                title: 'Error',
                message: error.message,
                color: 'red',
                icon: <IconX size={16} />,
            });
        },
    );

    return (
        <TextInput
            label='Rule ID'
            placeholder='*11'
            required
            error={error}
            ref={ref}
            defaultValue={ruleId}
            rightSection={
                path && loadedRule !== ruleId ? <Loader size={16} /> : undefined
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
    enabled = true,
    onSaved,
}: {
    firewallConfig?: FirewallConfig;
    enabled?: boolean;
    onSaved: () => void;
}) {
    const [saving, setSaving] = useState(false);
    const { order, saveOrder } = useLabOrder();
    const [orderError, setOrderError] = useState<string | null>(null);
    // Tracks which saved labs are currently expanded into their edit form.
    // Labs without an id are always in edit mode.
    const [editingKeys, setEditingKeys] = useState<Set<string>>(new Set());

    const form = useForm<LabsFormValues>({
        initialValues: {
            defaultDnsSuffix: firewallConfig?.defaultDnsSuffix ?? '',
            labs: firewallConfig?.labs?.map(toFormLab) ?? [],
        },
        validate: schemaResolver(labsFormSchema),
    });

    // Sort only the presentation so input paths and unsaved edits stay intact.
    const displayedLabs = orderLabs(
        form.values.labs.map((lab, index) => ({
            ...lab,
            id: lab.id ?? lab.key,
            index,
        })),
        order,
    );
    const saveDisplayOrder = (ids: string[]) => {
        setOrderError(
            saveOrder(ids)
                ? null
                : 'Unable to save your preferences. Browser storage may be disabled.',
        );
    };
    const moveLab = (id: string, targetId: string) => {
        const ids = displayedLabs
            .filter((lab) => form.values.labs[lab.index].id)
            .map((lab) => lab.id);
        const from = ids.indexOf(id);
        const to = ids.indexOf(targetId);
        if (from < 0 || to < 0 || from === to) return;
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        saveDisplayOrder(ids);
    };

    useEffect(() => {
        if (form.isDirty() || editingKeys.size) {
            // Keep editable drafts and stable keys, but reconcile read-only metadata.
            form.setValues({
                labs: form.getValues().labs.map((lab) => {
                    const saved = firewallConfig?.labs?.find(
                        (item) =>
                            item.id === lab.id && item.ruleId === lab.ruleId,
                    );
                    return saved
                        ? {
                              ...lab,
                              subnet: saved.subnet ?? '',
                              dhcpServer: saved.dhcpServer ?? '',
                          }
                        : lab;
                }),
            });
            return;
        }
        const values = {
            defaultDnsSuffix: firewallConfig?.defaultDnsSuffix ?? '',
            labs: firewallConfig?.labs?.map(toFormLab) ?? [],
        };
        form.setValues(values);
        form.resetDirty(values);
    }, [firewallConfig]);
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
                    defaultDnsSuffix: values.defaultDnsSuffix,
                    labs: values.labs.map((lab) => ({
                        id: lab.id,
                        firewallId: lab.ruleId,
                        name: lab.name,
                        subnet: lab.subnet,
                        dhcpServer: lab.dhcpServer,
                        interface: lab.interface,
                        dnsSuffix: lab.dnsSuffix,
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
            form.resetDirty(values);
            setEditingKeys(new Set());
            onSaved();
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
                                    interface: '',
                                    dnsSuffix: '',
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
                    <TextInput
                        label='Default DNS suffix'
                        placeholder='school.example'
                        description='Used for hostname only when a lab is identified. Display names stay unchanged. Leave blank to disable.'
                        {...form.getInputProps('defaultDnsSuffix')}
                    />
                    <Text size='xs' c='dimmed'>
                        Drag lab handles to change your display order. Order is
                        saved automatically for your account in this browser,
                        separately from others.
                    </Text>
                    {orderError && <Alert color='red'>{orderError}</Alert>}

                    {form.values.labs.length === 0 && (
                        <Text c='dimmed' ta='center' size='sm'>
                            No labs configured. Click &quot;Add Lab&quot; to
                            create one.
                        </Text>
                    )}
                    {displayedLabs.map(({ index }) => {
                        const lab = form.values.labs[index];
                        const isExisting = !!lab.id;
                        const isEditing =
                            !isExisting || editingKeys.has(lab.key);

                        if (!isEditing) {
                            return (
                                <DraggableLabCard
                                    key={lab.key}
                                    id={lab.id}
                                    name={lab.name}
                                    disabled={!enabled || saving}
                                    onMove={(targetId) =>
                                        moveLab(lab.id!, targetId)
                                    }
                                >
                                    {(dragHandle) => (
                                        <>
                                            <Group
                                                justify='space-between'
                                                align='flex-start'
                                            >
                                                <Stack gap={2}>
                                                    <Text fw={600} size='lg'>
                                                        {lab.name ||
                                                            'Unnamed Lab'}
                                                    </Text>
                                                    <Badge
                                                        variant='light'
                                                        size='sm'
                                                        color='gray'
                                                    >
                                                        {lab.ruleId ||
                                                            'No rule'}
                                                    </Badge>
                                                </Stack>
                                                <Group gap={4} wrap='nowrap'>
                                                    {dragHandle}
                                                    <ActionIcon
                                                        variant='subtle'
                                                        title='Edit'
                                                        onClick={() =>
                                                            setEditingKeys(
                                                                (prev) =>
                                                                    new Set(
                                                                        prev,
                                                                    ).add(
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
                                                    label='Interface'
                                                    value={lab.interface}
                                                />
                                                <LabField
                                                    label='DNS suffix'
                                                    value={
                                                        lab.dnsSuffix ||
                                                        `Inherit default${form.values.defaultDnsSuffix ? ` (${form.values.defaultDnsSuffix})` : ''}`
                                                    }
                                                />
                                                <LabField
                                                    label='Subnet / IP range'
                                                    value={lab.subnet}
                                                />
                                                <LabField
                                                    label='DHCP Server'
                                                    value={lab.dhcpServer}
                                                />
                                            </SimpleGrid>
                                        </>
                                    )}
                                </DraggableLabCard>
                            );
                        }

                        return (
                            <DraggableLabCard
                                key={lab.key}
                                id={lab.id}
                                name={lab.name}
                                disabled={!lab.id || !enabled || saving}
                                onMove={(targetId) =>
                                    moveLab(lab.id!, targetId)
                                }
                            >
                                {(dragHandle) => (
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
                                            enabled={enabled}
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
                                            onDetails={(
                                                currentIndex,
                                                details,
                                            ) => {
                                                form.setValues({
                                                    labs: form
                                                        .getValues()
                                                        .labs.map(
                                                            (
                                                                item,
                                                                itemIndex,
                                                            ) =>
                                                                itemIndex ===
                                                                currentIndex
                                                                    ? {
                                                                          ...item,
                                                                          subnet:
                                                                              details.subnet ??
                                                                              '',
                                                                          dhcpServer:
                                                                              details.dhcpServer ??
                                                                              '',
                                                                      }
                                                                    : item,
                                                        ),
                                                });
                                            }}
                                        />
                                        <TextInput
                                            label='Lab Interface'
                                            placeholder='vlan10 or bridge-lab'
                                            description='Exact MikroTik interface name. Usage includes received and transmitted bytes since its counters were reset.'
                                            {...form.getInputProps(
                                                `labs.${index}.interface`,
                                            )}
                                        />
                                        <TextInput
                                            label='Lab DNS suffix'
                                            placeholder='Inherit default'
                                            description='Overrides the default DNS suffix for this lab. Leave blank to inherit. Fully qualified hostnames and IP addresses are unchanged.'
                                            {...form.getInputProps(
                                                `labs.${index}.dnsSuffix`,
                                            )}
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
                                            {dragHandle}
                                            {isExisting ? (
                                                <Button
                                                    title='Done'
                                                    type='submit'
                                                    loading={saving}
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
                                )}
                            </DraggableLabCard>
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
