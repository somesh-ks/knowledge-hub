import { describe, expect, it } from "vitest";
import { digestUrl, directionBetween } from "./navigation";
import { playPageChapter, playPageItemAt, togglePageDigest, togglePageItem } from "./pageActions";
import { classifyKeyTarget, type KeyLike, shouldToggleOnKey } from "./playerKeys";
import {
  ctaView,
  itemVisualState,
  nearestNodeIndex,
  railProgress,
  resolveChapterFirstItemId,
  resolveItemId,
} from "./readerMath";
import { createHarness, makeDigest, makeDigestWithoutAudio } from "./testing";
import { buildTimeline } from "./timeline";

describe("the rail", () => {
  const timeline = buildTimeline(makeDigest());
  // Four item nodes down a 1000px briefing.
  const nodeY = [40, 280, 520, 760];

  it("fills piecewise linearly between node centers, by time", () => {
    expect(railProgress(nodeY, 1000, timeline, 0, 0, false)).toBeCloseTo(0.04, 5);
    expect(railProgress(nodeY, 1000, timeline, 0, 15, false)).toBeCloseTo(0.16, 5);
    expect(railProgress(nodeY, 1000, timeline, 1, 30, false)).toBeCloseTo(0.28, 5);
    expect(railProgress(nodeY, 1000, timeline, 1, 45, false)).toBeCloseTo(0.4, 5);
  });

  it("runs the last item to the bottom of the briefing and fills it when the digest ends", () => {
    expect(railProgress(nodeY, 1000, timeline, 3, 90, false)).toBeCloseTo(0.76, 5);
    expect(railProgress(nodeY, 1000, timeline, 3, 105, false)).toBeCloseTo(0.88, 5);
    expect(railProgress(nodeY, 1000, timeline, 3, 120, true)).toBe(1);
  });

  it("is empty without measurements, a timeline or a height", () => {
    expect(railProgress([], 1000, timeline, 0, 10, false)).toBe(0);
    expect(railProgress(nodeY, 0, timeline, 0, 10, false)).toBe(0);
    expect(railProgress(nodeY, 1000, null, 0, 10, false)).toBe(0);
  });

  it("resolves a tap to the nearest node, skipping unmeasured items", () => {
    expect(nearestNodeIndex(nodeY, 100)).toBe(0);
    expect(nearestNodeIndex(nodeY, 410)).toBe(2);
    expect(nearestNodeIndex(nodeY, 5000)).toBe(3);
    expect(nearestNodeIndex([undefined, 300], 10)).toBe(1);
    expect(nearestNodeIndex([], 10)).toBe(-1);
  });

  it("marks items played, current or upcoming, and nothing when there is no playhead", () => {
    expect(itemVisualState(0, true, 2, false)).toBe("played");
    expect(itemVisualState(2, true, 2, false)).toBe("current");
    expect(itemVisualState(3, true, 2, false)).toBe("");
    expect(itemVisualState(3, true, 2, true)).toBe("played");
    expect(itemVisualState(0, false, 0, false)).toBe("");
  });
});

describe("reader markup contract", () => {
  const digest = makeDigest();

  it("accepts an item by id, by index or by where the button sits", () => {
    expect(resolveItemId("c1b2c3d4e5f6", digest, undefined)).toBe("c1b2c3d4e5f6");
    expect(resolveItemId("1", digest, undefined)).toBe("b1b2c3d4e5f6");
    expect(resolveItemId(undefined, digest, "d1b2c3d4e5f6")).toBe("d1b2c3d4e5f6");
    expect(resolveItemId("", digest, "a1b2c3d4e5f6")).toBe("a1b2c3d4e5f6");
  });

  it("rejects an item the digest does not have", () => {
    expect(resolveItemId("nope", digest, undefined)).toBeNull();
    expect(resolveItemId("9", digest, undefined)).toBeNull();
    expect(resolveItemId(undefined, digest, "zzz")).toBeNull();
    expect(resolveItemId("0", null, undefined)).toBeNull();
  });

  it("accepts a chapter by slug or by the index of its first item", () => {
    expect(resolveChapterFirstItemId("ai", digest)).toBe("c1b2c3d4e5f6");
    expect(resolveChapterFirstItemId("ui-craft", digest)).toBe("b1b2c3d4e5f6");
    expect(resolveChapterFirstItemId("3", digest)).toBe("d1b2c3d4e5f6");
    expect(resolveChapterFirstItemId("research", digest)).toBeNull();
    expect(resolveChapterFirstItemId(undefined, digest)).toBeNull();
  });
});

describe("the call to action", () => {
  function stateFor(status: Parameters<typeof ctaView>[0]["status"], extra = {}) {
    const harness = createHarness();
    harness.store.load(makeDigest());
    return { ...harness.store.getState(), status, ...extra };
  }

  it("offers the full length before anything has played", () => {
    expect(ctaView(stateFor("idle"), 0, makeDigest())).toEqual({
      label: "Play the briefing",
      clock: "2:00",
      playing: false,
      loading: false,
    });
  });

  it("offers to resume a remembered position", () => {
    const view = ctaView(stateFor("idle"), 58, makeDigest());
    expect(view.label).toBe("Resume");
    expect(view.clock).toBe("0:58 of 2:00");
  });

  it("follows playback: pause, resume, play again, try again", () => {
    expect(ctaView(stateFor("playing"), 86, makeDigest())).toMatchObject({
      label: "Pause",
      clock: "1:26 of 2:00",
      playing: true,
    });
    expect(ctaView(stateFor("paused"), 86, makeDigest()).label).toBe("Resume");
    expect(ctaView(stateFor("ended"), 120, makeDigest()).label).toBe("Play again");
    expect(ctaView(stateFor("error"), 86, makeDigest()).label).toBe("Try again");
  });

  it("keeps the label steady for the first 300 ms of buffering, then says what is happening", () => {
    const early = ctaView(stateFor("loading", { buffering: false }), 0, makeDigest());
    expect(early).toMatchObject({ label: "Pause", playing: true, loading: false });
    const late = ctaView(stateFor("loading", { buffering: true }), 0, makeDigest());
    expect(late).toMatchObject({ label: "Preparing audio", playing: true, loading: true });
  });

  it("is a plain play button when another digest is loaded", () => {
    const view = ctaView(stateFor("playing"), 86, makeDigest({ id: "2026-10-05" }));
    expect(view).toMatchObject({ label: "Play the briefing", playing: false });
  });
});

describe("what a tap on the page does", () => {
  function playing() {
    const harness = createHarness();
    harness.store.setPageDigest(makeDigest());
    harness.audio.loadMetadata(120);
    return harness;
  }

  it("toggles the page's digest from the hero button", () => {
    const { store, audio } = playing();
    togglePageDigest(store);
    audio.startPlaying();
    expect(store.getState().status).toBe("playing");
    togglePageDigest(store);
    expect(store.getState().status).toBe("paused");
  });

  it("loads the page's digest first when another one is loaded", () => {
    const harness = createHarness();
    harness.store.load(
      makeDigest({ id: "2026-10-05", audio: { url: "/a/old.mp3", duration_ms: 60_000 } }),
    );
    // Something has played, so the loaded track stays when the page changes.
    harness.audio.loadMetadata(60);
    harness.store.play();
    harness.audio.startPlaying();
    harness.store.setPageDigest(makeDigest());
    expect(harness.store.getState().digestId).toBe("2026-10-05");
    togglePageDigest(harness.store);
    expect(harness.store.getState().digestId).toBe("2026-10-07");
    expect(harness.audio.src).toBe("/audio/2026-10-07.mp3");
  });

  it("does nothing for a digest without audio", () => {
    const harness = createHarness();
    harness.store.setPageDigest(makeDigestWithoutAudio());
    togglePageDigest(harness.store);
    playPageItemAt(harness.store, 0);
    expect(harness.createdAudios).toHaveLength(0);
  });

  it("plays an item, pauses the playing item, and resumes a paused one where it stopped", () => {
    const { store, audio } = playing();
    togglePageItem(store, "c1b2c3d4e5f6");
    audio.startPlaying();
    expect(store.getTime()).toBe(60);
    audio.currentTime = 72;
    store.pause();
    togglePageItem(store, "c1b2c3d4e5f6");
    expect(audio.currentTime).toBe(72);
    expect(store.getState().status).toBe("loading");
    audio.startPlaying();
    togglePageItem(store, "c1b2c3d4e5f6");
    expect(store.getState().status).toBe("paused");
  });

  it("restarts an item from its beginning when it is not the current one", () => {
    const { store, audio } = playing();
    togglePageItem(store, "d1b2c3d4e5f6");
    audio.startPlaying();
    togglePageItem(store, "b1b2c3d4e5f6");
    expect(store.getTime()).toBe(30);
  });

  it("plays a chapter from its first item", () => {
    const { store } = playing();
    playPageChapter(store, "c1b2c3d4e5f6");
    expect(store.getTime()).toBe(60);
  });
});

describe("navigation", () => {
  it("points forward to a newer briefing and back to an older one", () => {
    expect(directionBetween("2026-10-05", "2026-10-07")).toBe("forward");
    expect(directionBetween("2026-10-07", "2026-10-05")).toBe("back");
    expect(directionBetween("2026-10-07", "2026-10-07-weekly")).toBe("forward");
    expect(directionBetween("2026-10-07-weekly", "2026-10-07")).toBe("back");
    expect(directionBetween(null, "2026-10-07")).toBe("forward");
    expect(directionBetween("junk", "2026-10-07")).toBe("forward");
  });

  it("builds the page address of a digest", () => {
    expect(digestUrl("2026-10-07")).toBe("/d/2026-10-07");
  });
});

describe("the player's keyboard shortcut", () => {
  const press = (key: string, modifiers: Partial<KeyLike> = {}): KeyLike => ({
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  });

  it("toggles on K from anywhere in the player", () => {
    for (const target of ["panel", "slider", "control", "other"] as const) {
      expect(shouldToggleOnKey(press("k"), target)).toBe(true);
    }
  });

  it("toggles on Space from the panel and the scrubber, never from a button", () => {
    expect(shouldToggleOnKey(press(" "), "panel")).toBe(true);
    expect(shouldToggleOnKey(press(" "), "slider")).toBe(true);
    expect(shouldToggleOnKey(press(" "), "control")).toBe(false);
  });

  it("leaves browser and system shortcuts alone", () => {
    expect(shouldToggleOnKey(press("k", { ctrlKey: true }), "panel")).toBe(false);
    expect(shouldToggleOnKey(press("k", { metaKey: true }), "panel")).toBe(false);
    expect(shouldToggleOnKey(press(" ", { shiftKey: true }), "panel")).toBe(false);
    expect(shouldToggleOnKey(press("Enter"), "panel")).toBe(false);
  });

  it("classifies where a key went", () => {
    const panel = { closest: () => null } as unknown as Element;
    const button = {
      closest: (selector: string) => (selector.startsWith("button") ? {} : null),
    } as unknown as Element;
    const slider = {
      closest: (selector: string) => (selector.includes("slider") ? {} : null),
    } as unknown as Element;
    expect(classifyKeyTarget(panel, panel)).toBe("panel");
    expect(classifyKeyTarget(button, panel)).toBe("control");
    expect(classifyKeyTarget(slider, panel)).toBe("slider");
    expect(classifyKeyTarget(null, panel)).toBe("other");
    expect(classifyKeyTarget({ closest: () => null } as unknown as Element, panel)).toBe("other");
  });
});
