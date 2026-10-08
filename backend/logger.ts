import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { getRotatingFileSink } from '@logtape/file';
import {
    configure,
    getAnsiColorFormatter,
    getConsoleSink,
    getJsonLinesFormatter,
    getLogger,
    type LogLevel,
} from '@logtape/logtape';

const isDevelopment = process.env.NODE_ENV !== 'production';
const logFilePath = process.env.LOG_FILE || 'logs/backend.log';

// LOG_LEVEL overrides the default threshold (debug in development, info in
// production) for every logger under the ["labs"] category root.
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
    return isDevelopment ? 'debug' : 'info';
}

// One-time LogTape setup for the backend: human-readable ANSI console output
// plus a rotating JSON-lines file for post-mortem analysis. All backend
// modules log under the ["labs"] category root, e.g. getLogger(["labs", "http"]).
export async function configureLogger(): Promise<void> {
    // The rotating file sink requires its directory to already exist.
    mkdirSync(path.dirname(logFilePath), { recursive: true });

    await configure({
        sinks: {
            console: getConsoleSink({
                formatter: getAnsiColorFormatter(),
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
export function errorProperty(error: unknown): Record<string, unknown> {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }
    return { message: String(error) };
}
