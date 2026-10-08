import { ActionIcon, Box } from '@mantine/core';
import { IconAdjustments } from '@tabler/icons-react';
import { type ReactNode, useId, useState } from 'react';

export function useMobileTableFilters() {
    const [opened, setOpened] = useState(false);
    const controlsId = useId();
    return { opened, controlsId, toggle: () => setOpened((current) => !current) };
}

export function MobileFilterToggle({ opened, onToggle, controlsId, label = 'Toggle table filters' }: {
    opened: boolean;
    onToggle: () => void;
    controlsId: string;
    label?: string;
}) {
    return (
        <ActionIcon
            hiddenFrom='sm'
            size='lg'
            variant={opened ? 'filled' : 'default'}
            aria-label={label}
            aria-expanded={opened}
            aria-controls={controlsId}
            onClick={onToggle}
            style={{ flexShrink: 0 }}
        >
            <IconAdjustments size={18} aria-hidden='true' />
        </ActionIcon>
    );
}

export function MobileFilterPanel({ opened, id, children }: {
    opened: boolean;
    id: string;
    children: ReactNode;
}) {
    return (
        <Box id={id} display={{ base: opened ? 'block' : 'none', sm: 'block' }}>
            {children}
        </Box>
    );
}
