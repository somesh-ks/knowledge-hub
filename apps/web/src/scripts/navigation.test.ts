import { describe, expect, it } from "vitest";
import {
  CARRIED_ATTRIBUTES,
  carryNavigationKind,
  carryRootAttributes,
  isSamePage,
  moveDirection,
  NAV_ATTRIBUTE,
  navigationKind,
} from "./navigation";
import {
  APPLY_ATTEMPTS,
  canReloadNow,
  claimApply,
  shouldActivateUpdate,
  shouldCheckForUpdate,
  UPDATE_CHECK_MS,
} from "./serviceWorker";

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
    // A Settings page is a step in, from Settings or from anywhere, and the step back out.
    expect(navigationKind(url("/settings"), url("/settings/downloads"))).toBe("in");
    expect(navigationKind(url("/settings/downloads"), url("/settings"))).toBe("out");
    expect(navigationKind(url("/settings/downloads"), url("/settings/voice"))).toBe("peer");
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

describe("isSamePage", () => {
  const here = new URL("https://news.someshks.work/library");

  it("matches the page on screen, a trailing slash or a query aside", () => {
    expect(isSamePage(new URL("https://news.someshks.work/library/"), here)).toBe(true);
    expect(isSamePage(new URL("https://news.someshks.work/library?q=x"), here)).toBe(true);
  });

  it("does not match another page or another site", () => {
    expect(isSamePage(new URL("https://news.someshks.work/"), here)).toBe(false);
    expect(isSamePage(new URL("https://example.com/library"), here)).toBe(false);
  });
});

describe("carryRootAttributes", () => {
  it("copies the theme, the style, the reader's hue and the player's state onto the incoming page", () => {
    const live = fakeRoot({
      "data-theme": "dark",
      "data-style": "expressive",
      "data-mood": "expressive",
      // The hue lives in the root's style: a page drawn once without it eases to it (owner, 2026-11-03).
      style: "--hue-shift: 120",
      "data-mini": "visible",
      "data-player": "closed",
      "data-player-state": "playing",
    });
    const incoming = fakeRoot({ "data-mini": "hidden", "data-player-state": "idle" });
    carryRootAttributes(live, incoming);
    expect(incoming.getAttribute("data-theme")).toBe("dark");
    expect(incoming.getAttribute("data-style")).toBe("expressive");
    expect(incoming.getAttribute("data-mood")).toBe("expressive");
    expect(incoming.getAttribute("style")).toBe(live.getAttribute("style"));
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

describe("shouldCheckForUpdate", () => {
  // An installed app returning to the foreground must not hit /sw.js on every switch of app.
  it("asks for a new worker at most once per interval", () => {
    expect(shouldCheckForUpdate(UPDATE_CHECK_MS - 1, 0)).toBe(false);
    expect(shouldCheckForUpdate(UPDATE_CHECK_MS, 0)).toBe(true);
  });
});

// A deploy loads itself (D202), so the reload must never cost the reader anything: a listen, an
// Undo, an open sheet, text typed and not yet saved.
describe("canReloadNow", () => {
  const idle = { playerState: "paused", overlayOpen: false, editing: false, playerOpen: false };

  it("loads the new build when nothing is in use", () => {
    expect(canReloadNow(idle)).toBe(true);
    expect(canReloadNow({ ...idle, playerState: undefined })).toBe(true);
  });

  it("waits for each thing a reload would throw away", () => {
    expect(canReloadNow({ ...idle, playerState: "playing" })).toBe(false);
    expect(canReloadNow({ ...idle, playerState: "loading" })).toBe(false);
    expect(canReloadNow({ ...idle, overlayOpen: true })).toBe(false);
    expect(canReloadNow({ ...idle, editing: true })).toBe(false);
    // A paused episode in the open player: the page hiding for a system alert used to reload it shut.
    expect(canReloadNow({ ...idle, playerOpen: true })).toBe(false);
  });
});

describe("claimApply", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
  };

  // A reload that still shows the old build (a stale answer from the network's edge) must not loop.
  it("loads a build a limited number of times", () => {
    const store = memory();
    for (let attempt = 0; attempt < APPLY_ATTEMPTS; attempt += 1) {
      expect(claimApply("b2", store)).toBe(true);
    }
    expect(claimApply("b2", store)).toBe(false);
  });

  // Without a per-tab marker a stale edge copy would reload in a loop (CodeRabbit, PR #392).
  it("does not reload when the tab cannot remember", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
    };
    expect(claimApply("b2", broken)).toBe(false);
  });

  // B, B, C, B: a claim for C must not reset B's count (CodeRabbit, PR #392).
  it("keeps the count of each build apart", () => {
    const store = memory();
    for (let attempt = 0; attempt < APPLY_ATTEMPTS; attempt += 1) claimApply("b2", store);
    expect(claimApply("b3", store)).toBe(true);
    expect(claimApply("b2", store)).toBe(false);
  });

  it("loads a build newer than the one it loaded for at once", () => {
    const store = memory();
    for (let attempt = 0; attempt < APPLY_ATTEMPTS; attempt += 1) claimApply("b2", store);
    expect(claimApply("b3", store)).toBe(true);
  });
});

// Owner, 2026-11-02: the page should arrive from the side of the tab you came from. A wrong side
// shows nothing wrong, only a page arriving from the side opposite to the move.
describe("moveDirection", () => {
  const bar = ["/", "/library", "/settings"];

  it("follows the bar between tabs", () => {
    expect(moveDirection("peer", "/", "/library", bar)).toBe("next");
    expect(moveDirection("peer", "/", "/settings", bar)).toBe("next");
    expect(moveDirection("peer", "/settings", "/library", bar)).toBe("prev");
  });

  it("goes in to the end side and out to the start side", () => {
    expect(moveDirection("in", "/library", "/library", bar)).toBe("next");
    expect(moveDirection("out", "/library", "/library", bar)).toBe("prev");
  });

  it("says nothing when the bar does not", () => {
    expect(moveDirection("peer", "/library", "/library", bar)).toBeNull();
    expect(moveDirection("peer", null, "/library", bar)).toBeNull();
    expect(moveDirection("peer", "/library", "/offline", bar)).toBeNull();
    expect(moveDirection("none", "/", "/library", bar)).toBeNull();
  });
});
