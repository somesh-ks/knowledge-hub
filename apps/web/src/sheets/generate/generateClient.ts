/**
 * The Generate sheet's network layer. Plain functions over an injected `fetch`, so every response
 * and outcome is testable without a network.
 */
import { PASSPHRASE_REQUIRED } from "../../lib/access";
import type { GenerateRequest, StatusResponse } from "../../types/contracts";
import { GENERATE_STEPS } from "../../types/contracts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ClientDeps {
  fetch: FetchLike;
  isOnline: () => boolean;
}

export type StartRejection =
  | "empty"
  | "offline"
  | "wrongPassphrase"
  | "cooldown"
  | "dailyCap"
  | "unavailable"
  | "invalid"
  | "network";

export type StartResult =
  | { kind: "started"; runId: number; startedAt: string }
  | { kind: "rejected"; reason: StartRejection; message: string; retryAfterSeconds?: number };

export const MESSAGES = {
  empty: PASSPHRASE_REQUIRED
    ? "Enter the passphrase to continue."
    : "Generate refused that request. Try again in a few minutes.",
  offline: "You are offline. Reconnect, then try again.",
  wrongPassphrase: PASSPHRASE_REQUIRED
    ? "That passphrase does not match. Check it and try again."
    : "Generate refused that request. Try again in a few minutes.",
  unavailable: "Generate is not available right now. Try again in a few minutes.",
  invalid: "That request did not go through. Reload the page and try again.",
  network: "The request did not go through. Check your connection, then try again.",
} as const;

function pluralize(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** "5 hours 12 minutes", "40 minutes", "less than a minute". Rounds minutes up so it is never early. */
export function formatRetryAfter(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "a moment";
  const totalMinutes = Math.ceil(seconds / 60);
  if (seconds < 60) return "less than a minute";
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(pluralize(days, "day"));
  if (hours > 0) parts.push(pluralize(hours, "hour"));
  // Past a day, minutes are noise.
  if (minutes > 0 && days === 0) parts.push(pluralize(minutes, "minute"));
  return parts.join(" ");
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await response.json();
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function retryAfterSeconds(body: Record<string, unknown> | null, response: Response): number {
  const fromBody = body?.retry_after_s;
  if (typeof fromBody === "number" && Number.isFinite(fromBody)) return fromBody;
  const header = Number(response.headers.get("retry-after"));
  return Number.isFinite(header) ? header : 0;
}

/**
 * POST /api/generate. The HTTP status carries the outcome; the body adds detail. A 202 is the only
 * success, and it needs a numeric run id, because without one there is nothing to poll.
 */
export async function startGenerate(
  passphrase: string,
  deps: ClientDeps,
  feedback = "",
  topics?: readonly string[],
): Promise<StartResult> {
  const trimmed = passphrase.trim();
  if (!trimmed) return { kind: "rejected", reason: "empty", message: MESSAGES.empty };
  if (!deps.isOnline()) return { kind: "rejected", reason: "offline", message: MESSAGES.offline };

  const note = feedback.trim();
  // On a briefing's page the new digest replaces that briefing (HeroMenu.astro names it); anywhere
  // else, a toast's Details for one, it is a new briefing.
  const replace =
    typeof document === "undefined"
      ? undefined
      : document.querySelector<HTMLElement>("[data-briefing]")?.dataset.briefing;
  const request: GenerateRequest = {
    passphrase: trimmed,
    ...(note ? { feedback: note } : {}),
    ...(topics && replace ? { topics: [...topics] } : {}),
    ...(replace ? { replace } : {}),
  };
  let response: Response;
  try {
    response = await deps.fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    return { kind: "rejected", reason: "network", message: MESSAGES.network };
  }

  const body = await readJson(response);
  switch (response.status) {
    case 202: {
      const runId = body?.run_id;
      const startedAt = body?.started_at;
      if (typeof runId !== "number" || !Number.isFinite(runId)) {
        return { kind: "rejected", reason: "unavailable", message: MESSAGES.unavailable };
      }
      return {
        kind: "started",
        runId,
        startedAt: typeof startedAt === "string" ? startedAt : new Date().toISOString(),
      };
    }
    case 400:
      return { kind: "rejected", reason: "invalid", message: MESSAGES.invalid };
    case 401:
      return { kind: "rejected", reason: "wrongPassphrase", message: MESSAGES.wrongPassphrase };
    case 429: {
      const seconds = retryAfterSeconds(body, response);
      const wait = formatRetryAfter(seconds);
      if (body?.error === "daily_cap") {
        return {
          kind: "rejected",
          reason: "dailyCap",
          message: `Generate has reached its limit for today. Try again in ${wait}.`,
          retryAfterSeconds: seconds,
        };
      }
      return {
        kind: "rejected",
        reason: "cooldown",
        message: `Generate is on cooldown. Try again in ${wait}.`,
        retryAfterSeconds: seconds,
      };
    }
    default:
      return { kind: "rejected", reason: "unavailable", message: MESSAGES.unavailable };
  }
}

export type StatusResult =
  | { kind: "ok"; status: StatusResponse }
  /** The run id is unknown to the server: the sheet should stop asking. */
  | { kind: "unknown" }
  /** A hiccup worth retrying with backoff: network, throttling, a server error. */
  | { kind: "transient" };

const STEP_SET: ReadonlySet<string> = new Set(GENERATE_STEPS);
const STATES: ReadonlySet<string> = new Set(["queued", "running", "completed"]);
const OUTCOMES: ReadonlySet<string> = new Set(["published", "nothing", "gated", "failed"]);

export function parseStatus(body: Record<string, unknown> | null): StatusResponse | null {
  if (!body) return null;
  const { run_id: runId, state, step, outcome } = body;
  if (typeof runId !== "number" || typeof state !== "string" || !STATES.has(state)) return null;
  if (step !== null && step !== undefined && (typeof step !== "string" || !STEP_SET.has(step))) {
    return null;
  }
  if (outcome !== undefined && (typeof outcome !== "string" || !OUTCOMES.has(outcome))) return null;
  const result: StatusResponse = {
    run_id: runId,
    state: state as StatusResponse["state"],
    step: (step ?? null) as StatusResponse["step"],
  };
  if (typeof outcome === "string") result.outcome = outcome as StatusResponse["outcome"];
  if (typeof body.digest_id === "string") result.digest_id = body.digest_id;
  if (typeof body.run_url === "string") result.run_url = body.run_url;
  return result;
}

/** GET /api/status?run=<id>. */
export async function fetchStatus(runId: number, deps: ClientDeps): Promise<StatusResult> {
  let response: Response;
  try {
    response = await deps.fetch(`/api/status?run=${encodeURIComponent(String(runId))}`, {
      headers: { accept: "application/json" },
    });
  } catch {
    return { kind: "transient" };
  }
  if (response.status === 404 || response.status === 400) return { kind: "unknown" };
  if (!response.ok) return { kind: "transient" };
  const status = parseStatus(await readJson(response));
  return status ? { kind: "ok", status } : { kind: "transient" };
}
