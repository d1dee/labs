import '@mantine/charts/styles.css';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import '@mantine/notifications/styles.css';
import 'dayjs/locale/en-gb';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <MantineProvider defaultColorScheme='auto'>
            <Notifications position='bottom-right' />
            <ModalsProvider>
                <App />
            </ModalsProvider>
        </MantineProvider>
    </React.StrictMode>,
);
