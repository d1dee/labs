import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    test: {
        environment: 'jsdom',
        // Keep DOM-heavy suites from exhausting CPU and timing out each other.
        maxWorkers: 1,
        setupFiles: [path.resolve(__dirname, './src/test/setup.ts')],
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
    },
});
