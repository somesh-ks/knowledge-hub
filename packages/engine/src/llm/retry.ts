import { BudgetExceededError, errorStatus } from "./errors.js";

export interface RetryOptions {
  /** Retries after the first attempt. */
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Injected so tests never wait. */
  sleep: (ms: number) => Promise<void>;
  /** 0 to 1. Injected so tests are deterministic. */
  random: () => number;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

export const DEFAULT_RETRY: RetryOptions = {
  retries: 4,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

/** A server-sent delay above this is ignored in favour of our own backoff. */
const MAX_SERVER_DELAY_MS = 30_000;

const RETRYABLE_ERROR_NAMES = new Set([
  "APIConnectionError",
  "APIConnectionTimeoutError",
  "APITimeoutError",
]);
const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
]);

/** Retry rate limits (429), overload (529), other 5xx, timeouts and dropped connections. */
export function isRetryable(error: unknown): boolean {
  if (error instanceof BudgetExceededError) return false;
  const status = errorStatus(error);
  if (status !== undefined) return status === 408 || status === 429 || status >= 500;
  if (typeof error !== "object" || error === null) return false;
  if (error instanceof Error && RETRYABLE_ERROR_NAMES.has(error.name)) return true;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && RETRYABLE_CODES.has(code);
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (typeof headers !== "object" || headers === null) return undefined;
  const getter = (headers as { get?: unknown }).get;
  if (typeof getter === "function") {
    const value: unknown = getter.call(headers, name);
    return typeof value === "string" ? value : undefined;
  }
  const value = (headers as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

/** Server-requested delay in ms from the SDK error, if it sent a usable one. */
export function serverDelayMs(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const direct = (error as { retryAfterMs?: unknown }).retryAfterMs;
  if (typeof direct === "number" && direct >= 0) return direct;
  const headers = (error as { headers?: unknown }).headers;
  const ms = Number(headerValue(headers, "retry-after-ms"));
  if (Number.isFinite(ms) && ms >= 0) return ms;
  const seconds = Number(headerValue(headers, "retry-after"));
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  return undefined;
}

/** Exponential backoff with jitter, replaced by the server's delay when it gives a sane one. */
export function backoffDelayMs(attempt: number, error: unknown, options: RetryOptions): number {
  const server = serverDelayMs(error);
  if (server !== undefined && server <= MAX_SERVER_DELAY_MS) return server;
  const exponential = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** attempt);
  const jitter = 1 - 0.25 * options.random();
  return Math.round(exponential * jitter);
}

/** Run `fn`, retrying only errors that `isRetryable` accepts. The last error is rethrown. */
export async function withRetry<T>(
  fn: (attempt: number) => PromiseLike<T>,
  overrides: Partial<RetryOptions> = {},
): Promise<T> {
  const options: RetryOptions = { ...DEFAULT_RETRY, ...overrides };
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= options.retries || !isRetryable(error)) throw error;
      const delayMs = backoffDelayMs(attempt, error, options);
      options.onRetry?.({ attempt: attempt + 1, delayMs, error });
      await options.sleep(delayMs);
    }
  }
}
