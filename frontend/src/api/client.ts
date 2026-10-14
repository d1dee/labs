import { createFetch } from '@better-fetch/fetch';
import { getLogger } from '../lib/logger';

const apiLogger = getLogger(['labs', 'frontend', 'api']);

// Tracks when each request started so onResponse can log the round-trip
// duration; keyed by the per-request context object better-fetch reuses.
const requestStartedAt = new WeakMap<object, number>();

export const $fetch = createFetch({
    credentials: 'include',
    onRequest: (context) => {
        requestStartedAt.set(context, performance.now());
        apiLogger.debug('-> {method} {url}', {
            method: context.method,
            url: String(context.url),
        });
    },
    onResponse: (context) => {
        const { response, request } = context;
        const startedAt = requestStartedAt.get(request);
        const properties = {
            method: request.method,
            url: String(request.url),
            status: response.status,
            durationMs: Math.round(performance.now() - (startedAt ?? performance.now())),
        };
        const message = '<- {method} {url} {status} ({durationMs}ms)';
        if (response.status < 400) {
            apiLogger.debug(message, properties);
        }
    },
    onError: ({ request, response, error }) => {
        const properties = {
            method: request.method,
            url: String(request.url),
            status: response.status,
            error,
        };
        if (response.status >= 500) apiLogger.error('API request failed', properties);
        else apiLogger.warn('API request rejected', properties);
    },
});

interface ApiError {
    error?: string;
    code?: string;
    status: number;
    statusText: string;
}

export async function throwOnError<T>(
    res: { data: T | null; error: ApiError | null },
    fallback: string,
): Promise<T> {
    if (res.error) {
        const err = new Error(res.error.error || fallback);
        (err as any).code = res.error.code;
        throw err;
    }
    return res.data as T;
}
