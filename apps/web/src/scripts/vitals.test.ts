import { afterEach, describe, expect, it, vi } from "vitest";

interface Entry {
  name?: string;
  startTime: number;
  duration?: number;
  value?: number;
  hadRecentInput?: boolean;
  interactionId?: number;
}

/**
 * A browser for one page load: the entry types it supports, their buffered entries, the page's
 * visibility, and the beacons it sent. Like a real one, it ignores an unsupported type in observe().
 */
async function load(supported: string[], visibility: "visible" | "hidden") {
  const buffered = new Map<string, Entry[]>();
  const listeners = new Map<string, Array<() => void>>();
  const listen = (key: string) => (type: string, run: () => void) => {
    listeners.set(`${key}:${type}`, [...(listeners.get(`${key}:${type}`) ?? []), run]);
  };
  const beacons: unknown[] = [];
  const page = { visibilityState: visibility, interactionCount: 0 };
  class Observer {
    static supportedEntryTypes = supported;
    type = "";
    observe({ type }: { type: string }): void {
      this.type = type;
    }
    takeRecords(): Entry[] {
      const entries = supported.includes(this.type) ? (buffered.get(this.type) ?? []) : [];
      buffered.set(this.type, []);
      return entries;
    }
  }
  vi.stubGlobal("PerformanceObserver", Observer);
  vi.stubGlobal("document", {
    get visibilityState() {
      return page.visibilityState;
    },
    addEventListener: listen("document"),
  });
  vi.stubGlobal("addEventListener", listen("window"));
  vi.stubGlobal("navigator", {
    sendBeacon: (_url: string, body: string) => beacons.push(JSON.parse(body)),
    connection: { effectiveType: "4g" },
  });
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("location", { pathname: "/d/2026-10-20" });
  vi.stubGlobal("performance", {
    now: () => 9000,
    getEntriesByType: () => [],
    get interactionCount() {
      return page.interactionCount;
    },
  });
  vi.resetModules();
  (await import("./vitals")).startVitals();
  const fire = (key: string) => {
    for (const run of listeners.get(key) ?? []) run();
  };
  return {
    beacons,
    entries: (type: string, ...more: Entry[]) =>
      buffered.set(type, [...(buffered.get(type) ?? []), ...more]),
    setVisibility: (state: "visible" | "hidden") => {
      page.visibilityState = state;
      fire("document:visibilitychange");
    },
    interactions: (count: number) => {
      page.interactionCount = count;
    },
    leave: () => fire("window:pagehide"),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a page load's field vitals", () => {
  // Each of these skewed the p75 health judges: Safari sent a CLS of 0 for every load (observe()
  // ignores a type it does not know), a tab opened in the background sent an empty report before
  // anyone saw it and lost its real one, and one slow press among 60 quick ones read as its INP.
  it("reports once, after the page was seen, only what the browser measures", async () => {
    const chromium = ["visibility-state", "largest-contentful-paint", "layout-shift", "event"];
    const background = await load(chromium, "hidden");
    background.entries("visibility-state", { name: "hidden", startTime: 0 });
    background.setVisibility("hidden");
    expect(background.beacons).toEqual([]);
    background.entries("visibility-state", { name: "visible", startTime: 5000 });
    background.setVisibility("visible");
    // Painted when first shown, not while loading: not its LCP.
    background.entries("largest-contentful-paint", { startTime: 5100 });
    background.entries("layout-shift", { startTime: 6000, value: 0.05, hadRecentInput: false });
    background.entries("event", { startTime: 7000, duration: 600, interactionId: 7 });
    background.interactions(60);
    background.setVisibility("hidden");
    background.leave();
    expect(background.beacons).toEqual([
      { kind: "vitals", page: "/d/[id]", device: "mobile", connection: "4g", inp: 0, cls: 0.05 },
    ]);

    const safari = await load(["largest-contentful-paint"], "visible");
    safari.entries("largest-contentful-paint", { startTime: 1200 });
    safari.setVisibility("hidden");
    expect(safari.beacons).toEqual([
      { kind: "vitals", page: "/d/[id]", device: "mobile", connection: "4g", lcp: 1200 },
    ]);
  });
});
