import { describe, expect, it } from "vitest";
import { CARRIED_ATTRIBUTES, carryRootAttributes, navigationKind } from "./navigation";
import { shouldActivateUpdate } from "./serviceWorker";

const url = (path: string) => new URL(path, "https://news.someshks.work");

describe("navigationKind", () => {
  it("animates only the hop between the reader and the archive", () => {
    expect(navigationKind(url("/"), url("/archive"))).toBe("archive");
    expect(navigationKind(url("/archive"), url("/"))).toBe("archive");
    expect(navigationKind(url("/archive"), url("/d/2026-10-07"))).toBe("archive");
    expect(navigationKind(url("/d/2026-10-05"), url("/archive"))).toBe("archive");
  });

  it("leaves every other navigation instant", () => {
    expect(navigationKind(url("/"), url("/d/2026-10-05"))).toBe("none");
    expect(navigationKind(url("/d/2026-10-05"), url("/d/2026-10-04-weekly"))).toBe("none");
    expect(navigationKind(url("/archive"), url("/archive"))).toBe("none");
    expect(navigationKind(url("/"), url("/offline"))).toBe("none");
  });

  it("accepts a trailing slash", () => {
    expect(navigationKind(url("/archive/"), url("/"))).toBe("archive");
  });
});

/** A root element that records attributes, standing in for document.documentElement. */
function fakeRoot(initial: Record<string, string> = {}): HTMLElement {
  const attributes = new Map(Object.entries(initial));
  return {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    attributes,
  } as unknown as HTMLElement;
}

describe("carryRootAttributes", () => {
  it("copies the theme and the player's state onto the incoming page", () => {
    const live = fakeRoot({
      "data-theme": "dark",
      "data-mini": "visible",
      "data-player": "closed",
      "data-player-state": "playing",
    });
    const incoming = fakeRoot({ "data-mini": "hidden", "data-player-state": "idle" });
    carryRootAttributes(live, incoming);
    expect(incoming.getAttribute("data-theme")).toBe("dark");
    expect(incoming.getAttribute("data-mini")).toBe("visible");
    expect(incoming.getAttribute("data-player")).toBe("closed");
    expect(incoming.getAttribute("data-player-state")).toBe("playing");
  });

  it("clears an attribute the live page does not have", () => {
    const live = fakeRoot({});
    const incoming = fakeRoot({ "data-theme": "light" });
    carryRootAttributes(live, incoming);
    expect(incoming.getAttribute("data-theme")).toBeNull();
  });

  it("leaves the incoming page's own attributes alone", () => {
    const live = fakeRoot({ "data-view": "home" });
    const incoming = fakeRoot({ "data-view": "archive", "data-digest-id": "2026-10-07" });
    carryRootAttributes(live, incoming);
    expect(incoming.getAttribute("data-view")).toBe("archive");
    expect(incoming.getAttribute("data-digest-id")).toBe("2026-10-07");
  });

  it("carries the connection flag too", () => {
    expect(CARRIED_ATTRIBUTES).toContain("data-offline");
  });
});

describe("shouldActivateUpdate", () => {
  it("waits while audio plays or buffers", () => {
    expect(shouldActivateUpdate("playing")).toBe(false);
    expect(shouldActivateUpdate("loading")).toBe(false);
  });

  it("goes ahead otherwise", () => {
    for (const state of ["idle", "paused", "ended", "error", undefined]) {
      expect(shouldActivateUpdate(state)).toBe(true);
    }
  });
});
