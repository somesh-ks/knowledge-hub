import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prewarmEpisode = vi.fn(async (_id: string) => undefined);
vi.mock("../narration/prewarmEpisode", () => ({ prewarmEpisode }));

const {
  fill,
  focusCreate,
  forgetRunAbout,
  readRun,
  refusal,
  resumeRun,
  SITE_POLL_MS,
  startRun,
  statusLine,
} = await import("./runStatus");

describe("the progress bar", () => {
  it("starts a new run (a Try again) from empty, and never goes back within one run", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const style = new Map<string, string>();
    const card = {
      dataset: {} as Record<string, string>,
      style: {
        getPropertyValue: (name: string) => style.get(name) ?? "",
        setProperty: (name: string, value: string) => style.set(name, value),
      },
      getBoundingClientRect: () => ({}),
    } as unknown as HTMLElement;
    fill(card, { id: 7, phase: "failed", stage: 2, stages: 4 });
    expect(Number(style.get("--run-to"))).toBeCloseTo(2 / 4);
    fill(card, { id: 7, phase: "running", stage: 1, stages: 4 });
    expect(Number(style.get("--run-to"))).toBeCloseTo(2 / 4);
    // Try again: run 8 is queued, with none of run 7's progress.
    fill(card, { id: 8, phase: "queued", stage: 0, stages: 4 });
    expect(Number(style.get("--run-to"))).toBe(0);
    vi.unstubAllGlobals();
  });
});

const OLD = { episode_at: "2020-01-01T00:00:00Z", episode_id: "old" };

/**
 * The last stage of a new episode: waiting for the redeployed site. A page with no indicator in
 * it is enough here, so the stand-ins are a local store, a document that finds nothing and fetch.
 */
function stubPage(id: number, episode: string) {
  const store = new Map<string, string>();
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const page = { store, requests, live: false };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  vi.stubGlobal("sessionStorage", { getItem: () => null, removeItem: () => undefined });
  vi.stubGlobal("document", {
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: { dataset: {} },
    dispatchEvent: () => true,
  });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    const body = page.live ? { episode_at: new Date().toISOString(), episode_id: episode } : OLD;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  store.set(
    "singularity:run",
    JSON.stringify({ id, phase: "updating", t0: Date.now(), stages: 4, stage: 3 }),
  );
  return page;
}

/** Lets the awaited fetch and its JSON settle between timer steps. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  prewarmEpisode.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("waiting for the redeployed site", () => {
  it("asks for /latest.json every few seconds, without a query string", async () => {
    const page = stubPage(7, "ep-20261011-1900");
    resumeRun();
    await settle();
    expect(page.requests).toHaveLength(1);
    expect(SITE_POLL_MS).toBeLessThanOrEqual(3000);
    await vi.advanceTimersByTimeAsync(SITE_POLL_MS);
    await settle();
    expect(page.requests.map((request) => request.url)).toEqual(["/latest.json", "/latest.json"]);
    expect(page.requests[0]?.init?.cache).toBe("no-store");
    expect(prewarmEpisode).not.toHaveBeenCalled();
    // Lets this run finish, so the next test follows a run of its own.
    page.live = true;
    await vi.advanceTimersByTimeAsync(SITE_POLL_MS);
    await settle();
  });

  it("stops the moment the episode is live and pre-narrates it", async () => {
    const page = stubPage(8, "ep-20261011-1930");
    resumeRun();
    await settle();
    page.live = true;
    await vi.advanceTimersByTimeAsync(SITE_POLL_MS);
    await settle();
    expect(page.requests).toHaveLength(2);
    expect(JSON.parse(page.store.get("singularity:run") ?? "{}").phase).toBe("done");
    await vi.dynamicImportSettled();
    expect(prewarmEpisode).toHaveBeenCalledExactlyOnceWith("ep-20261011-1930");
    // Nothing more is asked once it has been seen.
    await vi.advanceTimersByTimeAsync(10 * SITE_POLL_MS);
    expect(page.requests).toHaveLength(2);
  });
});

describe("focus after the card is gone", () => {
  it("goes to the main region when the page shows no Create button", () => {
    const main = {
      attrs: new Map<string, string>(),
      hasAttribute(name: string) {
        return this.attrs.has(name);
      },
      setAttribute(name: string, value: string) {
        this.attrs.set(name, value);
      },
      focus: vi.fn(),
    };
    vi.stubGlobal("document", {
      // The only Create button is hidden: no client rects.
      querySelectorAll: () => [{ getClientRects: () => [], focus: vi.fn() }],
      querySelector: (query: string) => (query === "main" ? main : null),
    });
    focusCreate();
    expect(main.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(main.attrs.get("tabindex")).toBe("-1");
    vi.unstubAllGlobals();
  });
});

describe("a finished line that has gone stale", () => {
  const done = (episode: string, ageMs: number, kind: "regenerate" | "delete" = "regenerate") => ({
    id: 77,
    phase: "done",
    kind,
    episode,
    t0: Date.now() - ageMs,
  });
  const stored = (page: ReturnType<typeof stubPage>) =>
    JSON.parse(page.store.get("singularity:run") ?? "null");

  it("goes with the episode it was about, once that episode is removed", () => {
    const page = stubPage(77, "ep-1");
    page.store.set("singularity:run", JSON.stringify(done("ep-1", 5_000)));
    forgetRunAbout("ep-2");
    expect(stored(page)?.episode).toBe("ep-1");
    forgetRunAbout("ep-1");
    expect(stored(page)).toBeNull();
  });

  it("stays while the run is still going, since the episode's actions are off until it ends", () => {
    const page = stubPage(77, "ep-1");
    page.store.set(
      "singularity:run",
      JSON.stringify({
        id: 77,
        phase: "running",
        kind: "regenerate",
        episode: "ep-1",
        t0: Date.now(),
      }),
    );
    forgetRunAbout("ep-1");
    expect(stored(page)?.phase).toBe("running");
  });

  it("is not shown by a page that opens ten minutes after a rewrite finished", () => {
    const page = stubPage(77, "ep-1");
    page.store.set("singularity:run", JSON.stringify(done("ep-1", 5 * 60_000)));
    resumeRun();
    expect(stored(page)?.phase).toBe("done");
    page.store.set("singularity:run", JSON.stringify(done("ep-1", 11 * 60_000)));
    resumeRun();
    expect(stored(page)).toBeNull();
  });

  it("keeps a finished new episode's line however old: it still offers the episode", () => {
    const page = stubPage(77, "ep-1");
    page.store.set(
      "singularity:run",
      JSON.stringify({ id: 77, phase: "done", href: "/e/ep-1", t0: Date.now() - 60 * 60_000 }),
    );
    resumeRun();
    expect(stored(page)?.phase).toBe("done");
  });
});

describe("the run record moved to localStorage", () => {
  const memory = (initial: Record<string, string> = {}) => {
    const map = new Map(Object.entries(initial));
    return {
      map,
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => map.set(key, value),
      removeItem: (key: string) => map.delete(key),
    };
  };
  const old = JSON.stringify({ id: 41, phase: "running", t0: 1 });

  it("reads a run an older page kept in sessionStorage once, and moves it over", () => {
    const local = memory();
    const session = memory({ "singularity:run": old });
    expect(readRun(local, session)?.id).toBe(41);
    expect(local.map.get("singularity:run")).toBe(old);
    expect(session.map.has("singularity:run")).toBe(false);
  });

  it("prefers the shared record, so a stale session copy never wins", () => {
    const local = memory({ "singularity:run": JSON.stringify({ id: 42, phase: "done" }) });
    const session = memory({ "singularity:run": old });
    expect(readRun(local, session)?.id).toBe(42);
  });
});

// A Regenerate rides the Catch up card (2026-10-27): the same line, bar and Try again, in a briefing's
// words. The sentences are the element's own; this reads which one a run asks for.
describe("what the card says for a run", () => {
  const words = {
    queued: "Episode queued",
    running: "Writing your episode",
    done: "Episode ready",
    started: "Lost track of this run",
    failed: "Couldn't make the episode",
    failedStage: "Stopped while {label}",
    regenerateRunning: "Rewriting your episode",
    briefingQueued: "Waiting for a slot",
    briefingRunning: "Making your briefing",
    briefingDone: "Briefing ready",
    briefingNothing: "Nothing cleared the bar, so the briefing stays as it was.",
    briefingGated: "The schedule held this run back.",
    briefingFailed: "Couldn't make the briefing",
  };
  const run = (extra: Record<string, unknown>) => ({ id: 1, phase: "running", ...extra }) as never;

  it("names a briefing's stage while it runs and says what happened when it is done", () => {
    expect(statusLine(run({ what: "briefing", phase: "queued" }), words)).toBe(
      "Waiting for a slot",
    );
    expect(statusLine(run({ what: "briefing", label: "Writing the briefing" }), words)).toBe(
      "Writing the briefing",
    );
    expect(statusLine(run({ what: "briefing", phase: "done" }), words)).toBe("Briefing ready");
    expect(statusLine(run({ what: "briefing", phase: "done", outcome: "nothing" }), words)).toMatch(
      /stays as it was/,
    );
    expect(statusLine(run({ what: "briefing", phase: "done", outcome: "gated" }), words)).toMatch(
      /held this run back/,
    );
  });

  it("says which step a failed briefing stopped in, and that nothing was changed", () => {
    const line = statusLine(run({ what: "briefing", phase: "failed", step: "writing" }), words);
    expect(line).toBe("The briefing couldn't be written. Nothing was changed.");
    expect(statusLine(run({ what: "briefing", phase: "failed" }), words)).toBe(
      "Couldn't make the briefing",
    );
  });

  it("keeps an episode's words as they were", () => {
    expect(statusLine(run({ phase: "queued" }), words)).toBe("Episode queued");
    expect(statusLine(run({ label: "Writing the script" }), words)).toBe("Writing the script");
    expect(statusLine(run({ kind: "regenerate" }), words)).toBe("Rewriting your episode");
    expect(statusLine(run({ phase: "failed", label: "Publishing" }), words)).toBe(
      "Stopped while publishing",
    );
    expect(
      statusLine(run({ phase: "failed", failedStage: "publishing", kept: ["script"] }), words),
    ).toBe("The episode couldn't be published. The script is saved.");
    expect(statusLine(run({ phase: "failed" }), words)).toBe("Couldn't make the episode");
    expect(statusLine(run({ phase: "failed", note: "Wait 2 minutes." }), words)).toBe(
      "Wait 2 minutes.",
    );
  });
});

describe("a refused Try again", () => {
  const words: Record<string, string> = {
    "data-retry-cooldown": "You can make another episode in {wait}.",
    "data-retry-briefing-cooldown": "You can make another briefing in {wait}.",
    "data-retry-429": "Too many requests just now. Try again in {wait}.",
  };
  const root = { getAttribute: (name: string) => words[name] ?? null };

  it("names a briefing, not an episode, when a Regenerate is retried too soon", () => {
    const reply = { error: "cooldown", retry_after_s: 120 };
    expect(refusal(root, { status: 429 }, reply, true)).not.toMatch(/episode/i);
    expect(refusal(root, { status: 429 }, reply, false)).toMatch(/episode/i);
  });

  it("says something for a wait of a kind it has no words for, so the button is never silent", () => {
    expect(refusal(root, { status: 429 }, { error: "burst", retry_after_s: 30 })).not.toBe("");
  });
});

// A briefing queued behind a scheduled run that is holding for its publish time waits far longer
// than the 20 minutes an episode is followed for; the card said "Lost track of this run" and the end
// cue never played (independent review, PR 391).
describe("following a briefing for as long as it can take", () => {
  it("is still asking after 25 minutes, and shows the briefing when it lands", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    vi.stubGlobal("sessionStorage", { getItem: () => null, removeItem: () => undefined });
    vi.stubGlobal("document", {
      querySelector: () => null,
      querySelectorAll: () => [],
      documentElement: { dataset: {} },
      dispatchEvent: () => true,
    });
    let finished = false;
    vi.stubGlobal("fetch", async () =>
      Response.json(
        finished
          ? { run_id: 31, state: "completed", outcome: "published", digest_id: "2026-10-28" }
          : { run_id: 31, state: "queued" },
      ),
    );
    startRun(31, { what: "briefing" });
    const phase = (): string => JSON.parse(store.get("singularity:run") ?? "{}").phase;
    for (let elapsed = 0; elapsed < 25 * 60_000; elapsed += 4_000) {
      await vi.advanceTimersByTimeAsync(4_000);
      await settle();
    }
    expect(phase()).not.toBe("started");
    finished = true;
    await vi.advanceTimersByTimeAsync(16_000);
    await settle();
    expect(phase()).toBe("done");
  });
});
