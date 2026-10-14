import {
    configureSync,
    defaultConsoleFormatter,
    getConsoleSink,
    getLogger,
    type LogLevel,
} from '@logtape/logtape';

// Request traces are opt-in via VITE_LOG_LEVEL=debug.
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
    return 'info';
}

// Configure LogTape synchronously before React renders: import this module
// first in main.tsx so early log records are not lost. Browsers only get the
// console sink (the file sink from @logtape/file is Node/Bun-only).
configureSync({
    sinks: {
        console: getConsoleSink({
            formatter: (record) => {
                const summary = defaultConsoleFormatter(record);
                return ['warning', 'error', 'fatal'].includes(record.level)
                    ? [...summary, record.properties]
                    : summary;
            },
        }),
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
