/**
 * The Generate sheet's network layer: the request that starts a run. A plain function over an
 * injected `fetch`, so every response and outcome is testable without a network. Following the run
 * is the run indicator's work (scripts/runStatus.ts).
 */
import { isSiteAnswer, withErrorRef } from "../../lib/errorRef";
import type { GenerateRequest } from "../../types/contracts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ClientDeps {
  fetch: FetchLike;
  isOnline: () => boolean;
}

export type StartRejection =
  | "offline"
  | "cooldown"
  | "dailyCap"
  | "unavailable"
  | "invalid"
  | "network";

export type StartResult =
  | { kind: "started"; runId: number; startedAt: string; request: GenerateRequest }
  | { kind: "rejected"; reason: StartRejection; message: string; retryAfterSeconds?: number };

export const MESSAGES = {
  offline: "You are offline. Reconnect, then try again.",
  // The server logged why; the reference it sent is added to this (lib/errorRef.ts).
  unavailable: "The server ran into a problem, so no briefing was started.",
  crashed:
    "The server crashed before it could answer, so nothing changed. Its log on Vercel has the error.",
  invalid: "The server turned that request down. Reload the page and try again.",
  network: "Couldn't reach the site. Check your connection, then try again.",
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
  deps: ClientDeps,
  feedback = "",
  topics?: readonly string[],
): Promise<StartResult> {
  if (!deps.isOnline()) return { kind: "rejected", reason: "offline", message: MESSAGES.offline };

  const note = feedback.trim();
  // On a briefing's page the new digest replaces that briefing (HeroMenu.astro names it); anywhere
  // else, a toast's Details for one, it is a new briefing.
  const replace =
    typeof document === "undefined"
      ? undefined
      : document.querySelector<HTMLElement>("[data-briefing]")?.dataset.briefing;
  const request: GenerateRequest = {
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
        request,
      };
    }
    case 400:
      return { kind: "rejected", reason: "invalid", message: MESSAGES.invalid };
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
      return {
        kind: "rejected",
        reason: "unavailable",
        message: isSiteAnswer(body) ? withErrorRef(MESSAGES.unavailable, body) : MESSAGES.crashed,
      };
  }
}
