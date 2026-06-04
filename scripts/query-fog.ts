import { config } from 'dotenv';
config();

const FOG_URL = process.env.FOG_URL?.replace(/\/$/, '') || '';
const FOG_API_TOKEN = process.env.FOG_API_TOKEN || '';
const FOG_USER_TOKEN = process.env.FOG_USER_TOKEN || '';

async function fogRequest(path: string): Promise<unknown> {
    const res = await fetch(`${FOG_URL}${path}`, {
        headers: {
            'fog-api-token': FOG_API_TOKEN,
            'fog-user-token': FOG_USER_TOKEN,
            'Content-Type': 'application/json',
        },
    });
    if (!res.ok) {
        return { error: `HTTP ${res.status}`, body: await res.text() };
    }
    return res.json();
}

const endpoints = [
    { name: 'list hosts', path: '/fog/host' },
    { name: 'search hosts', path: '/fog/host/search/test' },
    { name: 'list images', path: '/fog/image' },
    { name: 'list tasktypes', path: '/fog/tasktype' },
    { name: 'list snapins', path: '/fog/snapin' },
    { name: 'active tasks', path: '/fog/task/active' },
    { name: 'active multicast', path: '/fog/multicastsession/current' },
];

async function main() {
    for (const ep of endpoints) {
        console.log(`\n=== ${ep.name} (${ep.path}) ===`);
        try {
            const data = await fogRequest(ep.path);
            console.log(JSON.stringify(data, null, 2));
        } catch (err) {
            console.log('Error:', String(err));
        }
    }
}

main();
