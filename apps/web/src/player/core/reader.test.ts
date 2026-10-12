import { describe, expect, it } from "vitest";
import { digestUrl, directionBetween } from "./navigation";
import { playPageChapter, togglePageDigest, togglePageItem } from "./pageActions";
import { classifyKeyTarget, type KeyLike, shouldToggleOnKey } from "./playerKeys";
import {
  barHolds,
  briefingChipView,
  briefingLengthLabel,
  createHeardTracker,
  idleBriefingChip,
  idleStoryChip,
  itemVisualState,
  resolveChapterFirstItemId,
  resolveItemId,
  storyChipView,
  storyLengthLabel,
} from "./readerMath";
import { createHarness, makeDigest, makeDigestWithoutAudio } from "./testing";

describe("where the playhead is, per story", () => {
  it("marks items played, current or upcoming, and nothing when there is no playhead", () => {
    const heard = new Set([0, 1]);
    expect(itemVisualState(0, true, 2, false, heard)).toBe("played");
    expect(itemVisualState(1, true, 2, false, heard)).toBe("played");
    expect(itemVisualState(2, true, 2, false, heard)).toBe("current");
    expect(itemVisualState(3, true, 2, false, heard)).toBe("");
    // The story the recording ended in is played, not current.
    expect(itemVisualState(2, true, 2, true, new Set([0, 1, 2]))).toBe("played");
    expect(itemVisualState(0, false, 0, false, heard)).toBe("");
    // A story that was heard earlier stays played when the playhead goes back before it.
    expect(itemVisualState(1, true, 0, false, heard)).toBe("played");
  });
});

describe("which stories were heard", () => {
  it("marks a story when playing goes on out of it, and none for a jump over stories", () => {
    const tracker = createHeardTracker();
    tracker.reset(0);
    // Play from here on story 3: nothing was heard of the two it stepped over.
    tracker.moved(2, "select");
    expect([...tracker.heard]).toEqual([]);
    // Playing went on into story 4, then 5: story 3 and 4 were heard.
    tracker.moved(3, "auto");
    tracker.moved(4, "auto");
    expect([...tracker.heard]).toEqual([2, 3]);
  });

  it("marks nothing for a scrub, a seek, a key step or Next and Previous", () => {
    const tracker = createHeardTracker();
    tracker.reset(0);
    for (const [to, cause] of [
      [1, "scrub"],
      [2, "scrub"],
      [3, "seek"],
      [4, "keyboard"],
      [5, "skip-next"],
      [4, "skip-previous"],
    ] as const) {
      tracker.moved(to, cause);
    }
    expect([...tracker.heard]).toEqual([]);
  });

  it("does not mark the rundown, and marks the last story when the recording ends", () => {
    const tracker = createHeardTracker();
    tracker.reset(-1);
    tracker.moved(0, "auto");
    expect([...tracker.heard]).toEqual([]);
    tracker.moved(1, "auto");
    tracker.ended();
    expect([...tracker.heard].sort()).toEqual([0, 1]);
  });

  it("starts afresh after the end, so a replay shows nothing played before it has played it", () => {
    const tracker = createHeardTracker();
    tracker.reset(0);
    tracker.moved(1, "auto");
    tracker.ended();
    expect(tracker.heard.size).toBe(2);
    tracker.moved(0, "seek");
    expect(tracker.heard.size).toBe(0);
    tracker.moved(1, "auto");
    expect([...tracker.heard]).toEqual([0]);
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

describe("chip lengths", () => {
  it("writes a briefing as whole minutes, never less than one", () => {
    expect(briefingLengthLabel(480_000)).toBe("8 min");
    expect(briefingLengthLabel(449_000)).toBe("7 min");
    expect(briefingLengthLabel(450_000)).toBe("8 min");
    expect(briefingLengthLabel(36_000)).toBe("1 min");
    expect(briefingLengthLabel(0)).toBe("1 min");
  });

  it("writes a story as a clock rounded to the second, and nothing without marks", () => {
    expect(storyLengthLabel(0, 24_000)).toBe("0:24");
    expect(storyLengthLabel(30_000, 94_600)).toBe("1:05");
    expect(storyLengthLabel(null, null)).toBe("");
    expect(storyLengthLabel(0, null)).toBe("");
  });
});

describe("the briefing chip", () => {
  function stateFor(status: Parameters<typeof briefingChipView>[0]["status"], extra = {}) {
    const harness = createHarness();
    harness.store.load(makeDigest());
    return { ...harness.store.getState(), status, ...extra };
  }

  it("offers the full length before anything has played", () => {
    expect(briefingChipView(stateFor("idle"), 0, makeDigest())).toEqual({
      state: "idle",
      playing: false,
      label: "2 min",
      name: "Play the briefing, 2 min",
    });
    expect(idleBriefingChip("8 min").name).toBe("Play the briefing, 8 min");
  });

  it("offers to resume a remembered position, in whole minutes left", () => {
    expect(briefingChipView(stateFor("idle"), 20, makeDigest())).toEqual({
      state: "idle",
      playing: false,
      label: "2 min left",
      name: "Resume the briefing, 2 min left",
    });
    expect(briefingChipView(stateFor("idle"), 61, makeDigest()).label).toBe("1 min left");
    expect(briefingChipView(stateFor("idle"), 119, makeDigest()).label).toBe("1 min left");
  });

  it("rounds the time left as it rounds the length, so one recording has one length", () => {
    const digest = { ...makeDigest(), audio: { url: "/a.mp3", duration_ms: 130_000 } };
    const paused = { ...stateFor("paused"), duration: 130 };
    expect(briefingChipView(paused, 1, digest).label).toBe("2 min left");
    expect(briefingLengthLabel(130_000)).toBe("2 min");
  });

  it("says the loaded audio's real length once it is known, not the page's estimate", () => {
    const estimate = { ...makeDigest(), audio: { url: "/a.mp3", duration_ms: 300_000 } };
    const loaded = { ...stateFor("idle"), duration: 130 };
    expect(briefingChipView(loaded, 0, estimate).label).toBe("2 min");
    expect(briefingChipView({ ...loaded, duration: 0 }, 0, estimate).label).toBe("5 min");
  });

  it("follows playback: playing, paused, played, try again", () => {
    // Playing, the briefing's chip is a pause button with the time left, not a second "Playing".
    expect(briefingChipView(stateFor("playing"), 86, makeDigest())).toEqual({
      state: "current",
      playing: true,
      label: "1 min left",
      name: "Pause the briefing, 1 min left",
    });
    expect(briefingChipView(stateFor("paused"), 30, makeDigest())).toEqual({
      state: "current",
      playing: false,
      label: "2 min left",
      name: "Resume the briefing, 2 min left",
    });
    expect(briefingChipView(stateFor("ended"), 120, makeDigest())).toEqual({
      state: "played",
      playing: false,
      label: "Played",
      name: "Play the briefing again, played",
    });
    expect(briefingChipView(stateFor("error"), 86, makeDigest())).toEqual({
      state: "error",
      playing: false,
      label: "Try again",
      name: "Try again",
    });
  });

  it("shows the playing face for the first 300 ms of buffering, then that it is loading", () => {
    const early = briefingChipView(stateFor("loading", { buffering: false }), 0, makeDigest());
    expect(early).toMatchObject({ state: "current", label: "2 min left", playing: true });
    const late = briefingChipView(stateFor("loading", { buffering: true }), 0, makeDigest());
    expect(late).toEqual({
      state: "preparing",
      playing: true,
      label: "Loading",
      name: "Pause the briefing, loading",
    });
  });

  it("names an episode an episode, in every state", () => {
    expect(idleBriefingChip("5 min", "episode").name).toBe("Play the episode, 5 min");
    const names = (["idle", "playing", "paused", "ended"] as const).map(
      (status) => briefingChipView(stateFor(status), 30, makeDigest(), "episode").name,
    );
    expect(names).toEqual([
      "Resume the episode, 2 min left",
      "Pause the episode, 2 min left",
      "Resume the episode, 2 min left",
      "Play the episode again, played",
    ]);
    for (const name of names) expect(name).not.toContain("briefing");
  });

  it("is a plain play chip when another briefing is loaded", () => {
    const other = makeDigest({ id: "2026-10-05", audio: { url: "/a.mp3", duration_ms: 480_000 } });
    expect(briefingChipView(stateFor("playing"), 86, other)).toEqual(idleBriefingChip("8 min"));
  });

  it("always says the action and carries the visible text in its name", () => {
    const statuses = ["idle", "playing", "loading", "paused", "ended", "error"] as const;
    for (const status of statuses) {
      for (const buffering of [false, true]) {
        const view = briefingChipView(stateFor(status, { buffering }), 40, makeDigest());
        expect(view.name.toLowerCase()).toContain(view.label.toLowerCase());
        expect(view.name).toMatch(/^(Play|Pause|Resume|Try again)/);
      }
    }
  });
});

describe("the floating Play button", () => {
  it("steps aside only while the bar holds the page's audio", () => {
    expect(barHolds({ hasStarted: true, digestId: "2026-10-05" }, "2026-10-05")).toBe(true);
    // Another recording is in the bar: Play stays, and a press loads the page's own.
    expect(barHolds({ hasStarted: true, digestId: "2026-10-07" }, "2026-10-05")).toBe(false);
    // Loaded for the page but never played: there is no bar to stand for it yet.
    expect(barHolds({ hasStarted: false, digestId: "2026-10-05" }, "2026-10-05")).toBe(false);
    expect(barHolds({ hasStarted: false, digestId: null }, undefined)).toBe(false);
  });

  it("is held from the press that plays the page, as the bar appears", () => {
    const harness = createHarness();
    const page = makeDigest();
    harness.store.setPageDigest(page);
    harness.audio.loadMetadata(120);
    expect(barHolds(harness.store.getState(), page.id)).toBe(false);
    togglePageDigest(harness.store);
    expect(barHolds(harness.store.getState(), page.id)).toBe(true);
  });
});

describe("a story chip", () => {
  const headline = "The safe triangle, rebuilt";

  it("shows its length and plays from its story while it is upcoming", () => {
    expect(storyChipView("", false, false, "0:30", headline)).toEqual({
      state: "idle",
      playing: false,
      label: "0:30",
      name: "Play from here, 0:30: The safe triangle, rebuilt",
    });
    // Another story is playing: this one still offers its own length.
    expect(storyChipView("", true, false, "0:30", headline).label).toBe("0:30");
  });

  it("has a name without a length while the briefing has no audio", () => {
    expect(idleStoryChip("", headline)).toEqual({
      state: "idle",
      playing: false,
      label: "",
      name: "Play from here: The safe triangle, rebuilt",
    });
  });

  it("says Playing, Paused or Loading for the story being read", () => {
    expect(storyChipView("current", true, false, "0:30", headline)).toEqual({
      state: "current",
      playing: true,
      label: "Playing",
      name: "Pause, playing: The safe triangle, rebuilt",
    });
    expect(storyChipView("current", false, false, "0:30", headline)).toEqual({
      state: "current",
      playing: false,
      label: "Paused",
      name: "Resume, paused: The safe triangle, rebuilt",
    });
    expect(storyChipView("current", true, true, "0:30", headline)).toEqual({
      state: "preparing",
      playing: true,
      label: "Loading",
      name: "Pause, loading: The safe triangle, rebuilt",
    });
  });

  it("says Played once the playhead has passed it", () => {
    expect(storyChipView("played", true, false, "0:30", headline)).toEqual({
      state: "played",
      playing: false,
      label: "Played",
      name: "Play again, played: The safe triangle, rebuilt",
    });
  });
});

describe("what a tap on the page does", () => {
  function playing() {
    const harness = createHarness();
    harness.store.setPageDigest(makeDigest());
    harness.audio.loadMetadata(120);
    return harness;
  }

  it("toggles the page's digest from the briefing chip", () => {
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
    togglePageItem(harness.store, "a1b2c3d4e5f6");
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
