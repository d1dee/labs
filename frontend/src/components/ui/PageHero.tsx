import { Group, Paper, SimpleGrid, Text, ThemeIcon, Title } from '@mantine/core';
import type { ReactNode } from 'react';
import { MetricTile } from './MetricTile';

export interface HeroMetric {
    label: string;
    value: ReactNode;
    accent?: boolean;
    color?: string;
}

export interface PageHeroProps {
    eyebrow?: string;
    title: ReactNode;
    description?: ReactNode;
    icon?: ReactNode;
    iconColor?: string;
    actions?: ReactNode;
    metrics?: HeroMetric[];
}

/**
 * Dark-gradient hero banner matching the Veyon operations desk: an iconized
 * title block with an uppercase teal eyebrow, an actions group on the right,
 * and an optional row of left-bordered metric tiles. Reused across every tab
 * so the whole site shares one header structure.
 */
export function PageHero({
    eyebrow,
    title,
    description,
    icon,
    iconColor = 'teal',
    actions,
    metrics,
}: PageHeroProps) {
    return (
        <Paper
            p={{ base: 'md', md: 'xl' }}
            radius='lg'
            style={{
                color: 'white',
                background:
                    'linear-gradient(125deg, var(--mantine-color-dark-8) 0%, var(--mantine-color-teal-9) 145%)',
                overflow: 'hidden',
            }}
        >
            <Group justify='space-between' align='flex-start'>
                <Group align='flex-start'>
                    {icon ? (
                        <ThemeIcon size={46} radius='md' color={iconColor} variant='light'>
                            {icon}
                        </ThemeIcon>
                    ) : null}
                    <div>
                        {eyebrow ? (
                            <Text tt='uppercase' size='xs' fw={700} c='teal.2' lts={1.4}>
                                {eyebrow}
                            </Text>
                        ) : null}
                        <Title order={2} c='white'>
                            {title}
                        </Title>
                        {description ? (
                            <Text c='gray.4' size='sm' maw={620}>
                                {description}
                            </Text>
                        ) : null}
                    </div>
                </Group>
                {actions ? <Group gap='xs'>{actions}</Group> : null}
            </Group>
            {metrics?.length ? (
                <SimpleGrid cols={{ base: 2, sm: 4 }} mt='xl'>
                    {metrics.map((metric) => (
                        <MetricTile
                            key={metric.label}
                            label={metric.label}
                            value={metric.value}
                            accent={metric.accent}
                            color={metric.color}
                        />
                    ))}
                </SimpleGrid>
            ) : null}
        </Paper>
    );
}
