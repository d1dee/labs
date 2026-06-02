import { authClient } from '@/lib/auth-client';
import { LoadingOverlay } from '@mantine/core';
import { FC, useEffect, useState } from 'react';
import ChangePassword from './pages/ChangePassword';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';

const App: FC = () => {
    const [user, setUser] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [changePasswordOpened, setChangePasswordOpened] = useState(false);

    const checkSession = async () => {
        try {
            const { data: session } = await authClient.getSession();
            if (session?.user) {
                setUser(session.user);
            }
        } catch (error) {
            console.error('Session check failed:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        checkSession();
    }, []);

    const handleLogout = async (): Promise<void> => {
        try {
            await authClient.signOut();
        } catch (error) {
            console.error('Logout failed:', error);
        } finally {
            setUser(null);
            setChangePasswordOpened(false);
        }
    };

    if (loading) {
        return <LoadingOverlay>Loading...</LoadingOverlay>;
    }

    if (!user) {
        return <Login onLoginSuccess={checkSession} />;
    }

    return (
        <>
            <Dashboard
                userName={user.name || user.username || 'Teacher'}
                onLogout={handleLogout}
                onChangePassword={() => setChangePasswordOpened(true)}
            />
            <ChangePassword
                opened={changePasswordOpened}
                onClose={() => setChangePasswordOpened(false)}
            />
        </>
    );
};

export default App;
