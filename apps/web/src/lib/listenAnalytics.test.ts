import { afterEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_HOST } from "./analytics";
import { LISTEN_PATH, listenMetadata } from "./listenAnalytics";

const TOKEN = "AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBB";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("the listen page's analytics", () => {
  // The bug it prevents: a share token reaching Simple Analytics, whose dashboard can be public, so
  // the dashboard would list working links to the owner's audio (plan section 4).
  it("reports the path /s and sends no event that carries the token", async () => {
    const sent: unknown[][] = [];
    const scripts: { attributes: Record<string, string>; src: string }[] = [];
    const page: Record<string, unknown> = {
      location: { hostname: ANALYTICS_HOST, pathname: `/s/${TOKEN}`, search: "?ref=share&g=2" },
    };
    vi.stubGlobal("window", page);
    vi.stubGlobal("navigator", { doNotTrack: null });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("document", {
      createElement: () => {
        const script = {
          attributes: {} as Record<string, string>,
          src: "",
          async: false,
          setAttribute(name: string, value: string) {
            script.attributes[name] = value;
          },
        };
        scripts.push(script);
        return script;
      },
      head: { append: () => {} },
    });
    const { installAnalytics, track } = await import("./analytics");
    installAnalytics({ path: LISTEN_PATH });
    const queue = page.sa_event as (...args: unknown[]) => void;
    page.sa_event = (...args: unknown[]) => {
      sent.push(args);
      queue(...args);
    };
    const meta = listenMetadata("2026-10-07", "regular", "?ref=share&g=2");
    for (const name of ["listen_start", "listen_half", "listen_complete"] as const) {
      track(name, meta);
    }

    // The script is told to report every page view and event under the overwritten path.
    const overwriter = scripts[0]?.attributes["data-path-overwriter"] ?? "";
    expect(overwriter).not.toBe("");
    expect((page[overwriter] as () => string)()).toBe(LISTEN_PATH);
    expect(sent).toHaveLength(3);
    expect(sent[0]).toEqual([
      "listen_start",
      { kind: "regular", surface: "listen", generation: 2, item: "2026-10-07" },
    ]);
    const everything = JSON.stringify({
      sent,
      scripts,
      path: (page[overwriter] as () => string)(),
    });
    for (const part of TOKEN.split(".")) expect(everything).not.toContain(part);
  });
});
