import { SessionProvider, useSessionContext } from '@/context/SessionContext';
import { authClient } from '@/lib/auth-client';
import { LoadingOverlay } from '@mantine/core';
import { type FC, useEffect, useState } from 'react';
import ChangePassword from './pages/ChangePassword';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Settings from './pages/Settings';

const AppContent: FC = () => {
    const { isAuthenticated, isLoading, user, organizationId } = useSessionContext();
    const [changePasswordOpened, setChangePasswordOpened] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [initialLoadComplete, setInitialLoadComplete] = useState(!isLoading);

    useEffect(() => {
        if (!isLoading) setInitialLoadComplete(true);
    }, [isLoading]);

    const handleLogout = async (): Promise<void> => {
        try {
            await authClient.signOut();
        } catch (error) {
            console.error('Logout failed:', error);
        } finally {
            setChangePasswordOpened(false);
        }
    };

    // Background session checks must not unmount signup/verification drafts.
    if (isLoading && !initialLoadComplete) {
        return <LoadingOverlay visible>Loading...</LoadingOverlay>;
    }

    if (!isAuthenticated || new URLSearchParams(window.location.search).get('auth') === 'reset') {
        return <Login />;
    }

    if (user && !user.emailVerified) {
        return <Login verificationEmail={user.email} />;
    }

    return (
        <>
            <Dashboard
                key={`dashboard:${user?.id}:${organizationId}`}
                onLogout={handleLogout}
                onChangePassword={() => setChangePasswordOpened(true)}
                onSettingsOpen={() => setSettingsOpen(true)}
            />
            <ChangePassword
                key={`password:${user?.id}`}
                opened={changePasswordOpened}
                onClose={() => setChangePasswordOpened(false)}
            />
            <Settings
                key={`settings:${user?.id}:${organizationId}`}
                opened={settingsOpen}
                onClose={() => setSettingsOpen(false)}
            />
        </>
    );
};

const App: FC = () => {
    return (
        <SessionProvider>
            <AppContent />
        </SessionProvider>
    );
};

export default App;
