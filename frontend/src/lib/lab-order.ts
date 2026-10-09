import { useSyncExternalStore } from 'react';
import { useSessionContext } from '@/context/SessionContext';

const changeEvent = 'labs:user-preferences-changed';

function subscribe(listener: () => void) {
    window.addEventListener('storage', listener);
    window.addEventListener(changeEvent, listener);
    return () => {
        window.removeEventListener('storage', listener);
        window.removeEventListener(changeEvent, listener);
    };
}

export function parseLabOrder(value: string | null): string[] {
    try {
        const parsed: unknown = JSON.parse(value ?? '[]');
        return Array.isArray(parsed)
            ? [...new Set(parsed.filter((id): id is string => typeof id === 'string'))]
            : [];
    } catch {
        return [];
    }
}

export function orderLabs<T extends { id: string; name: string }>(labs: T[], order: string[]): T[] {
    const positions = new Map(order.map((id, index) => [id, index]));
    return labs.slice().sort((a, b) =>
        (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity) ||
        a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
}

export function useLabOrder() {
    const { user, organizationId } = useSessionContext();
    const key = user && organizationId
        ? `labs:lab-order:v1:${user.id}:${organizationId}`
        : null;
    const serialized = useSyncExternalStore(subscribe, () => {
        try {
            return key ? localStorage.getItem(key) : null;
        } catch {
            return null;
        }
    }, () => null);

    const saveOrder = (order: string[]) => {
        if (!key) return false;
        try {
            localStorage.setItem(key, JSON.stringify([...new Set(order)]));
            window.dispatchEvent(new Event(changeEvent));
            return true;
        } catch {
            return false;
        }
    };

    return { order: parseLabOrder(serialized), saveOrder };
}
