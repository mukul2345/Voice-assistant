export interface SafeErrorDetails {
    readonly name: string;
    readonly code?: string;
    readonly stack?: string;
}

/** Converts an unknown failure into metadata that excludes provider payloads and messages. */
export function toSafeError(error: unknown): SafeErrorDetails {
    if (!(error instanceof Error)) {
        return { name: 'UnknownError' };
    }

    const errorWithCode = error as Error & { code?: unknown };
    const code = typeof errorWithCode.code === 'string' ? errorWithCode.code : undefined;
    const stack = error.stack
        ?.split('\n')
        .slice(1, 8)
        .map((line) => line.trim())
        .join('\n');

    return {
        name: error.name || 'Error',
        code,
        stack: stack || undefined,
    };
}
