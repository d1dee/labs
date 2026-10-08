import { useSession } from '@/lib/auth-client';
import { refreshApiStreams, resetApiStreams, useApiStream } from '@/api/useApiStream';
import { modals } from '@mantine/modals';
import {
    createContext,
    useCallback,
    useContext,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';

export interface OrganizationMember {
    id: string;
    name: string;
    email: string;
    username: string | null;
}

export interface Organization {
    id: string;
    name: string;
    email: string;
    phoneNumber: string;
    joinKey: string;
    members?: OrganizationMember[];
}

type SessionData = NonNullable<ReturnType<typeof useSession>['data']>;
type User = SessionData['user'] & { organizationId?: string | null };

interface SessionContextValue {
    session: SessionData | null;
    user: User | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    organization: Organization | null;
    organizationId: string | null;
    refreshOrganization: () => Promise<void>;
    setOrganization: (org: Organization | null) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
    const { data: session, isPending } = useSession();
    const user = session?.user as User | undefined;
    const [organization, setOrganizationState] = useState<Organization | null>(null);
    const organizationScope = useRef<string | null>(null);
    const setOrganization = useCallback((next: Organization | null) => {
        if (organizationScope.current !== (next?.id ?? null)) {
            organizationScope.current = next?.id ?? null;
            modals.closeAll();
            resetApiStreams();
        }
        setOrganizationState(next);
    }, []);

    const refreshOrganization = useCallback(async () => refreshApiStreams(), []);

    // Clear protected caches before new-identity children subscribe in passive
    // effects, not after they could receive the previous user's snapshot.
    useLayoutEffect(() => {
        modals.closeAll();
        setOrganization(null);
        resetApiStreams();
    }, [user?.id, user?.organizationId, setOrganization]);

    useApiStream<{ organizations: Organization[] }>(
        session ? '/api/organizations' : null,
        (data) => setOrganization(data.organizations[0] ?? null),
        (error) => {
            // Keep the last good organization on transport errors, but never
            // retain privileged data after an authorization failure.
            if (error.status === 401 || error.status === 403) setOrganization(null);
        },
    );

    const value = useMemo<SessionContextValue>(
        () => ({
            session,
            user: session?.user ?? null,
            isAuthenticated: !!session,
            isLoading: isPending,
            organization,
            organizationId: organization?.id ?? null,
            refreshOrganization,
            setOrganization,
        }),
        [session, isPending, organization, refreshOrganization, setOrganization],
    );

    return (
        <SessionContext.Provider value={value}>
            {children}
        </SessionContext.Provider>
    );
}

export function useSessionContext(): SessionContextValue {
    const ctx = useContext(SessionContext);
    if (!ctx) {
        throw new Error(
            'useSessionContext must be used within a SessionProvider',
        );
    }
    return ctx;
}
