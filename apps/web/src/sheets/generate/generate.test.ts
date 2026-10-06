import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "../../player/core/testing";
import type { GenerateCueKind } from "../../player/sound/soundMap";
import type { StatusResponse } from "../../types/contracts";
import {
  type FetchLike,
  fetchStatus,
  formatRetryAfter,
  MESSAGES,
  parseStatus,
  startGenerate,
} from "./generateClient";
import { buildStepViews, failureTitle, STEP_LABELS, stepAnnouncement } from "./generateSteps";
import {
  BACKGROUND_POLL_MS,
  createGenerateStore,
  type FinishedRun,
  FOREGROUND_POLL_MS,
  MAX_CONSECUTIVE_FAILURES,
  MAX_POLL_MS,
  RUN_MAX_AGE_MS,
  RUN_STORAGE_KEY,
} from "./generateStore";

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
  it("posts the passphrase as GenerateRequest and returns the run on 202", async () => {
    const { fetch, calls } = scriptedFetch(
      json(202, { run_id: 4242, started_at: "2026-10-07T07:13:00Z" }),
    );
    const result = await startGenerate("  correct horse ", { fetch, isOnline: online });
    expect(result).toEqual({ kind: "started", runId: 4242, startedAt: "2026-10-07T07:13:00Z" });
    expect(calls[0]?.url).toBe("/api/generate");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ passphrase: "correct horse" });
  });

  it("refuses an empty passphrase without a request", async () => {
    const { fetch, calls } = scriptedFetch();
    const result = await startGenerate("   ", { fetch, isOnline: online });
    expect(result).toMatchObject({ kind: "rejected", reason: "empty", message: MESSAGES.empty });
    expect(calls).toHaveLength(0);
  });

  it("says so when offline, without a request", async () => {
    const { fetch, calls } = scriptedFetch();
    const result = await startGenerate("x", { fetch, isOnline: () => false });
    expect(result).toMatchObject({
      reason: "offline",
      message: "You are offline. Reconnect, then try again.",
    });
    expect(calls).toHaveLength(0);
  });

  it("explains a wrong passphrase on 401", async () => {
    const { fetch } = scriptedFetch(json(401, { error: "wrong_passphrase" }));
    expect(await startGenerate("nope", { fetch, isOnline: online })).toMatchObject({
      reason: "wrongPassphrase",
      message: "That passphrase does not match. Check it and try again.",
    });
  });

  it("gives the time remaining on a cooldown", async () => {
    const { fetch } = scriptedFetch(
      json(429, { error: "cooldown", retry_after_s: 5 * 3600 + 12 * 60 }),
    );
    expect(await startGenerate("x", { fetch, isOnline: online })).toMatchObject({
      reason: "cooldown",
      message: "Generate is on cooldown. Try again in 5 hours 12 minutes.",
      retryAfterSeconds: 18_720,
    });
  });

  it("explains the daily cap and falls back to the Retry-After header", async () => {
    const { fetch } = scriptedFetch(json(429, { error: "daily_cap" }, { "retry-after": "7200" }));
    expect(await startGenerate("x", { fetch, isOnline: online })).toMatchObject({
      reason: "dailyCap",
      message: "Generate has reached its limit for today. Try again in 2 hours.",
    });
  });

  it("explains an unavailable service on 503 and any unexpected status", async () => {
    const { fetch } = scriptedFetch(json(503, { error: "unavailable" }), json(500, {}));
    expect(await startGenerate("x", { fetch, isOnline: online })).toMatchObject({
      reason: "unavailable",
      message: MESSAGES.unavailable,
    });
    expect(await startGenerate("x", { fetch, isOnline: online })).toMatchObject({
      reason: "unavailable",
    });
  });

  it("explains a rejected request on 400", async () => {
    const { fetch } = scriptedFetch(json(400, { error: "invalid_request" }));
    expect(await startGenerate("x", { fetch, isOnline: online })).toMatchObject({
      reason: "invalid",
    });
  });

  it("treats a network failure as a retryable error", async () => {
    const { fetch } = scriptedFetch(new TypeError("Failed to fetch"));
    expect(await startGenerate("x", { fetch, isOnline: online })).toMatchObject({
      reason: "network",
      message: MESSAGES.network,
    });
  });

  it("does not trust a 202 without a run id", async () => {
    const { fetch } = scriptedFetch(json(202, { started_at: "now" }));
    expect(await startGenerate("x", { fetch, isOnline: online })).toMatchObject({
      reason: "unavailable",
    });
  });

  it("keeps every message in the voice: no em dashes, no exclamation marks", () => {
    for (const message of Object.values(MESSAGES)) expect(message).not.toMatch(/[\u2014\u2013!]/);
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

describe("status endpoint", () => {
  it("parses a running and a completed run", () => {
    expect(parseStatus({ run_id: 9, state: "running", step: "writing" })).toEqual({
      run_id: 9,
      state: "running",
      step: "writing",
    });
    expect(
      parseStatus({
        run_id: 9,
        state: "completed",
        step: "publishing",
        outcome: "published",
        digest_id: "2026-10-07",
        run_url: "https://github.com/x/y/actions/runs/9",
      }),
    ).toMatchObject({ outcome: "published", digest_id: "2026-10-07" });
  });

  it("rejects a body the sheet cannot trust", () => {
    expect(parseStatus(null)).toBeNull();
    expect(parseStatus({ run_id: "9", state: "running" })).toBeNull();
    expect(parseStatus({ run_id: 9, state: "sleeping" })).toBeNull();
    expect(parseStatus({ run_id: 9, state: "running", step: "baking" })).toBeNull();
    expect(parseStatus({ run_id: 9, state: "completed", outcome: "perfect" })).toBeNull();
  });

  it("separates an unknown run from a hiccup", async () => {
    const { fetch, calls } = scriptedFetch(
      json(200, { run_id: 9, state: "queued", step: null }),
      json(404, {}),
      json(503, {}),
      json(200, { nonsense: true }),
      new TypeError("offline"),
    );
    expect(await fetchStatus(9, { fetch, isOnline: online })).toMatchObject({ kind: "ok" });
    expect(calls[0]?.url).toBe("/api/status?run=9");
    expect(await fetchStatus(9, { fetch, isOnline: online })).toEqual({ kind: "unknown" });
    expect(await fetchStatus(9, { fetch, isOnline: online })).toEqual({ kind: "transient" });
    expect(await fetchStatus(9, { fetch, isOnline: online })).toEqual({ kind: "transient" });
    expect(await fetchStatus(9, { fetch, isOnline: online })).toEqual({ kind: "transient" });
  });
});

describe("step mapping", () => {
  it("draws six steps in the rail's grammar with the state always written out", () => {
    const views = buildStepViews("running", "writing", null);
    expect(views.map((view) => [view.label, view.state, view.stateWord])).toEqual([
      ["Waiting for a slot", "done", "Done"],
      ["Reading sources", "done", "Done"],
      ["Judging", "done", "Done"],
      ["Writing", "active", "In progress"],
      ["Checking", "pending", ""],
      ["Publishing", "pending", ""],
    ]);
  });

  it("reads a queued run as waiting for a slot", () => {
    const views = buildStepViews("running", null, null);
    expect(views[0]).toMatchObject({ state: "active", stateWord: "In progress" });
    expect(views.slice(1).every((view) => view.state === "pending")).toBe(true);
  });

  it("marks every step done for a published run and for nothing to publish", () => {
    for (const phase of ["published", "nothing", "gated"] as const) {
      expect(buildStepViews(phase, "publishing", null).every((view) => view.state === "done")).toBe(
        true,
      );
    }
  });

  it("fails the step that was active and leaves the rest pending", () => {
    const views = buildStepViews("failed", "writing", "writing");
    expect(views.map((view) => view.state)).toEqual([
      "done",
      "done",
      "done",
      "failed",
      "pending",
      "pending",
    ]);
    expect(views[3]?.stateWord).toBe("Failed");
  });

  it("titles a failure by its step and announces steps politely", () => {
    expect(failureTitle("writing")).toBe("The run failed while writing");
    expect(failureTitle(null)).toBe("The run failed");
    expect(stepAnnouncement("waiting", true)).toBe("Generating. Waiting for a slot.");
    expect(stepAnnouncement("reading", false)).toBe("Reading sources.");
    expect(Object.values(STEP_LABELS)).toHaveLength(6);
  });
});

describe("the Generate store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(...responses: Array<Response | Error>) {
    const scripted = scriptedFetch(...responses);
    const storage = new MemoryStorage();
    const cues: GenerateCueKind[] = [];
    const announcements: string[] = [];
    const finished: FinishedRun[] = [];
    const clock = { now: 1_000_000 };
    const store = createGenerateStore({
      fetch: scripted.fetch,
      isOnline: online,
      storage,
      now: () => clock.now,
      isHidden: () => false,
      onCue: (kind) => cues.push(kind),
      onAnnounce: (message) => announcements.push(message),
      onFinishedWhileClosed: (run) => finished.push(run),
    });
    store.setSheetOpen(true);
    return { store, storage, cues, announcements, finished, calls: scripted.calls, clock };
  }

  const queued = () => json(200, { run_id: 7, state: "queued", step: null });
  const at = (step: string) => json(200, { run_id: 7, state: "running", step });
  const done = (outcome: string, extra: Record<string, unknown> = {}, step = "publishing") =>
    json(200, { run_id: 7, state: "completed", step, outcome, ...extra });
  const accepted = () => json(202, { run_id: 7, started_at: "2026-10-07T07:13:00Z" });

  it("starts a run, announces it, remembers the run id and plays the start cue", async () => {
    const { store, storage, cues, announcements } = setup(accepted());
    await store.submit("secret");
    expect(store.getState()).toMatchObject({ phase: "running", runId: 7, fieldError: null });
    expect(cues).toEqual(["started"]);
    expect(announcements).toEqual(["Generating. Waiting for a slot."]);
    expect(JSON.parse(storage.getItem(RUN_STORAGE_KEY) ?? "{}")).toMatchObject({ runId: 7 });
  });

  it("shows the server's reason inline and plays the error cue when the start is rejected", async () => {
    const { store, cues } = setup(json(401, { error: "wrong_passphrase" }));
    await store.submit("nope");
    expect(store.getState()).toMatchObject({
      phase: "idle",
      fieldError: "That passphrase does not match. Check it and try again.",
    });
    expect(cues).toEqual(["failed"]);
  });

  it("polls every three seconds while the sheet is open and walks the steps", async () => {
    const { store, calls, announcements } = setup(
      accepted(),
      queued(),
      at("reading"),
      at("judging"),
    );
    await store.submit("secret");
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    expect(calls).toHaveLength(2);
    expect(store.getState().step).toBeNull();
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    expect(store.getState().step).toBe("reading");
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    expect(store.getState().step).toBe("judging");
    expect(announcements.slice(-2)).toEqual(["Reading sources.", "Judging."]);
  });

  it("finishes as published with the digest, plays the finished cue and stops polling", async () => {
    const { store, cues, calls, announcements } = setup(
      accepted(),
      done("published", { digest_id: "2026-10-07", run_url: "https://example.test/run/7" }),
    );
    await store.submit("secret");
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    expect(store.getState()).toMatchObject({
      phase: "published",
      digestId: "2026-10-07",
      runUrl: "https://example.test/run/7",
    });
    expect(cues).toEqual(["started", "finished"]);
    expect(announcements.at(-1)).toBe("Briefing ready.");
    const requests = calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(requests);
  });

  it("finishes as nothing to publish, quietly: no cue", async () => {
    const { store, cues, announcements } = setup(accepted(), done("nothing"));
    await store.submit("secret");
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    expect(store.getState().phase).toBe("nothing");
    expect(cues).toEqual(["started"]);
    expect(announcements.at(-1)).toBe("Nothing cleared the bar.");
  });

  it("finishes as gated without a cue", async () => {
    const { store, cues } = setup(accepted(), done("gated"));
    await store.submit("secret");
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    expect(store.getState().phase).toBe("gated");
    expect(cues).toEqual(["started"]);
  });

  it("finishes as failed at the step that was active, with the run link", async () => {
    const { store, cues, announcements } = setup(
      accepted(),
      at("writing"),
      done("failed", { run_url: "https://example.test/run/7" }, "writing"),
    );
    await store.submit("secret");
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    expect(store.getState()).toMatchObject({
      phase: "failed",
      failedAt: "writing",
      runUrl: "https://example.test/run/7",
    });
    expect(cues).toEqual(["started", "failed"]);
    expect(announcements.at(-1)).toBe("The run failed while writing.");
  });

  it("backs off when the status endpoint hiccups, and recovers", async () => {
    const { store, calls } = setup(accepted(), json(503, {}), json(503, {}), at("reading"));
    await store.submit("secret");
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS * 1.5 - 1);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS * 2.25);
    expect(store.getState().step).toBe("reading");
    expect(store.getState().lostContact).toBe(false);
  });

  it("gives up with a visible state after repeated failures, and checks again on request", async () => {
    const failures = Array.from({ length: MAX_CONSECUTIVE_FAILURES }, () => json(503, {}));
    const { store, calls } = setup(accepted(), ...failures, at("judging"));
    await store.submit("secret");
    await vi.advanceTimersByTimeAsync(MAX_POLL_MS * MAX_CONSECUTIVE_FAILURES);
    expect(store.getState().lostContact).toBe(true);
    const requests = calls.length;
    await vi.advanceTimersByTimeAsync(MAX_POLL_MS * 3);
    expect(calls).toHaveLength(requests);
    store.checkNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getState()).toMatchObject({ lostContact: false, step: "judging" });
  });

  it("forgets a run the server does not know", async () => {
    const { store, storage } = setup(accepted(), json(404, {}));
    await store.submit("secret");
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    expect(store.getState().phase).toBe("idle");
    expect(storage.getItem(RUN_STORAGE_KEY)).toBeNull();
  });

  it("slows to a background check when the sheet closes, and speeds up again on reopen", async () => {
    const { store, calls } = setup(accepted(), at("reading"), at("judging"), at("writing"));
    await store.submit("secret");
    store.setSheetOpen(false);
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS * 2);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(BACKGROUND_POLL_MS);
    expect(calls).toHaveLength(2);
    store.setSheetOpen(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    expect(calls).toHaveLength(4);
  });

  it("reports a run that finishes while the sheet is closed, once", async () => {
    const { store, finished } = setup(accepted(), done("published", { digest_id: "2026-10-07" }));
    await store.submit("secret");
    store.setSheetOpen(false);
    await vi.advanceTimersByTimeAsync(BACKGROUND_POLL_MS);
    expect(finished).toEqual([{ phase: "published", digestId: "2026-10-07", runUrl: null }]);
    store.setSheetOpen(true);
    expect(store.getState().phase).toBe("published");
    store.setSheetOpen(false);
    expect(store.getState().phase).toBe("idle");
    expect(finished).toHaveLength(1);
  });

  it("clears a finished run when the sheet that showed it closes", async () => {
    const { store, finished } = setup(accepted(), done("nothing"));
    await store.submit("secret");
    await vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    expect(store.getState().phase).toBe("nothing");
    store.setSheetOpen(false);
    expect(store.getState().phase).toBe("idle");
    expect(finished).toEqual([]);
  });

  it("resumes a remembered run when the sheet opens, and drops one that is too old", async () => {
    const first = setup(at("checking"));
    first.storage.setItem(
      RUN_STORAGE_KEY,
      JSON.stringify({ runId: 7, startedAt: first.clock.now - 60_000 }),
    );
    first.store.setSheetOpen(false);
    first.store.setSheetOpen(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(first.store.getState()).toMatchObject({ phase: "running", runId: 7, step: "checking" });

    const stale = setup();
    stale.storage.setItem(
      RUN_STORAGE_KEY,
      JSON.stringify({ runId: 7, startedAt: stale.clock.now - RUN_MAX_AGE_MS - 1 }),
    );
    stale.store.setSheetOpen(false);
    stale.store.setSheetOpen(true);
    expect(stale.store.getState().phase).toBe("idle");
    expect(stale.calls).toHaveLength(0);
  });

  it("ignores a second submit while a run is active", async () => {
    const { store, calls } = setup(accepted());
    await store.submit("secret");
    await store.submit("secret");
    expect(calls.filter((call) => call.url === "/api/generate")).toHaveLength(1);
  });

  it("ignores an answer that arrives after a reset", async () => {
    const { store } = setup(accepted(), at("reading"));
    await store.submit("secret");
    const pending = vi.advanceTimersByTimeAsync(FOREGROUND_POLL_MS);
    store.reset();
    await pending;
    expect(store.getState().phase).toBe("idle");
    expect(store.getState().step).toBeNull();
  });

  it("stops every timer on dispose", async () => {
    const { store } = setup(accepted());
    await store.submit("secret");
    store.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("survives storage that throws", async () => {
    const scripted = scriptedFetch(accepted());
    const storage = new MemoryStorage();
    storage.throwOnWrite = true;
    const store = createGenerateStore({ fetch: scripted.fetch, isOnline: online, storage });
    store.setSheetOpen(true);
    await store.submit("secret");
    expect(store.getState().phase).toBe("running");
    store.dispose();
  });
});

describe("status types", () => {
  it("accepts the contract's own StatusResponse shape", () => {
    const sample: StatusResponse = {
      run_id: 1,
      state: "completed",
      step: "publishing",
      outcome: "nothing",
    };
    expect(parseStatus(sample as unknown as Record<string, unknown>)).toMatchObject(sample);
  });
});
