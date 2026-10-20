import { useEffect, useState } from 'react';

export interface AppLocation {
    pathname: string;
    search: string;
}

/** Path of the standalone email verification screen. */
export const VERIFY_EMAIL_PATH = '/verify-email';

const listeners = new Set<() => void>();

const currentLocation = (): AppLocation => ({
    pathname: window.location.pathname,
    search: window.location.search,
});

/**
 * Client side navigation for the single page dashboard. The server serves the
 * application shell for every non API path, so pushing a path is enough to
 * render another screen without a full reload.
 */
export const navigate = (to: string, options: { replace?: boolean } = {}): void => {
    if (options.replace) window.history.replaceState(null, '', to);
    else window.history.pushState(null, '', to);
    listeners.forEach((listener) => listener());
};

export const useLocation = (): AppLocation => {
    const [location, setLocation] = useState<AppLocation>(currentLocation);

    useEffect(() => {
        const update = (): void => setLocation(currentLocation());
        listeners.add(update);
        window.addEventListener('popstate', update);
        return () => {
            listeners.delete(update);
            window.removeEventListener('popstate', update);
        };
    }, []);

    return location;
};
