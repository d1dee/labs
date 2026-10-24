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
import { randomId } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconCheck,
    IconPencil,
    IconPlus,
    IconTrash,
    IconX,
} from '@tabler/icons-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
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
    ruleId: z.string().regex(
        /^\*[0-9a-f]+$/i,
        'Use an internal hexadecimal .id such as *11, not a row number',
    ),
    dhcpServer: z.string(),
    subnet: z.string(),
    interface: z.string().max(128),
    dnsSuffix: dnsSuffixSchema,
    key: z.string(),
});

const labsFormSchema = z.object({
    defaultDnsSuffix: dnsSuffixSchema,
    labs: z.array(labSchema).superRefine((labs, ctx) => {
        const groups = new Map<string, number[]>();
        labs.forEach((lab, index) => {
            if (!lab.ruleId) return;
            const arr = groups.get(lab.ruleId.toUpperCase()) ?? [];
            arr.push(index);
            groups.set(lab.ruleId.toUpperCase(), arr);
        });
        const interfaces = new Map<string, number[]>();
        labs.forEach((lab, index) => {
            if (!lab.interface) return;
            const indices = interfaces.get(lab.interface) ?? [];
            indices.push(index);
            interfaces.set(lab.interface, indices);
        });
        interfaces.forEach((indices) => {
            if (indices.length < 2) return;
            indices.forEach((index) => {
                ctx.addIssue({
                    code: 'custom',
                    message: 'This interface is already used by another lab',
                    path: [index, 'interface'],
                });
            });
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

interface LabRuleIdInputProps {
    ruleId: string;
    saved: boolean;
    error?: ReactNode;
    onChangeRuleId: (value: string) => void;
}

function LabRuleIdInput({
    ruleId,
    saved,
    error,
    onChangeRuleId,
}: LabRuleIdInputProps) {
    return (
        <TextInput
            label='Rule ID'
            placeholder='*11'
            required
            description={
                saved
                    ? 'Saved canonical rule ID. Edit only to recover the firewall mapping; saving resolves the canonical ID again.'
                    : 'Required initial MikroTik internal .id (for example *11), not a row number. Saving stores the canonical rule ID.'
            }
            error={error}
            value={ruleId}
            onChange={(event) => onChangeRuleId(event.currentTarget.value)}
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
    const savingRef = useRef(false);
    const discoveryRequests = useRef(new Map<string, symbol>());
    const [discoveringKeys, setDiscoveringKeys] = useState<Set<string>>(new Set());
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
        validate: schemaResolver(labsFormSchema.superRefine((values, ctx) => {
            values.labs.forEach((lab, index) => {
                const saved = firewallConfig?.labs?.find((item) => item.id === lab.id);
                if (!lab.interface.trim() && (!saved || saved.interface)) {
                    ctx.addIssue({
                        code: 'custom',
                        message: 'Exact MikroTik interface name is required',
                        path: ['labs', index, 'interface'],
                    });
                }
            });
        })),
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
                            item.id === lab.id && item.ruleId === lab.ruleId &&
                            (item.interface ?? '') === lab.interface,
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
    async function discover(key: string, name: string) {
        if (!enabled || savingRef.current || !name.trim()) return;
        const request = Symbol();
        discoveryRequests.current.set(key, request);
        setDiscoveringKeys((previous) => new Set(previous).add(key));
        // Indices can shift when labs are added or deleted while discovering.
        const currentIndex = () =>
            discoveryRequests.current.get(key) === request && !savingRef.current
                ? form.getValues().labs.findIndex(
                      (lab) => lab.key === key && lab.interface === name,
                  )
                : -1;
        try {
            const { data, error } = await betterFetch<{
                success: boolean;
                data: { subnet: string; dhcpServer: string; pool?: string };
                error?: string;
            }, { error?: string; message?: string }>(`/api/settings/lab-interface?name=${encodeURIComponent(name)}`);
            const index = currentIndex();
            if (index < 0) return;
            if (error || !data?.success || !data.data) {
                throw new Error(error?.error || error?.message || data?.error || 'Failed to discover interface');
            }
            form.setFieldValue(`labs.${index}.subnet`, data.data.subnet);
            form.setFieldValue(`labs.${index}.dhcpServer`, data.data.dhcpServer);
        } catch (error) {
            if (currentIndex() < 0) return;
            notifications.show({
                title: 'Discovery failed',
                message: error instanceof Error ? error.message : 'Failed to discover interface',
                color: 'red',
                icon: <IconX size={16} />,
            });
        } finally {
            if (discoveryRequests.current.get(key) === request) {
                discoveryRequests.current.delete(key);
                setDiscoveringKeys((previous) => {
                    const next = new Set(previous);
                    next.delete(key);
                    return next;
                });
            }
        }
    }

    async function submit(values: LabsFormValues) {
        if (!enabled || savingRef.current) return;
        savingRef.current = true;
        discoveryRequests.current.clear();
        setDiscoveringKeys(new Set());
        setSaving(true);
        try {
            const { data, error } = await betterFetch<{
                success: boolean;
                message: string;
                error?: string;
                data: FirewallConfig;
            }, { error?: string; message?: string }>('/api/settings/labs', {
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

            if (error || !data?.success || !data.data?.labs) {
                notifications.show({
                    title: 'Error',
                    message:
                        error?.error ?? error?.message ?? data?.error ?? data?.message ??
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
            const savedValues = {
                defaultDnsSuffix: data.data.defaultDnsSuffix ?? '',
                labs: data.data.labs.map((lab, index) => ({
                    ...toFormLab(lab),
                    key: values.labs.find((item) => item.id && item.id === lab.id)?.key
                        ?? values.labs[index]?.key ?? randomId(),
                })),
            };
            form.setValues(savedValues);
            form.resetDirty(savedValues);
            setEditingKeys(new Set());
            onSaved();
        } catch (err) {
            notifications.show({
                title: 'Error',
                message: err instanceof Error ? err.message : 'Failed to save labs. Please try again.',
                color: 'red',
                icon: <IconX size={16} />,
            });
            console.error(err);
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    }

    return (
        <Card withBorder p='md'>
            <form onSubmit={form.onSubmit(submit)}>
                <fieldset disabled={!enabled || saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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
                                        <TextInput
                                            label='Lab Interface'
                                            placeholder='vlan10::lab-1'
                                            required={!isExisting || !!firewallConfig?.labs?.find((item) => item.id === lab.id)?.interface}
                                            description='Exact MikroTik name, for example vlan10::lab-1. Subnet/DHCP are fetched when you leave this field. Saving verifies again and adds comment fcd-<interface name> (fcd-vlan10::lab-1).'
                                            {...form.getInputProps(`labs.${index}.interface`)}
                                            aria-busy={discoveringKeys.has(lab.key)}
                                            rightSection={discoveringKeys.has(lab.key) ? <Loader size='xs' /> : undefined}
                                            onBlur={(event) => {
                                                form.getInputProps(`labs.${index}.interface`).onBlur?.(event);
                                                void discover(lab.key, event.currentTarget.value);
                                            }}
                                            onChange={(event) => {
                                                discoveryRequests.current.delete(lab.key);
                                                setDiscoveringKeys((previous) => {
                                                    const next = new Set(previous);
                                                    next.delete(lab.key);
                                                    return next;
                                                });
                                                form.setFieldValue(
                                                    `labs.${index}.interface`,
                                                    event.currentTarget.value,
                                                );
                                                form.setFieldValue(`labs.${index}.subnet`, '');
                                                form.setFieldValue(`labs.${index}.dhcpServer`, '');
                                            }}
                                        />
                                        {isExisting && !lab.interface && (
                                            <Text size='xs' c='dimmed'>Legacy lab: the interface may remain blank until migrated.</Text>
                                        )}
                                        <LabRuleIdInput
                                            ruleId={lab.ruleId}
                                            saved={isExisting}
                                            error={
                                                form.getInputProps(
                                                    `labs.${index}.ruleId`,
                                                ).error
                                            }
                                            onChangeRuleId={(value) =>
                                                form.setFieldValue(
                                                    `labs.${index}.ruleId`,
                                                    value,
                                                )
                                            }
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
                </fieldset>
            </form>
        </Card>
    );
}
