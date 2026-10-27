import { describe, expect, it } from "vitest";
import { type FetchLike, formatRetryAfter, MESSAGES, startGenerate } from "./generateClient";

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A fetch whose answers are queued in order, recording every request. */
function scriptedFetch(...responses: Array<Response | Error>): {
  fetch: FetchLike;
  calls: Array<{ url: string; init?: RequestInit }>;
} {
  const queue = [...responses];
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const next = queue.shift();
      if (!next) throw new Error("no scripted response left");
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const online = () => true;

describe("startGenerate", () => {
  it("posts a GenerateRequest and returns the run on 202", async () => {
    const { fetch, calls } = scriptedFetch(
      json(202, { run_id: 4242, started_at: "2026-10-07T07:13:00Z" }),
    );
    const result = await startGenerate({ fetch, isOnline: online });
    // The request travels with the run, so the run indicator can send it again (Try again).
    expect(result).toEqual({
      kind: "started",
      runId: 4242,
      startedAt: "2026-10-07T07:13:00Z",
      request: {},
    });
    expect(calls[0]?.url).toBe("/api/generate");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({});
  });

  it("says so when offline, without a request", async () => {
    const { fetch, calls } = scriptedFetch();
    const result = await startGenerate({ fetch, isOnline: () => false });
    expect(result).toMatchObject({
      reason: "offline",
      message: "You are offline. Reconnect, then try again.",
    });
    expect(calls).toHaveLength(0);
  });

  it("gives the time remaining on a cooldown", async () => {
    const { fetch } = scriptedFetch(
      json(429, { error: "cooldown", retry_after_s: 5 * 3600 + 12 * 60 }),
    );
    expect(await startGenerate({ fetch, isOnline: online })).toMatchObject({
      reason: "cooldown",
      message: "Generate is on cooldown. Try again in 5 hours 12 minutes.",
      retryAfterSeconds: 18_720,
    });
  });

  it("explains the daily cap and falls back to the Retry-After header", async () => {
    const { fetch } = scriptedFetch(json(429, { error: "daily_cap" }, { "retry-after": "7200" }));
    expect(await startGenerate({ fetch, isOnline: online })).toMatchObject({
      reason: "dailyCap",
      message: "Generate has reached its limit for today. Try again in 2 hours.",
    });
  });

  it("explains an unavailable service on 503 and any unexpected status", async () => {
    const { fetch } = scriptedFetch(json(503, { error: "unavailable" }), json(500, {}));
    expect(await startGenerate({ fetch, isOnline: online })).toMatchObject({
      reason: "unavailable",
      message: MESSAGES.unavailable,
    });
    expect(await startGenerate({ fetch, isOnline: online })).toMatchObject({
      reason: "unavailable",
    });
  });

  it("explains a rejected request on 400", async () => {
    const { fetch } = scriptedFetch(json(400, { error: "invalid_request" }));
    expect(await startGenerate({ fetch, isOnline: online })).toMatchObject({
      reason: "invalid",
    });
  });

  it("treats a network failure as a retryable error", async () => {
    const { fetch } = scriptedFetch(new TypeError("Failed to fetch"));
    expect(await startGenerate({ fetch, isOnline: online })).toMatchObject({
      reason: "network",
      message: MESSAGES.network,
    });
  });

  it("does not trust a 202 without a run id", async () => {
    const { fetch } = scriptedFetch(json(202, { started_at: "now" }));
    expect(await startGenerate({ fetch, isOnline: online })).toMatchObject({
      reason: "unavailable",
    });
  });
});

describe("formatRetryAfter", () => {
  it("writes hours and minutes, rounding minutes up", () => {
    expect(formatRetryAfter(18_720)).toBe("5 hours 12 minutes");
    expect(formatRetryAfter(3_600)).toBe("1 hour");
    expect(formatRetryAfter(61)).toBe("2 minutes");
    expect(formatRetryAfter(2_400)).toBe("40 minutes");
  });

  it("handles seconds, days and nonsense", () => {
    expect(formatRetryAfter(30)).toBe("less than a minute");
    expect(formatRetryAfter(26 * 3600 + 90)).toBe("1 day 2 hours");
    expect(formatRetryAfter(0)).toBe("a moment");
    expect(formatRetryAfter(Number.NaN)).toBe("a moment");
  });
});
