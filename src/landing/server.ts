import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = new Hono();

// Serve the landing page HTML for all routes
app.get('/', (c) => {
    const html = readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
    return c.html(html);
});

app.get('/*', (c) => {
    const html = readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
    return c.html(html);
});

// Fallback for SPA routing
app.notFound((c) => {
    const html = readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
    return c.html(html);
});

const port = process.env.LANDING_PORT ? parseInt(process.env.LANDING_PORT, 10) : 4000;

serve({ fetch: app.fetch, port }, (info) => {
    console.log(`🌿 Labs FCD Landing Page running on http://localhost:${info.port}`);
    console.log(`   Sign in redirects to the app at http://localhost:3000/app`);
});
