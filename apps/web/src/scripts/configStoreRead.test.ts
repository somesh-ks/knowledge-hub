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

  // The owner's report (2026-10-27): Settings took about a second to show the chosen values. A page
  // with a kept copy waited a fixed 300 ms for a store that nearly always takes longer.
  it("shows the device's copy at once when the store has not answered, without waiting for it", async () => {
    vi.useFakeTimers();
    const { CACHE_KEY, loadStore } = await fresh();
    vi.stubGlobal("document", {
      querySelector: () => ({ content: "built-here" }),
      querySelectorAll: () => [],
    });
    const kept = {
      status: 200,
      built: "built-here",
      written_at: 1,
      ops: [{ op: "kept" }],
      sources: [],
    };
    vi.stubGlobal("localStorage", fakeStorage({ [CACHE_KEY]: JSON.stringify(kept) }));
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    let shown: unknown = null;
    void loadStore(0).then((body) => {
      shown = body;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(shown).toMatchObject({ ops: [{ op: "kept" }] });
  });

  // A page view after an in-page navigation: another tab saved meanwhile and wrote a newer copy, and
  // with no wait for the store the page must still read that copy, not the older one this module
  // held from the page before (CodeRabbit, PR 391).
  it("reads a newer device copy than the one an earlier page view held", async () => {
    vi.useFakeTimers();
    const { CACHE_KEY, loadStore, storeRead } = await fresh();
    vi.stubGlobal("document", {
      querySelector: () => ({ content: "built-here" }),
      querySelectorAll: () => [],
    });
    const copy = (writtenAt: number, op: string) => ({
      status: 200,
      built: "built-here",
      written_at: writtenAt,
      ops: [{ op }],
      sources: [],
    });
    const storage = fakeStorage({ [CACHE_KEY]: JSON.stringify(copy(1, "older")) });
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    void loadStore(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(storeRead()?.ops).toEqual([{ op: "older" }]);

    storage.setItem(CACHE_KEY, JSON.stringify(copy(3, "newer")));
    void loadStore(5_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(storeRead()?.ops).toEqual([{ op: "newer" }]);
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

  // The bug: a save left the device's copy a write behind, so another tab, reading the same copy on
  // its next navigation, showed the old name until it was reloaded.
  it("takes the store's answer after a save into the device's copy", async () => {
    vi.useFakeTimers();
    const { CACHE_KEY, afterOwnSave } = await fresh();
    vi.stubGlobal("document", { querySelector: () => ({ content: "built-here" }) });
    const body = (written_at: number, name: string) => ({
      status: 200,
      built: "built-here",
      written_at,
      ops: [{ op: "topic.upsert", name }],
      sources: [],
    });
    const storage = fakeStorage({ [CACHE_KEY]: JSON.stringify(body(1, "Old")) });
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("fetch", async () => Response.json(body(5, "New")));
    afterOwnSave();
    await vi.waitFor(() =>
      expect(JSON.parse(storage.getItem(CACHE_KEY) ?? "null").ops[0].name).toBe("New"),
    );
  });

  // The bug: a read started before a save, resolving after the post-save read, wrote the older
  // settings over the refreshed device copy.
  it("keeps the post-save copy when an older read resolves after it", async () => {
    const { CACHE_KEY, afterOwnSave, loadStore } = await fresh();
    vi.stubGlobal("document", { querySelector: () => ({ content: "built-here" }) });
    const body = (written_at: number, name: string) => ({
      status: 200,
      built: "built-here",
      written_at,
      ops: [{ op: "topic.upsert", name }],
      sources: [],
    });
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    const answers: Array<(response: Response) => void> = [];
    vi.stubGlobal(
      "fetch",
      () => new Promise<Response>((resolve) => answers.push((response) => resolve(response))),
    );
    void loadStore();
    afterOwnSave();
    answers[1]?.(Response.json(body(5, "New")));
    await vi.waitFor(() =>
      expect(JSON.parse(storage.getItem(CACHE_KEY) ?? "null")?.ops[0].name).toBe("New"),
    );
    answers[0]?.(Response.json(body(1, "Old")));
    await new Promise((done) => setTimeout(done, 20));
    expect(JSON.parse(storage.getItem(CACHE_KEY) ?? "null").ops[0].name).toBe("New");
  });
});
