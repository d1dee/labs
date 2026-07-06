import { SessionProvider, useSessionContext } from '@/context/SessionContext';
import { authClient } from '@/lib/auth-client';
import { LoadingOverlay } from '@mantine/core';
import { type FC, useState } from 'react';
import ChangePassword from './pages/ChangePassword';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Settings from './pages/Settings';

const AppContent: FC = () => {
    const { isAuthenticated, isLoading } = useSessionContext();
    const [changePasswordOpened, setChangePasswordOpened] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);

    const handleLogout = async (): Promise<void> => {
        try {
            await authClient.signOut();
        } catch (error) {
            console.error('Logout failed:', error);
        } finally {
            setChangePasswordOpened(false);
        }
    };

    if (isLoading) {
        return <LoadingOverlay visible>Loading...</LoadingOverlay>;
    }

    if (!isAuthenticated) {
        return <Login />;
    }

    return (
        <>
            <Dashboard
                onLogout={handleLogout}
                onChangePassword={() => setChangePasswordOpened(true)}
                onSettingsOpen={() => setSettingsOpen(true)}
            />
            <ChangePassword
                opened={changePasswordOpened}
                onClose={() => setChangePasswordOpened(false)}
            />
            <Settings
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
