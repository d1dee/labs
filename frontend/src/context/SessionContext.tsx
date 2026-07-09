import { useSession } from '@/lib/auth-client';
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
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
type User = SessionData['user'];

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
    const [organization, setOrganization] = useState<Organization | null>(null);

    const refreshOrganization = useCallback(async () => {
        try {
            const response = await fetch('/api/organizations');
            if (!response.ok) {
                setOrganization(null);
                return;
            }
            const data = await response.json();
            if (data.organizations && data.organizations.length > 0) {
                setOrganization(data.organizations[0]);
            } else {
                setOrganization(null);
            }
        } catch (err) {
            console.error('Failed to load organization:', err);
            setOrganization(null);
        }
    }, []);

    useEffect(() => {
        if (session) {
            refreshOrganization();
        } else {
            setOrganization(null);
        }
    }, [session, refreshOrganization]);

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
        [session, isPending, organization, refreshOrganization],
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
