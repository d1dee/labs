import { useLabDrag } from '@/lib/use-lab-drag';
import { Card } from '@mantine/core';
import { type ReactNode } from 'react';

export function DraggableLabCard({ id, name, disabled, onMove, children }: {
    id?: string;
    name: string;
    disabled: boolean;
    onMove: (targetId: string) => void;
    children: (dragHandle: ReactNode) => ReactNode;
}) {
    const { cardRef, style, dragHandle } = useLabDrag({ id, name, disabled, onMove });
    return (
        <Card ref={cardRef} data-lab-order-id={id} withBorder p='md' style={style}>
            {children(dragHandle)}
        </Card>
    );
}
