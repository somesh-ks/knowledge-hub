import { describe, expect, it } from "vitest";
import {
  CARRIED_ATTRIBUTES,
  carryNavigationKind,
  carryRootAttributes,
  NAV_ATTRIBUTE,
  navigationKind,
} from "./navigation";
import { shouldActivateUpdate } from "./serviceWorker";

const url = (path: string) => new URL(path, "https://news.someshks.work");

describe("navigationKind", () => {
  it("fades through between destinations at the same level", () => {
    expect(navigationKind(url("/"), url("/archive"))).toBe("peer");
    expect(navigationKind(url("/archive"), url("/settings"))).toBe("peer");
    expect(navigationKind(url("/settings"), url("/"))).toBe("peer");
    expect(navigationKind(url("/"), url("/offline"))).toBe("peer");
    // One briefing to another is a move sideways, not deeper.
    expect(navigationKind(url("/d/2026-10-05"), url("/d/2026-10-04-weekly"))).toBe("peer");
  });

  it("goes in to a dated briefing and back out of one", () => {
    expect(navigationKind(url("/archive"), url("/d/2026-10-07"))).toBe("in");
    expect(navigationKind(url("/"), url("/d/2026-10-05"))).toBe("in");
    expect(navigationKind(url("/d/2026-10-05"), url("/archive"))).toBe("out");
    expect(navigationKind(url("/d/2026-10-05"), url("/"))).toBe("out");
  });

  it("treats a podcast episode like a dated briefing", () => {
    expect(navigationKind(url("/library"), url("/e/ep-20261007-1930"))).toBe("in");
    expect(navigationKind(url("/e/ep-20261007-1930"), url("/library"))).toBe("out");
    expect(navigationKind(url("/e/ep-20261007-1930"), url("/d/2026-10-05"))).toBe("peer");
    expect(navigationKind(url("/create"), url("/library"))).toBe("peer");
  });

  it("does not move for the page it is already on", () => {
    expect(navigationKind(url("/archive"), url("/archive"))).toBe("none");
    expect(navigationKind(url("/archive/"), url("/archive"))).toBe("none");
    expect(navigationKind(url("/"), url("/#c-ai"))).toBe("none");
  });

  it("accepts a trailing slash", () => {
    expect(navigationKind(url("/archive/"), url("/"))).toBe("peer");
    expect(navigationKind(url("/archive/"), url("/d/2026-10-07/"))).toBe("in");
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

describe("carryNavigationKind", () => {
  it("puts the mark for the move on the incoming page, where the move is drawn", () => {
    const live = fakeRoot({ [NAV_ATTRIBUTE]: "peer" });
    const incoming = fakeRoot({ "data-view": "library" });
    carryNavigationKind(live, incoming);
    expect(incoming.getAttribute(NAV_ATTRIBUTE)).toBe("peer");
  });

  it("adds nothing when no move is under way", () => {
    const incoming = fakeRoot({});
    carryNavigationKind(fakeRoot({}), incoming);
    expect(incoming.getAttribute(NAV_ATTRIBUTE)).toBeNull();
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
