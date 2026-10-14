import type { ErrorHandler, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { errorProperty, getLogger } from './logger';
import type { AppEnv } from './routes/context';

const httpLogger = getLogger(['labs', 'http']);

export const logHttpRequest: MiddlewareHandler<AppEnv> = async (c, next) => {
    const startedAt = performance.now();
    await next();
    if (c.error) return; // The error handler already logged the original exception.
    const status = c.res.status;
    const properties = {
        method: c.req.method,
        path: c.req.path,
        status,
        durationMs: Math.round(performance.now() - startedAt),
    };
    if (status < 400) {
        httpLogger.debug('{method} {path} -> {status} ({durationMs}ms)', properties);
        return;
    }
    let response: unknown;
    try {
        const text = await c.res.clone().text();
        try { response = JSON.parse(text); } catch { response = text; }
    } catch (error) {
        response = errorProperty(error);
    }
    const details = { ...properties, response };
    if (status >= 500) httpLogger.error('Request failed: {method} {path} ({status})', details);
    else httpLogger.warn('Request rejected: {method} {path} ({status})', details);
};

export const logHttpError: ErrorHandler<AppEnv> = (error, c) => {
    const details = { method: c.req.method, path: c.req.path, error: errorProperty(error) };
    if (error instanceof HTTPException && error.status < 500) {
        httpLogger.warn('Request rejected: {method} {path}', details);
    } else {
        httpLogger.error('Unhandled request error: {method} {path}', details);
    }
    if (error instanceof HTTPException) return error.getResponse();
    return c.json({ error: 'Internal server error' }, 500);
};
