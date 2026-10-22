import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_HOST,
  ANALYTICS_QUEUE_ORIGIN,
  ANALYTICS_SCRIPT_ORIGIN,
  installAnalytics,
  track,
} from "./analytics";

interface Fake {
  sa_event?: ((...args: unknown[]) => void) & { q?: unknown[][] };
  appended: { src: string }[];
}

function browser(hostname: string, privacy: { doNotTrack?: string; gpc?: boolean } = {}): Fake {
  const fake: Fake = { appended: [] };
  vi.stubGlobal("window", Object.assign(fake, { location: { hostname } }));
  vi.stubGlobal("navigator", {
    doNotTrack: privacy.doNotTrack ?? null,
    globalPrivacyControl: privacy.gpc,
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("document", {
    createElement: () => ({ async: false, src: "" }),
    head: { append: (script: { src: string }) => fake.appended.push(script) },
  });
  return fake;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("analytics", () => {
  // The header policy is kept by hand in vercel.json; the page's own policy is built from these
  // constants. A header that drops the queue blocks every count with nothing on screen to say so.
  it("the header policy lets the counts out", () => {
    const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
    const policies: string[] = config.headers
      .flatMap((rule: { headers: { key: string; value: string }[] }) => rule.headers)
      .filter((header: { key: string }) => header.key === "Content-Security-Policy")
      .map((header: { value: string }) => header.value);
    expect(policies).not.toEqual([]);
    for (const policy of policies) {
      for (const directive of ["connect-src", "img-src"]) {
        const sources = policy.split(";").find((part) => part.trim().startsWith(directive));
        expect(sources, directive).toContain(ANALYTICS_QUEUE_ORIGIN);
      }
    }
  });

  // A preview or a local build would count the owner's testing as readers; a browser that asks not
  // to be tracked is promised on /privacy that the script never loads.
  it("loads nothing off production or for a reader who asked not to be tracked", async () => {
    for (const [hostname, privacy] of [
      ["localhost", {}],
      ["dispatch-git-branch.vercel.app", {}],
      [ANALYTICS_HOST, { doNotTrack: "1" }],
      [ANALYTICS_HOST, { gpc: true }],
    ] as const) {
      const fake = browser(hostname, privacy);
      const analytics = await import("./analytics");
      analytics.installAnalytics();
      analytics.track("share", { kind: "briefing" });
      expect(fake.appended, hostname).toEqual([]);
      expect(fake.sa_event, hostname).toBeUndefined();
      vi.resetModules();
    }
  });

  // An event in the first second (a Share pressed as the page opens) was lost before the script
  // arrived, and an ad blocker's broken stand-in threw into the Share that called it.
  it("queues an early event for the script and never throws into the caller", () => {
    const fake = browser(ANALYTICS_HOST);
    installAnalytics();
    expect(fake.appended.map((script) => script.src)).toEqual([
      `${ANALYTICS_SCRIPT_ORIGIN}/latest.js`,
    ]);
    track("vote", { value: "up", topic: "" });
    expect(fake.sa_event?.q).toEqual([["vote", { value: "up" }]]);
    fake.sa_event = () => {
      throw new Error("blocked");
    };
    expect(() => track("share", { kind: "episode" })).not.toThrow();
  });
});
