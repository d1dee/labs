import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { inspect } from 'node:util';
import { getRotatingFileSink } from '@logtape/file';
import {
    configure,
    getTextFormatter,
    getConsoleSink,
    getJsonLinesFormatter,
    getLogger,
    type LogLevel,
} from '@logtape/logtape';

const logFilePath = process.env.LOG_FILE || 'logs/backend.log';

// Routine request traffic is debug-only; operational info stays concise.
function resolveLevel(): LogLevel {
    const raw = process.env.LOG_LEVEL?.trim().toLowerCase();
    if (
        raw === 'trace' ||
        raw === 'debug' ||
        raw === 'info' ||
        raw === 'warning' ||
        raw === 'error' ||
        raw === 'fatal'
    ) {
        return raw;
    }
    return 'info';
}

export const consoleFormatter = getTextFormatter({
    timestamp: 'time',
    category: '/',
    value: (value) => inspect(value, { depth: null, maxArrayLength: null, maxStringLength: null }),
    format: ({ timestamp, level, category, message, record }) => {
        const summary = `${timestamp} [${level}] ${category}: ${message}`;
        if (!['warning', 'error', 'fatal'].includes(record.level) || !Object.keys(record.properties).length) {
            return summary;
        }
        return `${summary}\n${inspect(record.properties, {
            depth: null, maxArrayLength: null, maxStringLength: null, compact: false,
        })}`;
    },
});

// One-time LogTape setup for the backend: human-readable console output
// plus a rotating JSON-lines file for post-mortem analysis. All backend
// modules log under the ["labs"] category root, e.g. getLogger(["labs", "http"]).
export async function configureLogger(): Promise<void> {
    // The rotating file sink requires its directory to already exist.
    mkdirSync(path.dirname(logFilePath), { recursive: true });

    await configure({
        sinks: {
            console: getConsoleSink({
                formatter: consoleFormatter,
            }),
            file: getRotatingFileSink(logFilePath, {
                maxSize: 5 * 0x400 * 0x400,
                maxFiles: 5,
                formatter: getJsonLinesFormatter(),
            }),
        },
        loggers: [
            {
                category: ['labs'],
                lowestLevel: resolveLevel(),
                sinks: ['console', 'file'],
            },
            // Meta logger surfaces LogTape's own failures (sink I/O errors,
            // configuration problems) instead of silently swallowing them.
            {
                category: ['logtape', 'meta'],
                lowestLevel: 'warning',
                sinks: ['console', 'file'],
            },
        ],
    });
}

export { getLogger };

// Normalize a thrown value into a JSON-serializable property so structured
// records survive the JSON-lines file sink (raw Error objects do not).
export function errorProperty(error: unknown, seen = new WeakSet<object>()): Record<string, unknown> {
    if (error instanceof Error) {
        if (seen.has(error)) return { message: '[Circular error]' };
        seen.add(error);
        const result = {
            ...error,
            name: error.name,
            message: error.message,
            stack: error.stack,
            ...(error.cause !== undefined ? { cause: errorProperty(error.cause, seen) } : {}),
            ...(error instanceof AggregateError ? { errors: Array.from(error.errors, (item) => errorProperty(item, seen)) } : {}),
        };
        seen.delete(error);
        return result;
    }
    return { message: typeof error === 'string' ? error : inspect(error, {
        depth: null, maxArrayLength: null, maxStringLength: null,
    }) };
}
