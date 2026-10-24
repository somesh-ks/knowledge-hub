import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAVED_KEY } from "../lib/savedKey";
import { anyPending, parseSaved, savedOps } from "../lib/savedOverlay";
import type { ConfigOp } from "../types/contracts";
import {
  adopt,
  buildQueue,
  dropUnclaimed,
  flush,
  GAP_MS,
  gapLeft,
  HELD_EVENT,
  type Held,
  keepWaiting,
  MAX_BODY_CHARS,
  type Pending,
  pack,
  remember,
  type SaveContext,
} from "./managePageSave";

/** A control as settle reads one: not a row, not a remove button. */
const control = (): HTMLElement =>
  ({ matches: () => false, dataset: {} as Record<string, string> }) as unknown as HTMLElement;

const change = (op: ConfigOp): Pending => ({ op, el: control(), now: "x" });

/** localStorage, for a test run in Node. */
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

describe("gapLeft", () => {
  it("holds nothing before the first request, and the rest of the server's gap after one", () => {
    expect(gapLeft(0, 5000)).toBe(0);
    expect(gapLeft(1000, 1000)).toBe(GAP_MS);
    expect(gapLeft(1000, 4000)).toBe(GAP_MS - 3000);
    expect(gapLeft(1000, 1000 + GAP_MS)).toBe(0);
    // A clock moved back never holds longer than one gap.
    expect(gapLeft(10_000, 0)).toBe(GAP_MS);
  });
});

describe("pack", () => {
  it("puts a long block prompt in a request of its own, so the server never refuses the body", () => {
    // A structure.set and a 6000-character prompt in one request outgrew the server's 8192 characters.
    const changes = new Map<string, Pending>([
      [
        "structure:daily",
        change({
          op: "structure.set",
          kind: "daily",
          blocks: [{ type: "hello" }, { type: "trending" }, { type: "sign_off" }],
        }),
      ],
      [
        "prompt:daily:trending",
        change({
          op: "structure.prompt",
          kind: "daily",
          key: "trending",
          prompt: "a".repeat(6000),
        }),
      ],
      [
        "prompt:daily:top_picks",
        change({
          op: "structure.prompt",
          kind: "daily",
          key: "top_picks",
          prompt: "b".repeat(3000),
        }),
      ],
    ]);
    const batches = pack(buildQueue(changes), changes);
    expect(batches.map((batch) => batch.ops.map((op) => op.op))).toEqual([
      ["structure.set", "structure.prompt"],
      ["structure.prompt"],
    ]);
    for (const batch of batches) {
      const body = JSON.stringify({ op: batch.ops.length === 1 ? batch.ops[0] : batch.ops });
      expect(body.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
    }
  });
});

describe("flush", () => {
  let posted: ConfigOp[][];
  const states: string[] = [];
  const context = (changes: Map<string, Pending>): SaveContext => ({
    changes,
    show: (_message, state) => void states.push(state),
  });

  /** The module remembers its last request across tests: each test starts an hour after the last. */
  let round = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    round += 1;
    vi.setSystemTime(Date.now() + round * 3_600_000);
    posted = [];
    states.length = 0;
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const { op } = JSON.parse(String(init.body)) as { op: ConfigOp | ConfigOp[] };
        posted.push([op].flat());
        return new Response(JSON.stringify({ status: 202, run_id: 1 }), { status: 202 });
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps what went through, so a page opened before the build can show it", async () => {
    const changes = new Map([["a", change({ op: "schedule.set", hour: 7 })]]);
    await flush(context(changes));
    const kept = parseSaved(localStorage.getItem(SAVED_KEY), Date.now());
    expect(savedOps(kept, Date.now())).toEqual([{ op: "schedule.set", hour: 7 }]);
  });

  it("tells a row that reports its own state when its request did not go, and when it did", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: 500 }), { status: 500 })),
    );
    const told: string[] = [];
    const row = {
      ...change({ op: "source.add", url: "https://a.example/feed.xml" }),
      fail: () => void told.push("fail"),
      done: () => void told.push("done"),
    };
    const changes = new Map([["a", row]]);
    await flush(context(changes));
    // Refused: the row is told, and the change stays for the toast's Retry.
    expect(told).toEqual(["fail"]);
    expect(changes.has("a")).toBe(true);
    expect(states).toEqual(["saving", "error"]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: 202, run_id: 1 }), { status: 202 })),
    );
    await flush(context(changes));
    expect(told).toEqual(["fail", "done"]);
    expect(changes.size).toBe(0);
  });

  it("does not keep a refused change as pending for the next page, and sends it again on Retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: 500 }), { status: 500 })),
    );
    const changes = new Map([
      ["a", change({ op: "source.add", url: "https://a.example/feed.xml" })],
    ]);
    await flush(context(changes));
    expect(changes.get("a")?.failed).toBe(true);
    // The page is left with the refusal on it: the next page shows nothing for it.
    const leaving = context(changes);
    keepWaiting(leaving);
    expect(anyPending(parseSaved(localStorage.getItem(SAVED_KEY), Date.now()), Date.now())).toBe(
      false,
    );
    // Retry: it goes again, and is no longer marked refused.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status: 202, run_id: 1 }), { status: 202 })),
    );
    await flush(context(changes));
    expect(changes.size).toBe(0);
  });

  // The bug (2026-10-24): a change the engine refused for good (a duplicate source) was sent again
  // with every later edit, and refused them all with it, until its row was removed.
  it("sends the other changes of a batch the engine refused one op of, and never resends the refused one", async () => {
    const refusal = (index: number) => ({
      status: 400,
      error: "invalid_request",
      reason: "Already a source: Friday Checkout.",
      op_index: index,
    });
    const answers = [refusal(1), { status: 202 }, refusal(0), { status: 202 }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const { op } = JSON.parse(String(init.body)) as { op: ConfigOp | ConfigOp[] };
        posted.push([op].flat());
        const body = answers.shift() ?? { status: 202 };
        return new Response(JSON.stringify(body), { status: body.status });
      }),
    );
    const told: string[] = [];
    const duplicate = {
      ...change({ op: "source.add", url: "https://dup.example/feed.xml" }),
      fail: () => void told.push("fail"),
    };
    const changes = new Map([
      ["a", change({ op: "source.set", id: "a", enabled: false })],
      ["dup", duplicate],
      ["b", change({ op: "source.set", id: "b", enabled: false })],
    ]);
    await flush(context(changes));
    expect(posted).toHaveLength(2);
    expect(posted[1]).toEqual([
      { op: "source.set", id: "a", enabled: false },
      { op: "source.set", id: "b", enabled: false },
    ]);
    expect(told).toEqual(["fail"]);
    expect([...changes.keys()]).toEqual(["dup"]);
    expect(changes.get("dup")?.failed).toBe(true);
    expect(states.at(-1)).toBe("error");

    // A later change still saves: the refused one is refused again and dropped from that run.
    changes.set("c", change({ op: "source.set", id: "c", enabled: true }));
    const next = flush(context(changes));
    await vi.advanceTimersByTimeAsync(GAP_MS);
    await next;
    expect(posted.at(-1)).toEqual([{ op: "source.set", id: "c", enabled: true }]);
    expect([...changes.keys()]).toEqual(["dup"]);
  });

  it("holds a change made inside the server's gap, quietly, and sends what gathered in one request", async () => {
    const changes = new Map([["a", change({ op: "source.set", id: "a", enabled: false })]]);
    await flush(context(changes));
    expect(posted).toHaveLength(1);
    states.length = 0;

    changes.set("b", change({ op: "source.set", id: "b", enabled: false }));
    const second = flush(context(changes));
    await vi.advanceTimersByTimeAsync(GAP_MS / 2);
    // Nothing sent while the gap runs: the server would refuse it.
    expect(posted).toHaveLength(1);
    expect(states).toEqual([]);
    changes.set("c", change({ op: "source.set", id: "c", enabled: true }));
    await vi.advanceTimersByTimeAsync(GAP_MS);
    await second;
    expect(posted).toHaveLength(2);
    expect(posted[1]).toEqual([
      { op: "source.set", id: "b", enabled: false },
      { op: "source.set", id: "c", enabled: true },
    ]);
    expect(states).toEqual(["saving", "saved"]);
  });

  it("still sends a change held in the gap when its page was swapped away and its toast throws", async () => {
    const changes = new Map([["a", change({ op: "schedule.set", hour: 7 })]]);
    await flush(context(changes));
    changes.set("b", change({ op: "schedule.set", length_minutes: 10 }));
    const gone: SaveContext = {
      changes,
      show: () => {
        throw new DOMException("Invalid on disconnected popover elements", "InvalidStateError");
      },
      settled: () => {
        throw new Error("the page is gone");
      },
    };
    const second = flush(gone);
    // Leaving keeps the waiting edit, marked pending, for the page opened next.
    keepWaiting(gone);
    let kept = parseSaved(localStorage.getItem(SAVED_KEY), Date.now());
    expect(anyPending(kept, Date.now())).toBe(true);
    expect(savedOps(kept, Date.now())).toContainEqual({ op: "schedule.set", length_minutes: 10 });
    await vi.advanceTimersByTimeAsync(GAP_MS);
    await second;
    expect(posted).toEqual([
      [{ op: "schedule.set", hour: 7 }],
      [{ op: "schedule.set", length_minutes: 10 }],
    ]);
    expect(changes.size).toBe(0);
    kept = parseSaved(localStorage.getItem(SAVED_KEY), Date.now());
    expect(anyPending(kept, Date.now())).toBe(false);
    expect(savedOps(kept, Date.now())).toEqual([
      { op: "schedule.set", hour: 7 },
      { op: "schedule.set", length_minutes: 10 },
    ]);
  });

  it("drops edits marked pending when the run that carried them fails", async () => {
    const changes = new Map([["a", change({ op: "schedule.set", hour: 7 })]]);
    await flush(context(changes));
    changes.set("b", change({ op: "schedule.set", hour: 9 }));
    const gone = context(changes);
    const second = flush(gone);
    keepWaiting(gone);
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 500 }));
    await vi.advanceTimersByTimeAsync(GAP_MS);
    await second;
    const kept = parseSaved(localStorage.getItem(SAVED_KEY), Date.now());
    expect(savedOps(kept, Date.now())).toEqual([{ op: "schedule.set", hour: 7 }]);
  });

  it("sends another page's changes that came while a run was busy, once it is done", async () => {
    const first = new Map([["a", change({ op: "schedule.set", hour: 7 })]]);
    await flush(context(first));
    first.set("b", change({ op: "schedule.set", hour: 8 }));
    const held = flush(context(first));
    const next = new Map([["c", change({ op: "source.set", id: "c", enabled: true })]]);
    await flush(context(next));
    await vi.advanceTimersByTimeAsync(GAP_MS * 3);
    await held;
    expect(posted).toHaveLength(3);
    expect(posted[2]).toEqual([{ op: "source.set", id: "c", enabled: true }]);
  });

  it("says nothing when every change was put back during the gap", async () => {
    const changes = new Map([["a", change({ op: "source.set", id: "a", enabled: false })]]);
    await flush(context(changes));
    states.length = 0;
    changes.set("b", change({ op: "source.set", id: "b", enabled: false }));
    const second = flush(context(changes));
    changes.delete("b");
    await vi.advanceTimersByTimeAsync(GAP_MS);
    await second;
    expect(posted).toHaveLength(1);
    expect(states).toEqual([]);
  });
});

describe("a left page's held run", () => {
  let posted: ConfigOp[][];
  let heard: Held[];
  let answers: number[];
  /** Each test starts an hour after the last, so the module's last request leaves no gap. */
  let round = 100;

  const page = (changes = new Map<string, Pending>(), here = false) => {
    const said: [string, string][] = [];
    const context: SaveContext = {
      changes,
      show: (message, state) => void said.push([message, state]),
      here: () => here,
    };
    return { context, said };
  };
  const pending = () => parseSaved(localStorage.getItem(SAVED_KEY), Date.now());

  /** Daily: Time saved, then Length changed inside the gap and the page left. */
  async function leaveInGap(): Promise<{ run: Promise<void>; left: SaveContext }> {
    const changes = new Map([["schedule", change({ op: "schedule.set", hour: 9 })]]);
    const { context: left } = page(changes);
    await flush(left);
    changes.set("schedule", change({ op: "schedule.set", length_minutes: 3 }));
    const run = flush(left);
    keepWaiting(left);
    return { run, left };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    round += 1;
    vi.setSystemTime(Date.now() + round * 3_600_000);
    posted = [];
    heard = [];
    answers = [];
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
    const doc = new EventTarget();
    doc.addEventListener(
      HELD_EVENT,
      (event) => void heard.push((event as CustomEvent<Held>).detail),
    );
    vi.stubGlobal("document", doc);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const { op } = JSON.parse(String(init.body)) as { op: ConfigOp | ConfigOp[] };
        posted.push([op].flat());
        const status = answers.shift() ?? 202;
        if (status === 0) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ status }), { status });
      }),
    );
  });

  afterEach(() => {
    dropUnclaimed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("tells the page open now when it went through, and keeps nothing pending", async () => {
    const { run } = await leaveInGap();
    expect(anyPending(pending(), Date.now())).toBe(true);
    await vi.advanceTimersByTimeAsync(GAP_MS);
    await run;
    expect(heard).toEqual([{ ok: true, failure: "", lost: [], claimed: false }]);
    expect(anyPending(pending(), Date.now())).toBe(false);
    expect(savedOps(pending(), Date.now())).toEqual([
      { op: "schedule.set", hour: 9 },
      { op: "schedule.set", length_minutes: 3 },
    ]);
  });

  it("hands what failed to the page open now, which says so and sends it once on Retry", async () => {
    const { run, left } = await leaveInGap();
    answers.push(500);
    await vi.advanceTimersByTimeAsync(GAP_MS);
    await run;
    const [held] = heard;
    expect(held?.ok).toBe(false);
    expect(held?.failure).toBe("The server crashed before it could answer. Not saved yet.");
    expect(held?.lost.map(({ op }) => op)).toEqual([{ op: "schedule.set", length_minutes: 3 }]);
    // Nothing is pending any more, and the left page holds nothing.
    expect(anyPending(pending(), Date.now())).toBe(false);
    expect(left.changes.size).toBe(0);

    // The open page has a change of its own: the held one goes ahead of it, refused until sent.
    const own = new Map([["schedule", change({ op: "schedule.set", hour: 8 })]]);
    const { context: open, said } = page(own, true);
    adopt(open);
    expect(held?.claimed).toBe(true);
    expect([...own.values()].map(({ op, failed }) => [op, failed])).toEqual([
      [{ op: "schedule.set", length_minutes: 3 }, true],
      [{ op: "schedule.set", hour: 8 }, undefined],
    ]);
    expect(said).toEqual([["The server crashed before it could answer. Not saved yet.", "error"]]);
    // Taken once: another page takes nothing.
    const other = page();
    adopt(other.context);
    expect(other.context.changes.size).toBe(0);

    const before = posted.length;
    await vi.advanceTimersByTimeAsync(GAP_MS);
    await flush(open);
    expect(posted.slice(before)).toEqual([
      [
        { op: "schedule.set", length_minutes: 3 },
        { op: "schedule.set", hour: 8 },
      ],
    ]);
    expect(own.size).toBe(0);
  });

  it("offers a change lost with the connection again, for Retry once it is back", async () => {
    const { run } = await leaveInGap();
    answers.push(0);
    await vi.advanceTimersByTimeAsync(GAP_MS);
    await run;
    expect(heard[0]?.failure).toBe("Couldn't reach the site. Not saved yet.");
    const { context: open, said } = page(new Map(), true);
    adopt(open);
    expect(said).toEqual([["Couldn't reach the site. Not saved yet.", "error"]]);
    const before = posted.length;
    await flush(open);
    expect(posted.slice(before)).toEqual([[{ op: "schedule.set", length_minutes: 3 }]]);
  });

  it("keeps a page that is itself being left, or one opened after, from taking it", async () => {
    const { run } = await leaveInGap();
    answers.push(500);
    await vi.advanceTimersByTimeAsync(GAP_MS);
    await run;
    const leaving = page(new Map([["a", change({ op: "schedule.set", hour: 6 })]]), true);
    leaving.context.left = true;
    adopt(leaving.context);
    expect(leaving.context.changes.size).toBe(1);
    // The page open when it failed is left without taking it: the next page is built without it.
    dropUnclaimed();
    const next = page(new Map(), true);
    adopt(next.context);
    expect(next.context.changes.size).toBe(0);
  });

  it("shows each of several left pages' edits as pending until its own run ends", async () => {
    const { run: first } = await leaveInGap();
    const second = page(new Map([["b", change({ op: "source.set", id: "b", enabled: false })]]));
    const queued = flush(second.context);
    keepWaiting(second.context);
    expect(savedOps(pending(), Date.now())).toContainEqual({
      op: "source.set",
      id: "b",
      enabled: false,
    });
    await vi.advanceTimersByTimeAsync(GAP_MS);
    await first;
    // The first run's end leaves the second page's edit pending.
    expect(heard).toHaveLength(1);
    expect(anyPending(pending(), Date.now())).toBe(true);
    await vi.advanceTimersByTimeAsync(GAP_MS * 2);
    await queued;
    expect(heard.map(({ ok }) => ok)).toEqual([true, true]);
    expect(anyPending(pending(), Date.now())).toBe(false);
    expect(posted.at(-1)).toEqual([{ op: "source.set", id: "b", enabled: false }]);
  });

  it("leaves a page that was only hidden, not left, with its own refusal and Retry", async () => {
    const changes = new Map([["a", change({ op: "schedule.set", hour: 9 })]]);
    const { context, said } = page(changes, true);
    answers.push(500);
    const run = flush(context);
    keepWaiting(context);
    await run;
    expect(heard).toEqual([]);
    expect(context.left).toBe(false);
    expect(changes.get("a")?.failed).toBe(true);
    expect(said.at(-1)).toEqual([
      "The server crashed before it could answer. Not saved yet.",
      "error",
    ]);
    expect(anyPending(pending(), Date.now())).toBe(false);
  });
});

describe("remember", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not throw when storage is refused", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
    });
    expect(() => remember([{ op: "schedule.set", hour: 7 }])).not.toThrow();
  });
});

describe("a held change lost while no settings page is open", () => {
  /** What the app's toast was asked to show (TOAST_EVENT in sheets/toastStore.ts). */
  let toasts: unknown[] = [];

  afterEach(() => {
    dropUnclaimed();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Each test starts long after the last request any test made: no wait out of the server's gap. */
  let round = 2000;

  async function loseHeld(settingsPage: boolean): Promise<void> {
    vi.useFakeTimers();
    round += 10;
    vi.setSystemTime(Date.now() + round * 3_600_000);
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
    // The page left is Daily; the page open when the run ends is Today, or a settings page.
    let open = "daily";
    const doc = Object.assign(new EventTarget(), {
      querySelector: (selector: string) =>
        (selector === "#page-title" && open === "daily") ||
        (selector === "[data-bar]" && settingsPage)
          ? { textContent: "Daily" }
          : null,
    });
    toasts = [];
    doc.addEventListener(
      "singularity:toast",
      (event) => void toasts.push((event as CustomEvent).detail),
    );
    vi.stubGlobal("document", doc);
    vi.stubGlobal("location", { pathname: "/settings/daily" });
    const answers = [202, 500];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const status = answers.shift() ?? 202;
        return new Response(JSON.stringify({ status }), { status });
      }),
    );
    const changes = new Map([["schedule", change({ op: "schedule.set", hour: 9 })]]);
    const left: SaveContext = { changes, show: () => {}, here: () => false };
    await flush(left);
    changes.set("schedule", change({ op: "schedule.set", length_minutes: 3 }));
    const run = flush(left);
    keepWaiting(left);
    open = settingsPage ? "weekly" : "today";
    await vi.advanceTimersByTimeAsync(GAP_MS);
    await run;
    await vi.advanceTimersByTimeAsync(10);
  }

  it("says so in the app's toast, as an alert, naming the page it was made on", async () => {
    await loseHeld(false);
    expect(toasts).toEqual([
      expect.objectContaining({
        message: "Your change to Daily was not saved.",
        kind: "error",
        actionLabel: "Open",
      }),
    ]);
  });

  it("leaves it to a settings page, which takes it with its own toast", async () => {
    await loseHeld(true);
    expect(toasts).toEqual([]);
  });
});
