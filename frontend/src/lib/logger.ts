import {
    configureSync,
    getConsoleSink,
    getLogger,
    type LogLevel,
} from '@logtape/logtape';

// VITE_LOG_LEVEL overrides the default threshold (debug in development,
// info in production) for every logger under the ["labs", "frontend"] root.
function resolveLevel(): LogLevel {
    const raw = import.meta.env.VITE_LOG_LEVEL?.trim().toLowerCase();
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
    return import.meta.env.DEV ? 'debug' : 'info';
}

// Configure LogTape synchronously before React renders: import this module
// first in main.tsx so early log records are not lost. Browsers only get the
// console sink (the file sink from @logtape/file is Node/Bun-only).
configureSync({
    sinks: {
        console: getConsoleSink(),
    },
    loggers: [
        {
            category: ['labs', 'frontend'],
            lowestLevel: resolveLevel(),
            sinks: ['console'],
        },
        // Meta logger surfaces LogTape's own configuration problems.
        {
            category: ['logtape', 'meta'],
            lowestLevel: 'warning',
            sinks: ['console'],
        },
    ],
});

export { getLogger };
