import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { mock, spyOn } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema';

const scenario = process.argv[2]!;
const sqlite = new Database(':memory:');
sqlite.run('PRAGMA foreign_keys = ON');
sqlite.run(`
    CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);
    INSERT INTO user VALUES ('teacher');
    CREATE TABLE activationHistory (
        id TEXT PRIMARY KEY NOT NULL, labId TEXT NOT NULL,
        enabled INTEGER NOT NULL, triggeredBy TEXT REFERENCES user(id),
        source TEXT NOT NULL DEFAULT 'app',
        createdAt INTEGER NOT NULL
    );
    CREATE TABLE demoState (
        id TEXT PRIMARY KEY NOT NULL, userId TEXT NOT NULL, category TEXT NOT NULL,
        resourceId TEXT, action TEXT NOT NULL, data TEXT NOT NULL, createdAt INTEGER NOT NULL
    );
    CREATE TABLE firewallConfig (
        organizationId TEXT NOT NULL, mikrotikBaseUrl TEXT NOT NULL,
        mikrotikUsername TEXT NOT NULL, mikrotikPassword TEXT NOT NULL
    );
    INSERT INTO firewallConfig VALUES ('school', 'https://router.invalid', 'test', 'test');
`);
const db = drizzle({ client: sqlite, schema });
mock.module('../db/database', () => ({ db }));
mock.module('./auth', () => ({ auth: {} }));
const lab = { id: 'lab-a', name: 'Alpha', ruleId: '*1', subnet: '192.0.2.0/24', dhcpServer: '' };
mock.module('./firewall-config', () => ({
    getFirewallConfigWithLabs: async () => scenario === 'missing-config' ? null : { labs: [lab] },
    mapLabs: (labs: unknown[]) => labs,
}));

const calls: Array<{ url: string; method: string; body: unknown }> = [];
let action = 'drop';
let unavailable = false;
let ruleDisabled = false;
globalThis.fetch = (async (input, options) => {
    const url = String(input);
    const method = options?.method ?? 'GET';
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    calls.push({ url, method, body });
    assert.ok(url.startsWith('https://router.invalid/rest/'), 'no real upstream requests');
    if (method === 'PATCH') {
        if (scenario.includes('patch-failure')) return Response.json({ message: 'Rejected' }, { status: 500 });
        if (scenario === 'network-failure') throw new Error('offline');
        if (scenario !== 'state-mismatch') action = body.action;
        return Response.json({ action, disabled: 'false' });
    }
    if (url.endsWith('/ip/firewall/filter/*1')) {
        if (scenario === 'verification-failure' || unavailable) return Response.json({ message: 'Unavailable' }, { status: 503 });
        return Response.json({ action, disabled: scenario === 'disabled-rule' || ruleDisabled ? 'true' : 'false' });
    }
    if (url.endsWith('/ip/arp')) return Response.json([]);
    if (url.endsWith('/ip/firewall/connection')) {
        return Response.json([{ '.id': '*c', 'src-address': '192.0.2.10:443' }, { '.id': '*d', 'src-address': '198.51.100.10:443' }]);
    }
    assert.equal(method, 'DELETE');
    assert.ok(url.endsWith('/ip/firewall/connection/*c'));
    return new Response(null, { status: 204 });
}) as typeof fetch;

const { labsRouter } = await import('./routes/labs');
const { createApp } = await import('./routes/context');
const demo = scenario.startsWith('demo');
const app = createApp();
app.use('*', async (c, next) => {
    c.set('user', { id: 'teacher', username: demo ? 'demo' : 'teacher', organizationId: 'school' } as any);
    await next();
});
app.route('/api', labsRouter);
const request = async (body: unknown = { enable: true }, labId = 'lab-a') => app.request(`/api/labs/${labId}/toggle`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const history = () => db.select().from(schema.activationHistory).all();
const demoHistory = () => db.select().from(schema.demoState).all();
const assertEmpty = () => {
    assert.equal(history().length, 0);
    assert.equal(demoHistory().length, 0);
};

try {
    if (scenario === 'external' || scenario === 'external-db-failure' || scenario === 'demo-observation') {
        const overview = async () => app.request('/api/labs/overview');
        const first = await overview();
        assert.equal(first.status, 200);
        assert.equal(history().length, demo ? 0 : 1, 'initial observation establishes a durable baseline');
        if (!demo) {
            assert.equal(history()[0]?.source, 'external');
            assert.equal(history()[0]?.triggeredBy, null);
            assert.equal(history()[0]?.enabled, false);
        }
        action = 'accept';
        if (scenario === 'external-db-failure') {
            sqlite.run("CREATE TRIGGER reject_history BEFORE INSERT ON activationHistory BEGIN SELECT RAISE(ABORT, 'test'); END");
            assert.equal((await overview()).status, 500);
            assert.equal(history().length, 1);
            sqlite.run('DROP TRIGGER reject_history');
        }
        const responses = await Promise.all(Array.from({ length: 5 }, overview));
        for (const response of responses) {
            assert.equal(response.status, 200);
            const result = await response.json() as any;
            assert.equal(result.stats['lab-a'].firewall.disabled, false);
            if (!demo) assert.equal(result.history['lab-a'][0].enabled, true, 'same response includes reconciled state');
        }
        assert.equal(history().length, demo ? 0 : 2, 'concurrent observations are deduplicated');
        if (!demo) {
            unavailable = true;
            assert.equal((await overview()).status, 500);
            unavailable = false;
            ruleDisabled = true;
            assert.equal((await overview()).status, 500);
            ruleDisabled = false;
            action = 'jump';
            assert.equal((await overview()).status, 500);
            assert.equal(history().length, 2, 'unreliable states are not recorded');
            action = 'accept';
            assert.equal((await request({ enable: false })).status, 200);
            assert.equal((await overview()).status, 200);
            assert.equal(history().length, 3, 'app toggle is not duplicated by observation');
            assert.equal(history()[2]?.triggeredBy, 'teacher');
            assert.equal(history()[2]?.source, 'app');
            const before = history().length;
            await Promise.all([overview(), request({ enable: true }), overview()]);
            assert.equal(history().length, before + 1, 'polls racing an app toggle do not create external rows');
        }
    } else if (scenario.startsWith('helper-patch-failure')) {
        const { toggleRuleDisabled } = await import('./mikrotik');
        const enable = !scenario.endsWith('-disable');
        action = enable ? 'accept' : 'drop';
        assert.deepEqual(await toggleRuleDisabled('school', lab.ruleId, enable, lab.subnet), {
            success: false, error: 'Rejected',
        });
        assert.equal(calls.length, 1, 'failed PATCH returns before connection cleanup');
        assert.equal(calls[0]?.method, 'PATCH');
        assertEmpty();
    } else if (scenario === 'invalid-input') {
        for (const body of [{}, { enable: 'false' }, { enable: 0 }, { enable: null }, { enable: [] }, [], null, true]) {
            assert.equal((await request(body)).status, 400);
        }
        assert.equal(calls.length, 0);
        assertEmpty();
    } else if (scenario === 'malformed-json') {
        assert.equal((await app.request('/api/labs/lab-a/toggle', { method: 'POST', body: '{' })).status, 400);
        assert.equal(calls.length, 0);
        assertEmpty();
    } else if (scenario === 'authentication') {
        for (const user of [null, { id: 'teacher', organizationId: null }]) {
            const denied = createApp();
            denied.use('*', async (c, next) => { c.set('user', user as any); await next(); });
            denied.route('/api', labsRouter);
            assert.equal((await denied.request('/api/labs/lab-a/toggle', { method: 'POST', body: '{"enable":true}' })).status, user ? 403 : 401);
        }
        assert.equal(calls.length, 0);
        assertEmpty();
    } else if (scenario === 'missing-config' || scenario === 'unowned-lab') {
        assert.equal((await request({ enable: true }, scenario === 'unowned-lab' ? 'other-lab' : 'lab-a')).status, 404);
        assert.equal(calls.length, 0);
        assertEmpty();
    } else if (['patch-failure', 'patch-failure-disable', 'network-failure', 'verification-failure', 'state-mismatch', 'disabled-rule'].includes(scenario)) {
        // Start in the requested state for PATCH failures: a read alone cannot
        // distinguish a failed repeated request from a successful PATCH.
        const enable = !scenario.endsWith('-disable');
        if (scenario.startsWith('patch-failure') || scenario === 'network-failure') action = enable ? 'accept' : 'drop';
        const response = await request({ enable });
        assert.ok(response.status >= 500);
        const result = await response.json() as Record<string, unknown>;
        assert.notEqual(result.success, true);
        if (scenario.startsWith('patch-failure') || scenario === 'network-failure') assert.equal(calls.length, 1);
        else assert.equal(result.code, 'ROUTER_STATE_UNVERIFIED');
        assertEmpty();
    } else if (scenario.startsWith('db-failure') || scenario === 'demo-db-failure') {
        const table = demo ? 'demoState' : 'activationHistory';
        sqlite.run(`CREATE TRIGGER reject_history BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'test persistence failure'); END`);
        const enable = !scenario.endsWith('-disable');
        const response = await request({ enable });
        assert.equal(response.status, 500);
        const result = await response.json() as Record<string, unknown>;
        assert.equal(result.success, false);
        assert.equal(result.code, 'HISTORY_SAVE_FAILED');
        if (!demo) {
            assert.equal(result.routerApplied, true);
            assert.equal(result.enabled, enable);
            assert.equal(action, enable ? 'accept' : 'drop');
            assert.equal(calls.filter((call) => call.method === 'PATCH').length, 1, 'no automatic rollback');
        } else assert.equal(calls.length, 0);
        assertEmpty();
    } else if (scenario === 'awaited-write' || scenario === 'demo-awaited-write') {
        let release!: () => void;
        let started!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const inserting = new Promise<void>((resolve) => { started = resolve; });
        const insert = db.insert.bind(db);
        const spy = spyOn(db, 'insert').mockImplementation(((table: any) => ({
            values: async (values: any) => {
                started();
                await gate;
                await insert(table).values(values);
            },
        })) as typeof db.insert);
        let responded = false;
        const responsePromise = request().then((response) => { responded = true; return response; });
        await inserting;
        await Promise.resolve();
        assert.equal(responded, false);
        assertEmpty();
        release();
        assert.equal((await responsePromise).status, 200);
        assert.equal((demo ? demoHistory() : history()).length, 1);
        spy.mockRestore();
    } else {
        const values = scenario === 'disable' ? [false] : scenario === 'repeat' || demo ? [true, false, false, true] : [true];
        for (const [index, enable] of values.entries()) {
            const firstCall = calls.length;
            const response = await request({ enable });
            assert.equal(response.status, 200);
            assert.equal((await response.json() as { enabled: boolean }).enabled, enable);
            const rows = demo ? demoHistory() : history();
            assert.equal(rows.length, index + 1, 'each success has a committed row before the response');
            if (!demo) {
                assert.deepEqual(calls.filter((call) => call.method === 'PATCH').at(-1)?.body, { disabled: 'false', action: enable ? 'accept' : 'drop' });
                assert.equal(action, enable ? 'accept' : 'drop');
                assert.deepEqual(calls.slice(firstCall).map((call) => [call.method, new URL(call.url).pathname]), enable ? [
                    ['PATCH', '/rest/ip/firewall/filter/*1'],
                    ['GET', '/rest/ip/firewall/filter/*1'],
                ] : [
                    ['PATCH', '/rest/ip/firewall/filter/*1'],
                    ['GET', '/rest/ip/firewall/connection'],
                    ['DELETE', '/rest/ip/firewall/connection/*c'],
                    ['GET', '/rest/ip/firewall/filter/*1'],
                ]);
            }
        }
        if (demo) {
            const rows = demoHistory();
            assert.deepEqual(rows.map((row) => JSON.parse(row.data).enabled), values);
            assert.ok(rows.every((row) => row.userId === 'teacher' && row.resourceId === 'lab-a' && row.action === 'toggle' && row.category === 'lab'));
            assert.equal(calls.length, 0);
            assert.equal(history().length, 0);
            const result = await (await app.request('/api/labs/lab-a/history')).json() as { history: unknown[] };
            assert.equal(result.history.length, values.length);
        } else {
            const rows = history();
            assert.deepEqual(rows.map((row) => row.enabled), values);
            assert.ok(rows.every((row) => row.labId === 'lab-a' && row.triggeredBy === 'teacher' && row.createdAt instanceof Date));
            assert.equal(new Set(rows.map((row) => row.id)).size, values.length);
            assert.equal(demoHistory().length, 0);
            assert.equal(calls.filter((call) => call.method === 'DELETE').length, values.filter((value) => !value).length);
            const result = await (await app.request('/api/labs/lab-a/history')).json() as { history: unknown[] };
            assert.equal(result.history.length, values.length);
        }
        assert.equal((sqlite.query('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys, 1);
    }
} finally {
    sqlite.close();
}
