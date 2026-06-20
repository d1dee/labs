import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = new Hono();

app.use(compress());

const html = readFileSync(path.join(__dirname, 'index.html'), 'utf-8');

app.get('/', (c) => {
    c.header('Cache-Control', 'public, max-age=300');
    return c.html(html);
});

app.get('/index.html', (c) => c.redirect('/'));

const port = process.env.PORT || 4000;

console.log(`Labs FCD landing page → http://localhost:${port}`);

export default {
    port,
    fetch: app.fetch,
};
