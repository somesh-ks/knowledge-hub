import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConnectivity, RETRY_GAPS_MS } from "./connectivity";

/**
 * Bug it prevents (owner, 2026-11-02): the page said "You are offline, try again" after the network
 * had come back and never recovered. The browser's `online` event can come before the network is
 * usable (or not at all), and the page asked once and gave up. The state is the browser's word
 * confirmed by asking the site, and an unconfirmed return is asked again on growing gaps.
 */
describe("connectivity", () => {
  let hint = true;
  let reachable = true;
  const asked: number[] = [];

  const make = () =>
    createConnectivity({
      hint: () => hint,
      reach: async () => {
        asked.push(Date.now());
        return reachable;
      },
      later: (run, ms) => {
        const id = setTimeout(run, ms);
        return () => clearTimeout(id);
      },
    });

  beforeEach(() => {
    vi.useFakeTimers();
    hint = true;
    reachable = true;
    asked.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it("returns by itself when the first online event came before the network was usable", async () => {
    hint = false;
    const link = make();
    const seen: string[] = [];
    link.subscribe((next) => void seen.push(next));
    expect(link.link()).toBe("offline");
    // The phone says online, but nothing gets through yet.
    hint = true;
    reachable = false;
    link.hintOnline();
    await vi.advanceTimersByTimeAsync(0);
    expect(link.link()).toBe("offline");
    // The gaps grow, and the page is never left waiting for another event.
    await vi.advanceTimersByTimeAsync(RETRY_GAPS_MS[0]);
    expect(link.link()).toBe("offline");
    reachable = true;
    await vi.advanceTimersByTimeAsync(RETRY_GAPS_MS[1]);
    expect(link.link()).toBe("online");
    expect(seen).toEqual(["online"]);
    expect(asked.length).toBe(3);
  });

  it("is offline at once on the browser's offline event, and asks nothing while it is offline", async () => {
    const link = make();
    link.hintOffline();
    expect(link.link()).toBe("offline");
    hint = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(asked).toEqual([]);
  });

  it("does not ask when an online event arrives while it is already online", async () => {
    const link = make();
    link.hintOnline();
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual([]);
  });

  it("goes offline when a request found no answer though the browser says online, then recovers", async () => {
    const link = make();
    reachable = false;
    link.reportUnreachable();
    expect(link.link()).toBe("offline");
    reachable = true;
    await vi.advanceTimersByTimeAsync(RETRY_GAPS_MS[0]);
    expect(link.link()).toBe("online");
  });

  it("answers Try again with what the site says now", async () => {
    hint = false;
    const link = make();
    reachable = false;
    expect(await link.check()).toBe("offline");
    reachable = true;
    expect(await link.check()).toBe("online");
  });
});
