import { afterEach, describe, expect, it } from 'bun:test';
import { VEYON_AUTH_METHODS, VeyonApiError, VeyonClient } from './veyon';

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

const config = {
    url: 'https://veyon.test:11080',
    authMethod: VEYON_AUTH_METHODS.logon,
    username: 'teacher',
    password: 'secret',
    keyName: null,
    keyData: null,
    verifyTls: true,
};

describe('VeyonClient', () => {
    it('shares one authenticated connection across concurrent information calls', async () => {
        let authenticationCalls = 0;
        globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
            const url = String(input);
            if (url.includes('/authentication/') && init?.method === 'POST') {
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
});
