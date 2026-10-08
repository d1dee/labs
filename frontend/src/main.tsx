// LogTape must be configured before anything else logs; keep this first.
import './lib/logger';

import '@mantine/charts/styles.css';
import { Badge, Button, Card, createTheme, MantineProvider, Paper } from '@mantine/core';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import '@mantine/notifications/styles.css';
import 'dayjs/locale/en-gb';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Central palette mirrors the Veyon operations desk: a dark hero gradient
// accented with teal. Teal is the primary color so every default Button,
// Badge and focus ring across the app shares the same accent, and the same
// system + monospace font stacks and large card radii propagate everywhere.
const theme = createTheme({
    primaryColor: 'teal',
    defaultRadius: 'md',
    fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Helvetica Neue", Arial, sans-serif',
    fontFamilyMonospace:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    headings: {
        fontFamily: 'inherit',
        fontWeight: '700',
    },
    components: {
        Button: Button.extend({ defaultProps: { radius: 'md' } }),
        Card: Card.extend({ defaultProps: { radius: 'lg' } }),
        Paper: Paper.extend({ defaultProps: { radius: 'lg' } }),
        Badge: Badge.extend({ defaultProps: { radius: 'md' } }),
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
