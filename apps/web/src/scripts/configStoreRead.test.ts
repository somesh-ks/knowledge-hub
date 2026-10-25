import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConfigOp } from "../types/contracts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** The module fresh: what one page view read must not speak for the next test's page. */
async function fresh(): Promise<typeof import("./configStoreRead")> {
  vi.resetModules();
  return import("./configStoreRead");
}

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

describe("loadStore", () => {
  // The bug (D172): with the store on, a settings page that could not get the store's answer in time
  // (Neon waking, the phone offline) showed the build's copy, a run old, as if it were current.
  it("answers from the device's last copy when the store is slow, and keeps the store's newer answer", async () => {
    vi.useFakeTimers();
    const { CACHE_GRACE_MS, CACHE_KEY, loadStore, storeRead } = await fresh();
    vi.stubGlobal("document", { querySelector: () => ({ content: "built-here" }) });
    const kept = {
      status: 200,
      built: "built-here",
      written_at: 1,
      ops: [{ op: "kept" }],
      sources: [],
    };
    const storage = fakeStorage({ [CACHE_KEY]: JSON.stringify(kept) });
    vi.stubGlobal("localStorage", storage);
    const answers: ((response: Response) => void)[] = [];
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => answers.push(resolve)));

    // The store is still silent when the grace runs out: the page gets the copy.
    const slow = loadStore(0);
    await vi.advanceTimersByTimeAsync(CACHE_GRACE_MS);
    expect((await slow)?.ops).toEqual([{ op: "kept" }]);
    expect(storeRead()?.ops).toEqual([{ op: "kept" }]);

    // The store answers late with newer edits: the next read and the copy hold them.
    const later = { ...kept, written_at: 2, ops: [{ op: "fresh" }] };
    answers[0]?.(Response.json(later));
    await vi.advanceTimersByTimeAsync(0);
    expect(storeRead()?.ops).toEqual([{ op: "fresh" }]);
    expect(JSON.parse(storage.getItem(CACHE_KEY) ?? "null").ops).toEqual([{ op: "fresh" }]);

    // A store that answers within the grace is what the page gets, not the copy.
    const quick = loadStore(5000);
    answers[1]?.(Response.json({ ...later, written_at: 3, ops: [{ op: "quick" }] }));
    await vi.advanceTimersByTimeAsync(0);
    expect((await quick)?.ops).toEqual([{ op: "quick" }]);

    // A copy from another build is not this page's.
    storage.setItem(CACHE_KEY, JSON.stringify({ ...later, built: "elsewhere" }));
    const other = loadStore(10_000);
    answers[2]?.(new Response(null, { status: 503 }));
    await vi.advanceTimersByTimeAsync(CACHE_GRACE_MS);
    // The failed read leaves the last good answer standing for the page.
    expect((await other)?.ops).toEqual([{ op: "quick" }]);
  });

  // The bug: whichever read ended last set what the page used, so a slow first read that failed
  // after a newer one answered took the store's edits away and the rows went back to the build.
  it("lets only the newest read speak for the store", async () => {
    const { loadStore, storeRead } = await fresh();
    vi.stubGlobal("document", { querySelector: () => ({ content: "built-here" }) });
    const answers: ((response: Response) => void)[] = [];
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => answers.push(resolve)));
    const ops = [{ op: "source.set", id: "studio-notes", enabled: false }];
    const older = loadStore(0);
    const newer = loadStore(5000);
    answers[1]?.(
      Response.json({ status: 200, built: "built-here", written_at: null, ops, sources: [] }),
    );
    await newer;
    answers[0]?.(new Response(null, { status: 503 }));
    await older;
    expect(storeRead()?.ops).toEqual(ops);
  });

  // The bug (D173): a store that answered after the page stopped waiting was applied only on the
  // next page view, so an edit made on another device stayed hidden with nothing to say so.
  it("offers a reload when the store answers after the page stopped waiting", async () => {
    vi.useFakeTimers();
    const { STORE_READ_TIMEOUT_MS, loadStore } = await fresh();
    const { TOAST_EVENT } = await import("./toastEvent");
    const toasts: unknown[] = [];
    vi.stubGlobal("document", {
      querySelector: (selector: string) =>
        selector.startsWith("meta") ? { content: "built-here" } : null,
      dispatchEvent: (event: CustomEvent) => {
        if (event.type === TOAST_EVENT) toasts.push(event.detail);
        return false;
      },
      addEventListener: () => {},
    });
    vi.stubGlobal("localStorage", fakeStorage());
    const answers: ((response: Response) => void)[] = [];
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => answers.push(resolve)));

    const slow = loadStore(0);
    await vi.advanceTimersByTimeAsync(STORE_READ_TIMEOUT_MS);
    expect(await slow).toBeNull();
    expect(toasts).toEqual([]);
    const ops = [{ op: "source.set", id: "studio-notes", enabled: false }];
    answers[0]?.(
      Response.json({ status: 200, built: "built-here", written_at: 1, ops, sources: [] }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(toasts).toEqual([expect.objectContaining({ actionLabel: "Reload" })]);
  });

  // The bug: the owner's own save left the device's kept copy stale, so the next page view read the
  // store's answer (their own save) as "changed on another device". The revision a save produced is
  // tracked: only a write newer than it comes from another device.
  it("offers a reload only for a write newer than this device's own save", async () => {
    vi.useFakeTimers();
    const { CACHE_GRACE_MS, CACHE_KEY, loadStore } = await fresh();
    const { remember } = await import("./managePageSave");
    const { TOAST_EVENT } = await import("./toastEvent");
    const toasts: unknown[] = [];
    vi.stubGlobal("document", {
      querySelector: (selector: string) =>
        selector.startsWith("meta") ? { content: "built-here" } : null,
      dispatchEvent: (event: CustomEvent) => {
        if (event.type === TOAST_EVENT) toasts.push(event.detail);
        return false;
      },
      addEventListener: () => {},
    });
    const kept = { status: 200, built: "built-here", written_at: 1, ops: [], sources: [] };
    vi.stubGlobal("localStorage", fakeStorage({ [CACHE_KEY]: JSON.stringify(kept) }));
    const answers: ((response: Response) => void)[] = [];
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => answers.push(resolve)));
    const own = [{ op: "source.set", id: "a", enabled: false }];
    const answer = (writtenAt: number, ops: unknown[]) =>
      Response.json({ status: 200, built: "built-here", written_at: writtenAt, ops, sources: [] });

    // This device saved an edit the store stamped 5; the next page view finds it in the store.
    remember(own as unknown as ConfigOp[], 0, [], 5);
    void loadStore(0);
    await vi.advanceTimersByTimeAsync(CACHE_GRACE_MS);
    answers[0]?.(answer(5, own));
    await vi.advanceTimersByTimeAsync(0);
    expect(toasts).toEqual([]);

    // A write after it, from another device, is still offered.
    void loadStore(5000);
    await vi.advanceTimersByTimeAsync(CACHE_GRACE_MS);
    answers[1]?.(answer(9, []));
    await vi.advanceTimersByTimeAsync(0);
    expect(toasts).toEqual([expect.objectContaining({ actionLabel: "Reload" })]);
  });
});
