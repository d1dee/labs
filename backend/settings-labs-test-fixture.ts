import { Database } from 'bun:sqlite';
import { mock } from 'bun:test';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import assert from 'node:assert/strict';
import * as schema from '../db/index';

const scenario = process.argv[2]!;
const sqlite = new Database(':memory:');
sqlite.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE organization (id TEXT PRIMARY KEY);
    INSERT INTO organization VALUES ('school');
    CREATE TABLE user (id TEXT PRIMARY KEY);
    INSERT INTO user VALUES ('teacher');
    CREATE TABLE firewallConfig (
        id TEXT PRIMARY KEY, organizationId TEXT NOT NULL REFERENCES organization(id),
        mikrotikBaseUrl TEXT NOT NULL, mikrotikUsername TEXT NOT NULL,
        mikrotikPassword TEXT NOT NULL, defaultDnsSuffix TEXT NOT NULL DEFAULT '',
        createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
    );
    CREATE TABLE lab (
        id TEXT PRIMARY KEY, firewallConfigId TEXT NOT NULL REFERENCES firewallConfig(id),
        name TEXT NOT NULL, ruleId TEXT, ruleMarker TEXT, dhcpServer TEXT,
        interface TEXT, subnet TEXT, description TEXT, dnsSuffix TEXT,
        createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
    );
    CREATE TABLE dataUsageHistory (
        id TEXT PRIMARY KEY, labId TEXT NOT NULL, totalBytes INTEGER NOT NULL,
        usageMB INTEGER NOT NULL, createdAt INTEGER NOT NULL
    );
    CREATE TABLE activationHistory (
        id TEXT PRIMARY KEY, labId TEXT NOT NULL, enabled INTEGER NOT NULL,
        triggeredBy TEXT REFERENCES user(id), source TEXT NOT NULL DEFAULT 'app',
        createdAt INTEGER NOT NULL
    );
`);
const db = drizzle({ client: sqlite, schema });
mock.module('../db/database', () => ({ db }));
mock.module('./auth', () => ({ auth: {} }));
mock.module('./veyon-poller', () => ({ veyonPoller: {} }));

const configId = 'config000001';
const interfaceName = 'vlan10::lab-1';
const marker = `fcd-${interfaceName}`;
db.insert(schema.firewallConfig).values({
    id: configId,
    organizationId: 'school',
    mikrotikBaseUrl: 'https://router.invalid',
    mikrotikUsername: 'test',
    mikrotikPassword: 'secret',
    defaultDnsSuffix: 'original.test',
}).run();

type Rule = Record<string, string>;
const rules: Rule[] = [
    { '.id': '*1', chain: 'forward', action: 'drop', disabled: 'false',
        'in-interface': interfaceName, comment: 'Original operator description' },
    { '.id': '*2', chain: 'forward', action: 'drop', disabled: 'false',
        'in-interface': 'vlan20::lab-2', comment: 'Second operator description' },
];
const runtime = scenario.startsWith('runtime-');
if (runtime || scenario === 'required-marker') {
    db.insert(schema.lab).values({
        id: 'lab-existing', firewallConfigId: configId, name: 'Existing',
        ruleId: '*a', ruleMarker: marker, interface: interfaceName,
        subnet: '10.50.0.0/24', dhcpServer: 'actual-dhcp',
    }).run();
    if (scenario !== 'runtime-missing' && scenario !== 'required-marker') {
        rules[0]!['.id'] = '*b';
        rules[0]!.comment += `\n${marker}`;
    } else {
        rules[0]!['.id'] = '*a';
    }
    if (scenario === 'runtime-duplicate') rules[1]!.comment += `\n${marker}`;
}
if (scenario === 'duplicate-rule') {
    delete rules[0]!['in-interface'];
    rules[0]!['src-address'] = '10.50.0.0/24';
}
if (scenario === 'wrong-chain') rules[0]!.chain = 'input';
if (scenario === 'wrong-interface') rules[0]!['in-interface'] = 'another-lab';
if (scenario === 'broad-rule') delete rules[0]!['in-interface'];
if (scenario === 'wrong-subnet') rules[0]!['src-address'] = '192.0.2.0/24';
if (['source-list', 'mixed-source-list', 'pool-source-list', 'host-source-list', 'cross-boundary-list', 'negated-source-list', 'shared-list-interface', 'shared-list-subnet'].includes(scenario)) {
    if (scenario !== 'shared-list-interface') delete rules[0]!['in-interface'];
    rules[0]!['src-address-list'] = scenario === 'negated-source-list' ? '!lab-addresses' : 'lab-addresses';
    if (scenario === 'shared-list-subnet') rules[0]!['src-address'] = '10.50.0.0/24';
}
if (scenario === 'source-range') {
    delete rules[0]!['in-interface'];
    rules[0]!['src-address'] = '10.50.0.20-10.50.0.200';
}
if (scenario === 'marker-conflict') rules[1]!.comment += `\n${marker}`;
if (scenario === 'db-failure') {
    sqlite.run("CREATE TRIGGER reject_lab BEFORE INSERT ON lab BEGIN SELECT RAISE(ABORT, 'test DB failure'); END");
}
const beforeLabs = db.select().from(schema.lab).all();
const beforeConfig = db.select().from(schema.firewallConfig).get();
const beforeComments = rules.map((rule) => rule.comment);
const calls: Array<{ path: string; search: string; method: string; body: any }> = [];
let tagFailed = false;
globalThis.fetch = (async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://router.invalid', 'no real network allowed');
    const method = options?.method ?? 'GET';
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    const path = decodeURIComponent(url.pathname.replace(/^\/rest/, ''));
    calls.push({ path, search: url.search, method, body });
    if (path === '/ip/firewall/filter') return Response.json(rules);
    if (path.startsWith('/ip/firewall/filter/')) {
        const rule = rules.find((row) => row['.id'] === path.split('/').at(-1));
        if (!rule) return Response.json({ message: 'Not found' }, { status: 404 });
        if (method === 'PATCH') {
            if (scenario === 'tag-failure' && rule['.id'] === '*2' && !tagFailed) {
                tagFailed = true;
                // An unsuccessful response may still have applied the comment.
                Object.assign(rule, body);
                return Response.json({ message: 'Tag rejected' }, { status: 500 });
            }
            if (scenario !== 'tag-unverified') Object.assign(rule, body);
        }
        return Response.json(rule);
    }
    assert.equal(method, 'GET', `unexpected router write: ${path}`);
    const name = url.searchParams.get('name');
    const attached = url.searchParams.get('interface');
    if (path === '/interface') {
        assert.ok([interfaceName, 'vlan20::lab-2'].includes(name!));
        return Response.json([{ name: `${name}-not-exact` }, { name }]);
    }
    if (path === '/ip/dhcp-server') {
        const server = { interface: attached, name: 'actual-dhcp', 'address-pool': 'actual-pool' };
        return Response.json(scenario === 'ambiguous-dhcp' ? [server, { ...server, name: 'other-dhcp' }] : [server]);
    }
    if (path === '/ip/pool') return Response.json([{ name: 'actual-pool', ranges: '10.50.0.20-10.50.0.200' }]);
    if (path === '/ip/firewall/address-list') return Response.json([
        { list: 'lab-addresses', address: scenario === 'pool-source-list' ? '10.50.0.20-10.50.0.200' : scenario === 'host-source-list' ? '10.50.0.40' : scenario === 'cross-boundary-list' ? '10.50.0.200-10.50.1.20' : '10.50.0.0/24' },
        ...(['mixed-source-list', 'shared-list-interface', 'shared-list-subnet'].includes(scenario) ? [{ list: 'lab-addresses', address: '192.0.2.0/24' }] : []),
    ]);
    if (path === '/ip/address') return Response.json([
        { interface: attached, address: '10.50.0.1/24' },
        ...(scenario === 'ambiguous-subnet' ? [{ interface: attached, address: '10.60.0.1/24' }] : []),
    ]);
    assert.fail(`Unexpected fake router endpoint: ${path}`);
}) as typeof fetch;

const { settingsRouter } = await import('./routes/settings');
const { createApp } = await import('./routes/context');
const app = createApp();
let user: any = { id: 'teacher', username: 'teacher', organizationId: 'school' };
app.use('*', async (c, next) => { c.set('user', user); await next(); });
app.route('/api', settingsRouter);
if (runtime) {
    const { labsRouter } = await import('./routes/labs');
    app.route('/api', labsRouter);
}
const submitted = [{
    name: 'Lab One', firewallId: scenario === 'required-marker' ? '*a' : '*1', interface: interfaceName,
    subnet: '203.0.113.0/24', dhcpServer: 'untrusted-client-value',
    ...(scenario === 'required-marker' ? { id: 'lab-existing' } : {}),
}];
if (['duplicate-interface', 'duplicate-rule', 'tag-failure'].includes(scenario)) {
    submitted.push({ ...submitted[0]!, name: 'Lab Two',
        firewallId: scenario === 'duplicate-rule' ? '*1' : '*2',
        interface: scenario === 'duplicate-interface' ? interfaceName : 'vlan20::lab-2',
    });
}
const save = () => app.request('/api/settings/labs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: configId, defaultDnsSuffix: 'changed.test', labs: submitted }),
});
const patches = () => calls.filter((call) => call.method === 'PATCH');
const unchanged = () => {
    assert.deepEqual(db.select().from(schema.lab).all(), beforeLabs);
    assert.deepEqual(db.select().from(schema.firewallConfig).get(), beforeConfig);
};
try {
    if (scenario === 'auth-demo') {
        for (const identity of [null, { ...user, organizationId: null }, { ...user, username: 'demo' }]) {
            user = identity;
            assert.equal((await save()).status, identity ? 403 : 401);
            if (!identity || !identity.organizationId) {
                assert.equal((await app.request(`/api/settings/lab-interface?name=${encodeURIComponent(interfaceName)}`)).status, identity ? 403 : 401);
            }
        }
        assert.equal(calls.length, 0);
        const response = await app.request(`/api/settings/lab-interface?name=${encodeURIComponent(interfaceName)}`);
        assert.equal(response.status, 200, 'demo users can discover interfaces');
        unchanged();
    } else if (scenario === 'get-discovery') {
        for (const query of ['', '?name=', '?name=bad%0Aname', `?name=${'x'.repeat(129)}`]) {
            assert.equal((await app.request(`/api/settings/lab-interface${query}`)).status, 400);
        }
        assert.equal(calls.length, 0);
        const response = await app.request(`/api/settings/lab-interface?name=${encodeURIComponent(interfaceName)}`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { success: true, data: {
            subnet: '10.50.0.0/24', dhcpServer: 'actual-dhcp', pool: 'actual-pool',
        } });
        assert.equal(new URLSearchParams(calls[0]!.search).get('name'), interfaceName);
        assert.equal(patches().length, 0);
        unchanged();
    } else if (runtime) {
        const response = await app.request('/api/labs/lab-existing/toggle', {
            method: 'POST', body: JSON.stringify({ enable: true }),
        });
        const result: any = await response.json();
        assert.equal(response.status, scenario === 'runtime-recovery' ? 200 : 400, JSON.stringify(result));
        if (scenario === 'runtime-recovery') {
            assert.deepEqual(patches().map(({ path, body }) => ({ path, body })), [{
                path: '/ip/firewall/filter/*b', body: { disabled: 'false', action: 'accept' },
            }]);
            assert.equal(db.select().from(schema.activationHistory).all().length, 1);
        } else {
            assert.equal(patches().length, 0, 'unresolved ownership blocks every PATCH');
            assert.equal(db.select().from(schema.activationHistory).all().length, 0);
        }
    } else {
        const response = await save();
        const result: any = await response.json();
        const failure = ['tag-failure', 'tag-unverified', 'db-failure'].includes(scenario);
        const success = ['save-success', 'source-list', 'pool-source-list', 'host-source-list', 'source-range', 'shared-list-interface', 'shared-list-subnet'].includes(scenario);
        assert.equal(response.status, success ? 200 : failure ? 502 : 400, JSON.stringify(result));
        if (['mixed-source-list', 'cross-boundary-list', 'negated-source-list'].includes(scenario)) {
            assert.equal(result.error, 'Lab One: Firewall rule must be limited to this lab (10.50.0.0/24).');
        }
        if (success) {
            const saved = db.select().from(schema.lab).get()!;
            assert.equal(saved.interface, interfaceName);
            assert.equal(saved.subnet, '10.50.0.0/24');
            assert.equal(saved.dhcpServer, 'actual-dhcp');
            assert.equal(saved.ruleMarker, marker);
            assert.equal(saved.ruleId, '*1');
            assert.equal(rules[0]!.comment, `${beforeComments[0]}\n${marker}`);
            assert.deepEqual(patches().map((call) => call.body), [{ comment: `${beforeComments[0]}\n${marker}` }]);
            assert.equal(result.data.labs[0].ruleMarker, marker);
            assert.equal(result.data.mikrotikPassword, '******');
        } else {
            unchanged();
            assert.deepEqual(rules.map((rule) => rule.comment), beforeComments, 'all original comments restored');
            if (failure) {
                assert.ok(patches().length >= 1);
                if (scenario === 'tag-failure') assert.deepEqual(patches().map((call) => call.path), [
                    '/ip/firewall/filter/*1', '/ip/firewall/filter/*2',
                    '/ip/firewall/filter/*2', '/ip/firewall/filter/*1',
                ]);
            } else assert.equal(patches().length, 0, 'validation must finish before any PATCH');
        }
    }
} finally {
    sqlite.close();
}
