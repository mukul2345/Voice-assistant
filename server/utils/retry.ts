/**
 * Retry utility with exponential backoff and jitter.
 * Used for Groq API calls that may hit rate limits.
 */

import { logger } from '../logging/SafeLogger';

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableStatuses: number[];
}

const DEFAULT_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  retryableStatuses: [429, 500, 502, 503, 504],
};

/**
 * Execute a function with retry logic.
 * Retries on retryable errors with exponential backoff + jitter.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let lastError: unknown = new Error('Retry failed');

  for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      const { status, message, retryAfterSeconds } = inspectRetryError(error);
      const isRetryable =
        cfg.retryableStatuses.includes(status) ||
        message.includes('ECONNRESET') ||
        message.includes('ETIMEDOUT') ||
        message.includes('rate_limit');

      if (!isRetryable || attempt === cfg.maxAttempts - 1) {
        throw error;
      }

      const baseDelay = cfg.baseDelayMs * Math.pow(cfg.backoffMultiplier, attempt);
      const jitter = Math.random() * 500;
      const delay = Math.min(baseDelay + jitter, cfg.maxDelayMs);
      const retryAfterMs = retryAfterSeconds * 1000;
      const actualDelay = Math.max(delay, retryAfterMs);

      logger.warn('Retryable external request failed.', {
        attempt: attempt + 1,
        maxAttempts: cfg.maxAttempts,
        delayMs: Math.round(actualDelay),
        status,
      });

      await sleep(actualDelay);
    }
  }

  throw lastError;
}

interface RetryErrorMetadata {
  status: number;
  message: string;
  retryAfterSeconds: number;
}

function inspectRetryError(error: unknown): RetryErrorMetadata {
  if (!isRecord(error)) {
    return { status: 0, message: '', retryAfterSeconds: 0 };
  }

  const response = isRecord(error.response) ? error.response : undefined;
  const headers = isRecord(error.headers) ? error.headers : undefined;
  const statusValue = error.status ?? response?.status;
  const retryAfterValue = headers?.['retry-after'];
  const retryAfterSeconds = typeof retryAfterValue === 'string'
    ? Number.parseInt(retryAfterValue, 10)
    : 0;

  return {
    status: typeof statusValue === 'number' ? statusValue : 0,
    message: typeof error.message === 'string' ? error.message : '',
    retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
