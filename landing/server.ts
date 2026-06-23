import { readFileSync } from 'fs';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = new Hono();

app.use(compress());

const html = readFileSync(path.join(__dirname, 'index.html'), 'utf-8');
const robots = readFileSync(path.join(__dirname, 'robots.txt'), 'utf-8');
const sitemap = readFileSync(path.join(__dirname, 'sitemap.xml'), 'utf-8');

app.get('/', (c) => {
    c.header('Cache-Control', 'public, max-age=300');
    return c.html(html);
});
app.get('/robots.txt', (c) => {
    c.header('Cache-Control', 'public, max-age=300');
    return c.text(robots);
});
app.get('/sitemap.xml', (c) => {
    c.header('Cache-Control', 'public, max-age=300');
    c.header('Content-Type', 'application/xml');
    return c.text(sitemap);
});

app.get('/index.html', (c) => c.redirect('/'));

const port = process.env.PORT || 4000;

console.log(`Labs FCD landing page → http://localhost:${port}`);

export default {
    port,
    fetch: app.fetch,
};
