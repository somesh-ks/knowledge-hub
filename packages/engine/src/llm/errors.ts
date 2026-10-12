import { redact } from "../context.js";

/** Raised when the run would pass MAX_TOKENS_PER_RUN. Never retried, never swallowed per item. */
export class BudgetExceededError extends Error {
  readonly limit: number;
  readonly used: number;
  readonly estimate: number;

  constructor(limit: number, used: number, estimate: number) {
    super(
      `Token budget exceeded: ${used} used plus about ${estimate} requested would pass the limit of ${limit} (MAX_TOKENS_PER_RUN).`,
    );
    this.name = "BudgetExceededError";
    this.limit = limit;
    this.used = used;
    this.estimate = estimate;
  }
}

/** A call's time ran out before it could be sent or retried. Never retried. */
export class DeadlineExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeadlineExceededError";
  }
}

/** The model answered, but not in the shape we asked for, even after one corrective retry. */
export class LlmOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmOutputError";
  }
}

/** HTTP status carried by an SDK error, if any. Both SDKs expose it as `status`. */
export function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

const MAX_MESSAGE_CHARS = 240;

/**
 * One-line description of a failure that is safe to log or persist. Authentication failures
 * use fixed wording because provider messages can echo part of a credential.
 */
export function describeError(error: unknown, secrets: readonly string[] = []): string {
  const status = errorStatus(error);
  if (status === 401 || status === 403) {
    return `Authentication failed (HTTP ${status}). Check the API key in .env.`;
  }
  const name = error instanceof Error ? error.name : "Error";
  // Redact first: truncating first could cut a key in half and leave a readable prefix.
  const raw = redact(error instanceof Error ? error.message : String(error), secrets);
  const message = raw.length > MAX_MESSAGE_CHARS ? `${raw.slice(0, MAX_MESSAGE_CHARS)}...` : raw;
  const head = status === undefined ? name : `${name} (HTTP ${status})`;
  return `${head}: ${message}`;
}
