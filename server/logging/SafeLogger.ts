import { toSafeError } from './SafeError';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogMetadata = Readonly<Record<string, unknown>>;
export type LogSink = (serializedEntry: string) => void;

const REDACTED = '[REDACTED]';
const SENSITIVE_KEYS = [
    'authorization',
    'cookie',
    'accesstoken',
    'refreshtoken',
    'password',
    'apikey',
    'transcription',
    'airesponse',
    'resumetext',
    'prompt',
    'response',
    'email',
    'rawbody',
];

function isSensitiveKey(key: string): boolean {
    const normalizedKey = key.replace(/[^a-z]/gi, '').toLowerCase();
    return SENSITIVE_KEYS.some((sensitiveKey) => normalizedKey.includes(sensitiveKey));
}

function redactString(value: string): string {
    return value
        .replace(/Bearer\s+[^\s]+/gi, `Bearer ${REDACTED}`)
        .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
        .replace(/\b(?:sk|gsk|whsec)_[A-Za-z0-9_-]+\b/g, REDACTED)
        .replace(/\b[a-f0-9]{64,}\b/gi, REDACTED);
}

function sanitizeValue(value: unknown, key: string, visited: WeakSet<object>): unknown {
    if (isSensitiveKey(key)) {
        return REDACTED;
    }

    if (value instanceof Error) {
        return toSafeError(value);
    }

    if (typeof value === 'string') {
        return redactString(value);
    }

    if (value === null || typeof value !== 'object') {
        return value;
    }

    if (visited.has(value)) {
        return '[CIRCULAR]';
    }
    visited.add(value);

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeValue(item, key, visited));
    }

    return Object.fromEntries(
        Object.entries(value).map(([entryKey, entryValue]) => [
            entryKey,
            sanitizeValue(entryValue, entryKey, visited),
        ]),
    );
}

/** Removes credentials, private interview content, and cyclic references from log metadata. */
export function sanitizeMetadata(metadata: LogMetadata = {}): Record<string, unknown> {
    return sanitizeValue(metadata, 'metadata', new WeakSet<object>()) as Record<string, unknown>;
}

/** Metadata-only structured logger with centralized redaction. */
export class SafeLogger {
    private readonly sink: LogSink;

    public constructor(sink: LogSink = (entry) => console.log(entry)) {
        this.sink = sink;
    }

    public debug(message: string, metadata: LogMetadata = {}): void {
        this.write('debug', message, metadata);
    }

    public info(message: string, metadata: LogMetadata = {}): void {
        this.write('info', message, metadata);
    }

    public warn(message: string, metadata: LogMetadata = {}): void {
        this.write('warn', message, metadata);
    }

    public error(message: string, metadata: LogMetadata = {}): void {
        this.write('error', message, metadata);
    }

    private write(level: LogLevel, message: string, metadata: LogMetadata): void {
        this.sink(JSON.stringify({
            timestamp: new Date().toISOString(),
            level,
            message: redactString(message),
            metadata: sanitizeMetadata(metadata),
        }));
    }
}

export const logger = new SafeLogger();
