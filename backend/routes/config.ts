import process from 'process';
import { createApp } from './context';

export const configRouter = createApp();

configRouter.get('/config', (c) => {
    return c.json({
        allowSignup: process.env.ALLOW_SIGNUP === 'true',
    });
});
