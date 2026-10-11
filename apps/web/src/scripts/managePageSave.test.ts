import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAVED_KEY } from "../lib/savedKey";
import { parseSaved, savedOps } from "../lib/savedOverlay";
import type { ConfigOp } from "../types/contracts";
import { flush, GAP_MS, gapLeft, type Pending, remember, type SaveContext } from "./managePageSave";

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

describe("flush", () => {
  let posted: ConfigOp[][];
  const states: string[] = [];
  const context = (changes: Map<string, Pending>): SaveContext => ({
    changes,
    dialog: null,
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
    await flush(context(changes), "open");
    const kept = parseSaved(localStorage.getItem(SAVED_KEY), Date.now());
    expect(savedOps(kept, Date.now())).toEqual([{ op: "schedule.set", hour: 7 }]);
  });

  it("holds a change made inside the server's gap, quietly, and sends what gathered in one request", async () => {
    const changes = new Map([["a", change({ op: "source.set", id: "a", enabled: false })]]);
    await flush(context(changes), "open");
    expect(posted).toHaveLength(1);
    states.length = 0;

    changes.set("b", change({ op: "source.set", id: "b", enabled: false }));
    const second = flush(context(changes), "open");
    await vi.advanceTimersByTimeAsync(GAP_MS / 2);
    // Nothing sent and no Saving while the gap runs: the server would refuse it.
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
    expect(states).toEqual(["saving", "done"]);
  });

  it("says nothing when every change was put back during the gap", async () => {
    const changes = new Map([["a", change({ op: "source.set", id: "a", enabled: false })]]);
    await flush(context(changes), "open");
    states.length = 0;
    changes.set("b", change({ op: "source.set", id: "b", enabled: false }));
    const second = flush(context(changes), "open");
    changes.delete("b");
    await vi.advanceTimersByTimeAsync(GAP_MS);
    await second;
    expect(posted).toHaveLength(1);
    expect(states).toEqual([]);
  });
});

describe("remember", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("adds each request to what is kept, and forgets once nothing is left to show", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    remember([{ op: "schedule.set", hour: 7 }], 1000);
    remember([{ op: "weights.set", weights: { ui: 1 } }], 2000);
    expect(savedOps(parseSaved(localStorage.getItem(SAVED_KEY), 3000), 3000)).toHaveLength(2);
    remember([{ op: "writer.set", provider: "nebius", model: null }], 10 * 60 * 1000);
    expect(localStorage.getItem(SAVED_KEY)).toBeNull();
  });

  it("does not throw when storage is refused", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
    });
    expect(() => remember([{ op: "schedule.set", hour: 7 }])).not.toThrow();
  });
});
