import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
    plugins: [react()],
    root: path.resolve(__dirname, '.'),
    publicDir: 'public',
    server: {
        port: 5173,
        host: '0.0.0.0',
        proxy: {
            '/api': {
                target: process.env.VITE_API_URL || 'http://localhost:3000',
                changeOrigin: true,
            },
        },
    },
    build: {
        outDir: 'build',
        sourcemap: false,
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
}));
