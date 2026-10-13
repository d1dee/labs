import { afterEach, describe, expect, it } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { VEYON_AUTH_KEYS_METHOD, VeyonApiError, VeyonClient, clearVeyonConnections } from './veyon';

const originalFetch = globalThis.fetch;

afterEach(() => {
    clearVeyonConnections('org-test');
    clearVeyonConnections('org-failure');
    globalThis.fetch = originalFetch;
});

const config = {
    url: 'https://veyon.test:11080',
    keyName: 'teacher',
    keyData: generateKeyPairSync('rsa', { modulusLength: 2048 })
        .privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    verifyTls: true,
};

describe('VeyonClient', () => {
    it('shares one authenticated connection across concurrent information calls', async () => {
        let authenticationCalls = 0;
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.includes('/authentication/') && init?.method === 'POST') {
                expect(JSON.parse(String(init.body))).toEqual({
                    method: VEYON_AUTH_KEYS_METHOD,
                    credentials: { keyname: config.keyName, keydata: config.keyData },
                });
                authenticationCalls += 1;
                return Response.json({
                    'connection-uid': 'connection-1',
                    validUntil: Math.floor(Date.now() / 1000) + 3600,
                });
            }
            if (url.endsWith('/user')) {
                return Response.json({ login: 'student', fullName: 'Student One' });
            }
            if (url.endsWith('/session')) {
                return Response.json({ sessionId: 1, sessionUptime: 60 });
            }
            if (url.endsWith('/feature')) return Response.json([]);
            return Response.json({});
        }) as unknown as typeof fetch;

        const client = new VeyonClient(config, 'org-test', 'user-test');
        const information = await client.information('lab-pc-01');

        expect(authenticationCalls).toBe(1);
        expect(information.user).toEqual({
            login: 'student',
            fullName: 'Student One',
        });
        expect(information.session).toMatchObject({ sessionId: 1 });
    });

    it('normalizes WebAPI authentication failures', async () => {
        globalThis.fetch = (async () =>
            Response.json(
                { error: { code: 6, message: 'Authentication failed' } },
                { status: 401 },
            )) as unknown as typeof fetch;

        const client = new VeyonClient(config, 'org-failure', 'user-failure');

        await expect(client.information('lab-pc-02')).rejects.toBeInstanceOf(
            VeyonApiError,
        );
        await expect(client.information('lab-pc-02')).rejects.toMatchObject({
            status: 401,
            code: 'VEYON_AUTH_FAILED',
            message: 'Authentication failed',
        });
    });

    it.each(['http', 'transport', 'success'])('reports explicit remote close outcome: %s', async (outcome) => {
        const transportError = new Error('DELETE transport failed');
        let deleteCalls = 0;
        globalThis.fetch = (async (_input, init) => {
            if (init?.method === 'DELETE') {
                deleteCalls += 1;
                expect(new Headers(init.headers).get('Connection-Uid')).toBe('close-connection');
                if (outcome === 'transport') throw transportError;
                if (outcome === 'http') return Response.json({ error: { code: 8, message: 'DELETE rejected' } }, { status: 503 });
                return new Response(null, { status: 204 });
            }
            return Response.json({ 'connection-uid': 'close-connection', validUntil: Math.floor(Date.now() / 1000) + 3600 });
        }) as typeof fetch;
        const client = new VeyonClient(config, 'org-test', 'user-test');
        await client.authenticate('close.test');
        const closing = client.close('close.test');
        if (outcome === 'http') await expect(closing).rejects.toMatchObject({ status: 503, upstreamCode: 8, message: 'DELETE rejected' });
        else if (outcome === 'transport') await expect(closing).rejects.toBe(transportError);
        else await closing;
        expect(deleteCalls).toBe(1);
        await client.close('close.test');
        expect(deleteCalls).toBe(1);
    });

    it.each(['http', 'transport'])('safely catches automatic disposal failure: %s', async (outcome) => {
        let deleteCalls = 0;
        globalThis.fetch = (async (_input, init) => {
            if (init?.method === 'DELETE') {
                deleteCalls += 1;
                if (outcome === 'transport') throw new Error('DELETE transport failed');
                return Response.json({ error: 'DELETE rejected' }, { status: 503 });
            }
            return Response.json({ 'connection-uid': 'automatic-connection', validUntil: Math.floor(Date.now() / 1000) + 3600 });
        }) as typeof fetch;
        const client = new VeyonClient(config, 'org-test', 'user-test');
        await client.authenticate('automatic.test');
        clearVeyonConnections('org-test');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(deleteCalls).toBe(1);
    });
});
