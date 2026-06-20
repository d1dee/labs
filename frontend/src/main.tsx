import '@mantine/charts/styles.css';
import { createTheme, MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import '@mantine/notifications/styles.css';
import 'dayjs/locale/en-gb';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const theme = createTheme({
    primaryColor: 'accent',
    defaultRadius: 'md',
    colors: {
        accent: [
            '#e6fff5',
            '#ccffeb',
            '#99ffd6',
            '#66ffc2',
            '#33ffad',
            '#00e5a0',
            '#00c98c',
            '#00a876',
            '#008761',
            '#00664c',
        ],
        'accent-secondary': [
            '#e6f8fd',
            '#ccf1fb',
            '#99e3f7',
            '#66d5f3',
            '#33c7ef',
            '#00b4d8',
            '#009bb9',
            '#00829a',
            '#00697b',
            '#00505c',
        ],
    },

    other: {
        landing: {
            bg: '#0a0c0f',
            bgElevated: '#111419',
            bgCard: '#161920',
            bgCardHover: '#1c2029',
            fg: '#e8eaed',
            fgMuted: '#8b90a0',
            fgDim: '#555a6e',
            accentGlow: 'rgba(0, 229, 160, 0.15)',
            accentGlowStrong: 'rgba(0, 229, 160, 0.3)',
            border: 'rgba(255, 255, 255, 0.06)',
            borderAccent: 'rgba(0, 229, 160, 0.2)',
        },
    },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <MantineProvider theme={theme} defaultColorScheme='auto'>
            <Notifications position='bottom-right' />
            <ModalsProvider>
                <App />
            </ModalsProvider>
        </MantineProvider>
    </React.StrictMode>,
);
