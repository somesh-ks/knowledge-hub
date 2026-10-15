import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stopFailure } from "../lib/storyVotes";
import { handleConfig } from "../server/configEdit";
import type { ConfigOp } from "../types/contracts";

/**
 * "Stop hearing from" through the real sender (storyVotes.ts) and the real /api/config handler, with
 * only GitHub faked, on a fake clock. The browser spec (e2e/storyVotes.spec.ts) covers the page; it
 * is not run in CI, so the sender's failure paths are held here, where `npm test` runs them.
 *
 * Bugs these prevent: a stop refused by the server's ten seconds between edits (PR #140); a failure
 * whose cause the page knew shown as the same "Could not stop X yet. Try again." whatever it was,
 * with nothing logged, so a refused GitHub token read as the reader's bad timing.
 */

type GitHub = "ok" | "refused" | "down" | "slow";

interface Toast {
  message?: string;
  kind?: string;
  dismiss?: string;
}

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
    clear: () => items.clear(),
    key: () => null,
    get length() {
      return items.size;
    },
  };
}

let github: GitHub;
let applied: ConfigOp[];
let statuses: number[];
let toasts: Toast[];
let errors: string[];
let releaseSlow: (() => void) | null;

/** GitHub as the handler sees it: each dispatch is listed as a run, so the ten seconds hold. */
function fakeGitHub(): typeof fetch {
  const runs: Array<{ id: number; created_at: string; status: string }> = [];
  return (async (url: string | URL | Request, init: RequestInit = {}) => {
    const href = String(url);
    if (github === "refused") return new Response(null, { status: 401 });
    if (github === "down") throw new TypeError("fetch failed");
    if (init.method === "POST" && href.endsWith("/dispatches")) {
      if (github === "slow") await new Promise<void>((resolve) => (releaseSlow = resolve));
      const { inputs } = JSON.parse(String(init.body)) as { inputs: { op: string } };
      const edit = JSON.parse(inputs.op) as ConfigOp | ConfigOp[];
      applied.push(...(Array.isArray(edit) ? edit : [edit]));
      runs.unshift({
        id: runs.length + 1,
        created_at: new Date(Date.now()).toISOString(),
        status: "queued",
      });
      return Response.json({ workflow_run_id: runs.length });
    }
    if (href.includes("/runs?")) return Response.json({ workflow_runs: runs });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}

/** The page's fetch: /api/config answered by the site's own handler. */
function sitefetch(network: { down: boolean }): typeof fetch {
  const githubFetch = fakeGitHub();
  return (async (_url: string | URL | Request, init: RequestInit = {}) => {
    if (network.down) throw new TypeError("Failed to fetch");
    const result = await handleConfig(
      {
        bodyText: String(init.body ?? ""),
        origin: "https://news.test",
        expectedOrigin: "https://news.test",
      },
      {
        env: {
          GITHUB_DISPATCH_TOKEN: "t",
          GITHUB_REPOSITORY: "o/r",
          GENERATE_PASSPHRASE_HASH: "h",
        },
        fetch: githubFetch,
        now: () => Date.now(),
        delay: async () => {},
        verifyPassphrase: async () => true,
      },
    );
    statuses.push(result.status);
    return Response.json(result.body, { status: result.status });
  }) as typeof fetch;
}

class FakeElement {
  dataset: Record<string, string>;
  constructor(dataset: Record<string, string>) {
    this.dataset = dataset;
  }
}

/** A story's controls, and its "Stop hearing from" item. */
function story(url: string, outlet: string): { closest: () => FakeElement } {
  const controls = new FakeElement({ storyId: url, url, headline: "A story", outlet });
  return { closest: () => controls };
}

const network = { down: false };
let sender: typeof import("./storyVotes");

/** Presses Stop and lets the five seconds of Undo pass. */
async function stop(url: string, outlet: string): Promise<void> {
  sender.handle(story(url, outlet) as unknown as Element);
  await vi.advanceTimersByTimeAsync(5000);
}

const failures = (): Toast[] => toasts.filter((toast) => toast.kind === "error");

beforeEach(async () => {
  vi.useFakeTimers({ now: Date.parse("2026-10-15T12:00:00Z") });
  github = "ok";
  applied = [];
  statuses = [];
  toasts = [];
  errors = [];
  releaseSlow = null;
  network.down = false;
  const document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
    querySelectorAll: () => [],
  });
  document.addEventListener("dispatch:toast", (event) =>
    toasts.push((event as CustomEvent<Toast>).detail),
  );
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
    clearTimeout: (id: number) => clearTimeout(id),
    addEventListener: () => {},
  });
  vi.stubGlobal("HTMLElement", FakeElement);
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("fetch", sitefetch(network));
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  });
  vi.resetModules();
  sender = await import("./storyVotes");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Stop hearing from", () => {
  it("stops two outlets pressed inside the server's ten seconds, with no failure shown", async () => {
    await stop("https://reveneau.com/ainews/a", "reveneau.com");
    await vi.advanceTimersByTimeAsync(2000);
    await stop("https://zandigital.in/b", "zandigital.in");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(applied).toEqual([
      { op: "profile.block", domain: "reveneau.com" },
      { op: "profile.block", domain: "zandigital.in" },
    ]);
    expect(failures()).toEqual([]);
  });

  it("sends a stop pressed while another request is on its way once that one is answered", async () => {
    github = "slow";
    await stop("https://reveneau.com/ainews/a", "reveneau.com");
    await stop("https://zandigital.in/b", "zandigital.in");
    github = "ok";
    releaseSlow?.();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(applied.map((op) => (op as { domain: string }).domain)).toEqual([
      "reveneau.com",
      "zandigital.in",
    ]);
    expect(failures()).toEqual([]);
  });

  it("sends an outlet pressed twice once", async () => {
    sender.handle(story("https://reveneau.com/ainews/a", "reveneau.com") as unknown as Element);
    await stop("https://reveneau.com/ainews/b", "reveneau.com");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(applied).toEqual([{ op: "profile.block", domain: "reveneau.com" }]);
  });

  it("says what failed and whether pressing again can help, logs the answer, and keeps nothing", async () => {
    // The site cannot reach GitHub (here a refused token): every outlet fails the same way.
    github = "refused";
    await stop("https://reveneau.com/ainews/a", "reveneau.com");
    await vi.advanceTimersByTimeAsync(11_000);
    await stop("https://zandigital.in/b", "zandigital.in");
    await vi.advanceTimersByTimeAsync(11_000);
    // An address the server will not store as a domain.
    github = "ok";
    await stop("https://localhost/x", "localhost");
    await vi.advanceTimersByTimeAsync(11_000);
    // No answer at all.
    network.down = true;
    await stop("https://reveneau.com/ainews/a", "reveneau.com");
    await vi.advanceTimersByTimeAsync(11_000);

    expect(statuses).toEqual([503, 503, 400]);
    expect(failures().map((toast) => toast.message)).toEqual([
      stopFailure("reveneau.com", 503).message,
      stopFailure("zandigital.in", 503).message,
      stopFailure("localhost", 400).message,
      stopFailure("reveneau.com", 0).message,
    ]);
    // The real answer is logged, so a failure can be told apart after the fact.
    expect(errors.map((line) => line.match(/failed: (\d+)/)?.[1])).toEqual([
      "503",
      "503",
      "400",
      "0",
    ]);
    // A refusal is not retried on its own and nothing is left queued: pressing again is the retry.
    expect(applied).toEqual([]);
    expect(localStorage.getItem("dispatch:story-blocks")).toBeNull();
  });
});

describe("stopFailure", () => {
  it("names the cause and whether pressing again can help, and no two causes read alike", () => {
    const causes = [0, 429, 503, 400, 401, 500];
    const failures = causes.map((status) => stopFailure("reveneau.com", status));
    expect(failures.map((failure) => failure.retry)).toEqual([
      "now",
      "later",
      "later",
      "no",
      "no",
      "later",
    ]);
    for (const failure of failures) expect(failure.message).toContain("reveneau.com");
    expect(new Set(failures.map((failure) => failure.message)).size).toBe(causes.length);
  });
});

describe("handleConfig without its settings", () => {
  it("logs why it answers 503, which nothing else would say", async () => {
    const logs: string[] = [];
    const result = await handleConfig(
      { bodyText: "{}", origin: null, expectedOrigin: "https://news.test" },
      {
        env: {},
        fetch: fakeGitHub(),
        now: () => 0,
        delay: async () => {},
        verifyPassphrase: async () => true,
        log: (message) => logs.push(message),
      },
    );
    expect(result.status).toBe(503);
    expect(logs).toHaveLength(1);
  });
});
