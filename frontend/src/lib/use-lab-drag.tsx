import { ActionIcon } from '@mantine/core';
import { useDrag } from '@mantine/hooks';
import { IconGripVertical } from '@tabler/icons-react';
import { type CSSProperties, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';

const settlingEase = 'cubic-bezier(0.22, 1, 0.36, 1)';
const motionReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// FLIP from the visible preview positions to the final React-rendered layout.
function settleCards(before: Map<HTMLElement, DOMRect>, animations: Set<Animation>) {
    if (motionReduced()) return;
    before.forEach((rect, node) => {
        if (!node.isConnected || !node.animate) return;
        const after = node.getBoundingClientRect();
        const x = rect.left - after.left;
        const y = rect.top - after.top;
        if (Math.abs(x) < 1 && Math.abs(y) < 1) return;
        const animation = node.animate([
            { transform: `translate3d(${x}px, ${y}px, 0)` },
            { transform: 'translate3d(0, 0, 0)' },
        ], { duration: 320, easing: settlingEase });
        animations.add(animation);
        animation.finished.then(() => animations.delete(animation), () => animations.delete(animation));
    });
}

export function useLabDrag({ id, name, disabled = false, grid = false, onMove }: {
    id?: string;
    name: string;
    disabled?: boolean;
    grid?: boolean;
    onMove: (targetId: string) => void;
}) {
    const cardRef = useRef<HTMLDivElement>(null);
    const positions = useRef<{ id: string; node: HTMLElement; rect: DOMRect; cssText: string }[]>([]);
    const parentRect = useRef<DOMRect | null>(null);
    const positionedParent = useRef<{ node: HTMLElement; position: string } | null>(null);
    const placeholder = useRef<HTMLDivElement | null>(null);
    const animations = useRef(new Set<Animation>());
    const getCards = () => Array.from(cardRef.current?.parentElement?.children ?? [])
        .filter((node): node is HTMLElement => node instanceof HTMLElement && !!node.dataset.labOrderId);
    const clearPreview = () => {
        placeholder.current?.remove();
        placeholder.current = null;
        if (positionedParent.current) {
            positionedParent.current.node.style.position = positionedParent.current.position;
            positionedParent.current = null;
        }
        positions.current.forEach(({ node, cssText }) => { node.style.cssText = cssText; });
        positions.current = [];
    };
    useEffect(() => () => {
        clearPreview();
        animations.current.forEach((animation) => animation.cancel());
        animations.current.clear();
    }, []);

    const { ref, active } = useDrag<HTMLButtonElement>((state) => {
        if (state.first) {
            animations.current.forEach((animation) => animation.finish());
            animations.current.clear();
            positions.current = getCards().map((node) => {
                const position = { id: node.dataset.labOrderId!, node, rect: node.getBoundingClientRect(), cssText: node.style.cssText };
                node.style.transition = motionReduced() ? 'none' : `transform 240ms ${settlingEase}`;
                node.style.willChange = 'transform';
                return position;
            });
            const parent = cardRef.current?.parentElement;
            parentRect.current = parent?.getBoundingClientRect() ?? null;
            if (parent) {
                positionedParent.current = { node: parent, position: parent.style.position };
                parent.style.position = 'relative';
                const slot = document.createElement('div');
                slot.dataset.labDragPlaceholder = '';
                Object.assign(slot.style, {
                    position: 'absolute', pointerEvents: 'none', zIndex: '0',
                    border: '2px dashed var(--mantine-color-teal-5)',
                    background: 'var(--mantine-color-teal-light)',
                    borderRadius: 'var(--mantine-radius-md)',
                    transition: motionReduced() ? 'none' : `left 240ms ${settlingEase}, top 240ms ${settlingEase}`,
                });
                parent.appendChild(slot);
                placeholder.current = slot;
            }
        }
        const cards = positions.current;
        const from = cards.findIndex((item) => item.id === id);
        if (from < 0) return;
        const start = cards[from];
        const currentParent = cardRef.current?.parentElement?.getBoundingClientRect();
        const scrollX = currentParent && parentRect.current ? currentParent.left - parentRect.current.left : 0;
        const scrollY = currentParent && parentRect.current ? currentParent.top - parentRect.current.top : 0;
        const movement = [state.movement[0] - scrollX, state.movement[1] - scrollY];
        const x = start.rect.left + start.rect.width / 2 + movement[0];
        const y = start.rect.top + start.rect.height / 2 + movement[1];
        const distance = (item: typeof start) => Math.hypot(grid ? item.rect.left + item.rect.width / 2 - x : 0, item.rect.top + item.rect.height / 2 - y);
        const target = cards.reduce((closest, item) => distance(item) < distance(closest) ? item : closest, start);
        const to = cards.indexOf(target);

        if (state.last) {
            const before = new Map(cards.map(({ node }) => [node, node.getBoundingClientRect()]));
            clearPreview();
            if (!state.canceled && !state.tap && target.id !== id) flushSync(() => onMove(target.id));
            settleCards(before, animations.current);
        } else {
            const preview = cards.slice();
            preview.splice(to, 0, preview.splice(from, 1)[0]);
            preview.forEach((item, index) => {
                const dragged = item.id === id;
                const slot = cards[index].rect;
                const dx = dragged ? movement[0] : slot.left - item.rect.left;
                const dy = dragged ? movement[1] : slot.top - item.rect.top;
                Object.assign(item.node.style, {
                    transition: dragged ? 'none' : motionReduced() ? 'none' : `transform 240ms ${settlingEase}`,
                    transform: `translate3d(${dx}px, ${dy}px, 0)`,
                    zIndex: dragged ? '2' : '1',
                    filter: dragged ? 'drop-shadow(0 12px 16px rgb(0 0 0 / 0.18))' : '',
                });
            });
            if (placeholder.current && parentRect.current) {
                Object.assign(placeholder.current.style, {
                    left: `${target.rect.left - parentRect.current.left + 4}px`,
                    top: `${target.rect.top - parentRect.current.top + 4}px`,
                    width: `${target.rect.width - 8}px`, height: `${target.rect.height - 8}px`,
                });
            }
        }
    }, { axis: grid ? undefined : 'y', threshold: 5, filterTaps: true, enabled: !disabled });

    const style: CSSProperties = {
        position: 'relative',
    };
    const dragHandle = (
        <ActionIcon
            ref={ref}
            type='button'
            variant='subtle'
            color='gray'
            disabled={disabled}
            aria-label={`Reorder ${name || 'Unnamed Lab'}`}
            title={grid ? 'Drag to reorder, or use arrow keys' : 'Drag to reorder, or use Up and Down arrow keys'}
            style={{ cursor: active ? 'grabbing' : 'grab', touchAction: 'none' }}
            onKeyDown={(event) => {
                const previous = event.key === 'ArrowUp' || (grid && event.key === 'ArrowLeft');
                const next = event.key === 'ArrowDown' || (grid && event.key === 'ArrowRight');
                if (!previous && !next) return;
                event.preventDefault();
                const ids = getCards().map((node) => node.dataset.labOrderId!);
                const target = ids[ids.indexOf(id!) + (previous ? -1 : 1)];
                if (target) {
                    const before = new Map(getCards().map((node) => [node, node.getBoundingClientRect()]));
                    flushSync(() => onMove(target));
                    settleCards(before, animations.current);
                }
            }}
        >
            <IconGripVertical size={18} />
        </ActionIcon>
    );
    return { cardRef, style, dragHandle };
}
