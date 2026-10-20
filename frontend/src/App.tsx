import { SessionProvider, useSessionContext } from '@/context/SessionContext';
import { authClient } from '@/lib/auth-client';
import { navigate, useLocation, VERIFY_EMAIL_PATH } from '@/lib/navigation';
import { LoadingOverlay } from '@mantine/core';
import { type FC, useEffect, useState } from 'react';
import ChangePassword from './pages/ChangePassword';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Settings from './pages/Settings';
import VerifyEmail from './pages/VerifyEmail';

const AppContent: FC = () => {
    const { isAuthenticated, isLoading, user, organizationId } = useSessionContext();
    const location = useLocation();
    const [changePasswordOpened, setChangePasswordOpened] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [initialLoadComplete, setInitialLoadComplete] = useState(!isLoading);

    const locationKey = `${location.pathname}${location.search}`;
    // The recovery link is read live because the login screen clears the query
    // with a plain history call once the password has been reset.
    const isResetLink =
        new URLSearchParams(window.location.search).get('auth') === 'reset';
    const isVerifyPage = location.pathname === VERIFY_EMAIL_PATH;
    const hasUnverifiedSession = isAuthenticated && !!user && !user.emailVerified;

    useEffect(() => {
        if (!isLoading) setInitialLoadComplete(true);
    }, [isLoading]);

    useEffect(() => {
        // A signed in account without a verified email is held on the
        // verification screen, so the address bar always names that screen.
        if (hasUnverifiedSession && !isVerifyPage && !isResetLink) {
            navigate(VERIFY_EMAIL_PATH, { replace: true });
        }
    }, [hasUnverifiedSession, isVerifyPage, isResetLink]);

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

    if (isResetLink) {
        return <Login key={locationKey} />;
    }

    if (isVerifyPage) {
        return <VerifyEmail key={locationKey} email={user?.email} />;
    }

    if (!isAuthenticated) {
        return <Login key={locationKey} />;
    }

    if (hasUnverifiedSession) {
        return <VerifyEmail key={locationKey} email={user?.email} />;
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
