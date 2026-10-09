import { type Lab } from '@/api/firewall';
import { useApiStream } from '@/api/useApiStream';
import { useSessionContext } from '@/context/SessionContext';
import { orderLabs, useLabOrder } from '@/lib/lab-order';
import { Alert, Button, Group, Stack, Text, Title } from '@mantine/core';
import { useState } from 'react';

export function UserSettings({ enabled }: { enabled: boolean }) {
    const { organizationId } = useSessionContext();
    const { order, saveOrder } = useLabOrder();
    const [labs, setLabs] = useState<Lab[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    useApiStream<{ labs: Lab[] }>(enabled && organizationId ? '/api/labs' : null, (data) => {
        setLabs(data.labs);
        setError(null);
        setLoading(false);
    }, (err) => {
        setError(err.message);
        setLoading(false);
    });
    const sortedLabs = orderLabs(labs, order);
    const save = (ids: string[]) => {
        setError(saveOrder(ids) ? null : 'Unable to save your preferences. Browser storage may be disabled.');
    };
    const move = (index: number, direction: number) => {
        const ids = sortedLabs.map((lab) => lab.id);
        const target = index + direction;
        if (target < 0 || target >= ids.length) return;
        [ids[index], ids[target]] = [ids[target], ids[index]];
        save(ids);
    };

    return (
        <Stack>
            <Title order={4}>Lab display order</Title>
            <Text size='sm' c='dimmed'>Changes are saved automatically for your account in this browser, separately for each organization. Other teachers are not affected.</Text>
            {error && <Alert color='red'>{error}</Alert>}
            {!organizationId ? <Text>Join an organization to arrange its labs.</Text> : loading ? <Text>Loading labs...</Text> : sortedLabs.length === 0 ? <Text>No labs configured.</Text> : (
                <Stack gap='xs'>
                    {sortedLabs.map((lab, index) => (
                        <Group key={lab.id} justify='space-between' wrap='nowrap'>
                            <Text style={{ overflowWrap: 'anywhere' }}>{lab.name}</Text>
                            <Group gap='xs' wrap='nowrap'>
                                <Button size='xs' variant='light' aria-label={`Move ${lab.name} up`} disabled={index === 0} onClick={() => move(index, -1)}>Up</Button>
                                <Button size='xs' variant='light' aria-label={`Move ${lab.name} down`} disabled={index === sortedLabs.length - 1} onClick={() => move(index, 1)}>Down</Button>
                            </Group>
                        </Group>
                    ))}
                    <Button variant='subtle' size='sm' onClick={() => save([])} disabled={!order.length}>Reset to alphabetical order</Button>
                </Stack>
            )}
        </Stack>
    );
}
