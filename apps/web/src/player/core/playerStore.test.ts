import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEDIA_ERR_NETWORK, MEDIA_ERR_SRC_NOT_SUPPORTED } from "./audioErrors";
import { BUFFERING_DELAY_MS, RESUME_SAVE_INTERVAL_MS } from "./playerStore";
import { playedKey, resumeKey } from "./resume";
import { createHarness, makeDigest, makeDigestWithoutAudio } from "./testing";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Loads the digest, lets metadata arrive and starts playback the way a tap does. */
function startPlaying(harness: ReturnType<typeof createHarness>, digest = makeDigest()): void {
  harness.store.load(digest);
  harness.audio.loadMetadata(120);
  harness.store.play();
  harness.audio.startPlaying();
}

describe("loading", () => {
  it("attaches the source with preload metadata and waits for a tap", () => {
    const { store, audio } = createHarness();
    store.load(makeDigest());
    expect(audio.src).toBe("/audio/2026-10-07.mp3");
    expect(audio.preload).toBe("metadata");
    expect(audio.playCalls).toBe(0);
    expect(store.getState()).toMatchObject({
      status: "idle",
      availability: "ready",
      duration: 120,
      hasStarted: false,
    });
  });

  it("creates the audio element lazily, and only once", () => {
    const harness = createHarness();
    expect(harness.createdAudios).toHaveLength(0);
    harness.store.load(makeDigest());
    harness.store.load(
      makeDigest({ id: "2026-10-05", audio: { url: "/audio/b.mp3", duration_ms: 90_000 } }),
    );
    expect(harness.createdAudios).toHaveLength(1);
  });

  it("shows the audio-preparing state for a digest without audio and never creates an element", () => {
    const harness = createHarness();
    harness.store.load(makeDigestWithoutAudio());
    expect(harness.store.getState().availability).toBe("preparing");
    harness.store.play();
    harness.store.next();
    harness.store.seekTo(5_000);
    expect(harness.createdAudios).toHaveLength(0);
    expect(harness.store.getState().status).toBe("idle");
  });

  it("applies the preferred playback rate with pitch preserved", () => {
    const harness = createHarness({ getPreferredRate: () => 1.5 });
    harness.store.load(makeDigest());
    expect(harness.audio.playbackRate).toBe(1.5);
    expect(harness.audio.defaultPlaybackRate).toBe(1.5);
    expect(harness.audio.preservesPitch).toBe(true);
    expect(harness.audio.webkitPreservesPitch).toBe(true);
    expect(harness.store.getState().rate).toBe(1.5);
  });

  it("refreshes the track when the same digest loads again, without touching the source", () => {
    const harness = createHarness();
    harness.store.load(makeDigest());
    const before = harness.audio.src;
    harness.audio.src = "kept";
    harness.store.load(makeDigest());
    expect(before).toBe("/audio/2026-10-07.mp3");
    expect(harness.audio.src).toBe("kept");
  });
});

describe("play and pause", () => {
  it("emits willPlay before the element starts, then settles on playing", () => {
    const harness = createHarness();
    harness.store.load(makeDigest());
    harness.audio.loadMetadata(120);
    let playCallsAtCue = -1;
    harness.store.onEvent((event) => {
      if (event.type === "willPlay") playCallsAtCue = harness.audio.playCalls;
    });
    harness.store.play();
    expect(playCallsAtCue).toBe(0);
    expect(harness.audio.playCalls).toBe(1);
    expect(harness.store.getState()).toMatchObject({ status: "loading", hasStarted: true });
    harness.audio.startPlaying();
    expect(harness.store.getState().status).toBe("playing");
    expect(harness.store.isNarrating()).toBe(true);
  });

  it("emits didPause after the element has paused", () => {
    const harness = createHarness();
    startPlaying(harness);
    let pausedAtCue: boolean | null = null;
    harness.store.onEvent((event) => {
      if (event.type === "didPause") pausedAtCue = harness.audio.paused;
    });
    harness.store.pause();
    expect(pausedAtCue).toBe(true);
    expect(harness.store.getState().status).toBe("paused");
    expect(harness.store.isNarrating()).toBe(false);
  });

  it("toggle flips between playing and paused", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.store.toggle();
    expect(harness.store.getState().status).toBe("paused");
    harness.store.toggle();
    expect(harness.store.getState().status).toBe("loading");
    harness.audio.startPlaying();
    expect(harness.store.getState().status).toBe("playing");
  });

  it("ignores a second play while already playing", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.store.play();
    expect(harness.audio.playCalls).toBe(1);
  });

  it("does not auto-play after a source swap", () => {
    const harness = createHarness();
    harness.store.load(makeDigest());
    harness.audio.loadMetadata(120);
    harness.audio.startPlaying();
    expect(harness.store.getState().status).toBe("idle");
  });
});

describe("the playhead", () => {
  it("reads the element on every frame and notifies frame listeners", () => {
    const harness = createHarness();
    startPlaying(harness);
    const seen: number[] = [];
    harness.store.onFrame((time) => seen.push(time));
    harness.audio.currentTime = 12.5;
    harness.flushFrames();
    harness.audio.currentTime = 12.6;
    harness.flushFrames();
    expect(seen).toEqual([12.5, 12.6]);
    expect(harness.store.getTime()).toBe(12.6);
  });

  it("keeps the state snapshot stable while frames advance inside an item", () => {
    const harness = createHarness();
    startPlaying(harness);
    const snapshot = harness.store.getState();
    harness.audio.currentTime = 5;
    harness.flushFrames();
    harness.audio.currentTime = 6;
    harness.flushFrames();
    expect(harness.store.getState()).toBe(snapshot);
  });

  it("changes the snapshot and emits itemChanged when the playhead crosses an item", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.audio.currentTime = 31;
    harness.flushFrames();
    expect(harness.store.getState().itemIndex).toBe(1);
    expect(harness.store.getState().sectionIndex).toBe(1);
    expect(harness.events).toContainEqual({ type: "itemChanged", index: 1, cause: "auto" });
  });

  it("calls second listeners once per whole second and on every seek", () => {
    const harness = createHarness();
    startPlaying(harness);
    let ticks = 0;
    harness.store.onSecond(() => {
      ticks += 1;
    });
    harness.audio.currentTime = 1.1;
    harness.flushFrames();
    harness.audio.currentTime = 1.6;
    harness.flushFrames();
    expect(ticks).toBe(1);
    harness.audio.currentTime = 2.0;
    harness.flushFrames();
    expect(ticks).toBe(2);
    harness.store.seekTo(2_500);
    expect(ticks).toBe(3);
  });

  it("stops the frame loop when playback pauses", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.store.pause();
    const seen: number[] = [];
    harness.store.onFrame((time) => seen.push(time));
    harness.flushFrames(3);
    expect(seen).toEqual([]);
  });
});

describe("seeking and items", () => {
  it("seekTo takes milliseconds and moves the element", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.store.seekTo(45_000);
    expect(harness.audio.currentTime).toBe(45);
    expect(harness.store.getTime()).toBe(45);
    expect(harness.store.getState().itemIndex).toBe(1);
  });

  it("queues a seek made before metadata and applies it on loadedmetadata", () => {
    const harness = createHarness();
    harness.store.load(makeDigest());
    harness.store.seekTo(70_000);
    expect(harness.store.getTime()).toBe(70);
    expect(harness.audio.currentTime).toBe(0);
    harness.audio.loadMetadata(120);
    expect(harness.audio.currentTime).toBe(70);
  });

  it("does not take the unlock primer's silence for the recording, so nothing is stored as played", () => {
    const harness = createHarness();
    const digest = makeDigest();
    harness.store.load(digest);
    // A tap loaded 0.05 s of silence so the phone would let the element start later.
    harness.audio.loadMetadata(0.05);
    expect(harness.store.getState().duration).toBe(120);
    // The page's own digest arrives with other audio: the track reloads and saves where it was.
    harness.store.setPageDigest({
      ...digest,
      audio: { url: "/audio/other.mp3", duration_ms: 120_000 },
    });
    expect(harness.storage.getItem(playedKey(digest.id))).toBeNull();
  });

  it("clamps seeks to the digest", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.store.seekTo(-5_000);
    expect(harness.store.getTime()).toBe(0);
    harness.store.seekTo(500_000);
    expect(harness.store.getTime()).toBe(120);
  });

  it("skips fifteen seconds either way", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.audio.currentTime = 20;
    harness.flushFrames();
    harness.store.skip(15);
    expect(harness.store.getTime()).toBe(35);
    harness.store.skip(-15);
    harness.store.skip(-15);
    expect(harness.store.getTime()).toBe(5);
    harness.store.skip(-15);
    expect(harness.store.getTime()).toBe(0);
  });

  it("goes to the next item and reports the end of the list", () => {
    const harness = createHarness();
    startPlaying(harness);
    expect(harness.store.next()).toBe(true);
    expect(harness.store.getTime()).toBe(30);
    harness.store.seekTo(100_000);
    expect(harness.store.next()).toBe(false);
  });

  it("restarts the item when more than three seconds in, otherwise goes back one", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.store.seekTo(36_000);
    expect(harness.store.previous()).toBe(true);
    expect(harness.store.getTime()).toBe(30);
    harness.store.seekTo(31_500);
    harness.store.previous();
    expect(harness.store.getTime()).toBe(0);
    harness.store.seekTo(2_000);
    harness.store.previous();
    expect(harness.store.getTime()).toBe(0);
  });

  it("treats a lead-in before the first story as no story: Next goes to story 1, Previous to 0:00", () => {
    const harness = createHarness();
    const led = makeDigest({
      items: makeDigest().items.map((entry, index) =>
        index === 0 ? { ...entry, start_ms: 18_600 } : entry,
      ),
    });
    startPlaying(harness, led);
    harness.store.seekTo(5_000);
    expect(harness.store.getState().itemIndex).toBe(-1);
    expect(harness.store.next()).toBe(true);
    expect(harness.store.getTime()).toBe(18.6);
    expect(harness.store.getState().itemIndex).toBe(0);
    harness.store.seekTo(5_000);
    expect(harness.store.previous()).toBe(true);
    expect(harness.store.getTime()).toBe(0);
    expect(harness.store.getState().itemIndex).toBe(-1);
    // At 0:00 there is nothing further back.
    expect(harness.store.previous()).toBe(false);
    // Previous from the first seconds of story 1 goes back to the rundown's start.
    harness.store.seekTo(19_000);
    harness.store.previous();
    expect(harness.store.getTime()).toBe(0);
  });

  it("emits itemChanged for a skip even when the previous press only restarts the item", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.store.seekTo(36_000);
    harness.events.length = 0;
    harness.store.previous();
    harness.store.seekTo(34_000);
    harness.events.length = 0;
    harness.store.previous();
    expect(harness.events).toContainEqual({
      type: "itemChanged",
      index: 1,
      cause: "skip-previous",
    });
  });

  it("marks keyboard item skips so they stay silent", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.events.length = 0;
    harness.store.next("keyboard");
    expect(harness.events).toContainEqual({ type: "itemChanged", index: 1, cause: "keyboard" });
  });

  it("plays an item by id, and ignores an unknown id", () => {
    const harness = createHarness();
    harness.store.load(makeDigest());
    harness.audio.loadMetadata(120);
    harness.store.playItem("c1b2c3d4e5f6");
    expect(harness.store.getTime()).toBe(60);
    expect(harness.audio.playCalls).toBe(1);
    harness.store.playItem("does-not-exist");
    expect(harness.store.getTime()).toBe(60);
  });

  it("keeps playing and only jumps when an item is chosen during playback", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.events.length = 0;
    harness.store.playItemAt(2);
    expect(harness.audio.playCalls).toBe(1);
    expect(harness.events.some((event) => event.type === "willPlay")).toBe(false);
    expect(harness.events).toContainEqual({ type: "itemChanged", index: 2, cause: "select" });
  });
});

describe("speed", () => {
  it("accepts the four rates, tells the element and reports the change", () => {
    const harness = createHarness();
    harness.store.load(makeDigest());
    harness.store.setRate(1.25);
    expect(harness.audio.playbackRate).toBe(1.25);
    expect(harness.store.getState().rate).toBe(1.25);
    expect(harness.rateChanges).toEqual([1.25]);
    expect(harness.events).toContainEqual({ type: "rateChanged", rate: 1.25 });
  });

  it("ignores rates outside the four and repeats of the current one", () => {
    const harness = createHarness();
    harness.store.load(makeDigest());
    harness.store.setRate(3);
    harness.store.setRate(1);
    expect(harness.rateChanges).toEqual([]);
  });

  it("restores the element's rate if the browser resets it", () => {
    const harness = createHarness();
    harness.store.load(makeDigest());
    harness.store.setRate(2);
    harness.audio.playbackRate = 1;
    harness.audio.emit("ratechange");
    expect(harness.audio.playbackRate).toBe(2);
  });
});

describe("resume position", () => {
  it("saves every five seconds while playing", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.audio.currentTime = 42;
    vi.advanceTimersByTime(RESUME_SAVE_INTERVAL_MS);
    expect(harness.storage.getItem(resumeKey("2026-10-07"))).toBe("42");
    harness.audio.currentTime = 47.9;
    vi.advanceTimersByTime(RESUME_SAVE_INTERVAL_MS);
    expect(harness.storage.getItem(resumeKey("2026-10-07"))).toBe("47");
  });

  it("saves on pause and stops the timer", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.audio.currentTime = 20;
    harness.store.pause();
    expect(harness.storage.getItem(resumeKey("2026-10-07"))).toBe("20");
    harness.storage.data.clear();
    vi.advanceTimersByTime(RESUME_SAVE_INTERVAL_MS * 3);
    expect(harness.storage.data.size).toBe(0);
  });

  it("restores the saved position when the digest loads", () => {
    const harness = createHarness();
    harness.storage.setItem(resumeKey("2026-10-07"), "58");
    harness.store.load(makeDigest());
    expect(harness.store.getTime()).toBe(58);
    expect(harness.store.getState().itemIndex).toBe(1);
    harness.audio.loadMetadata(120);
    expect(harness.audio.currentTime).toBe(58);
  });

  it("starts over when the saved position is at the very end", () => {
    const harness = createHarness();
    harness.storage.setItem(resumeKey("2026-10-07"), "119");
    harness.store.load(makeDigest());
    expect(harness.store.getTime()).toBe(0);
  });

  it("forgets the position when the digest ends", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.audio.currentTime = 50;
    vi.advanceTimersByTime(RESUME_SAVE_INTERVAL_MS);
    expect(harness.storage.getItem(resumeKey("2026-10-07"))).toBe("50");
    harness.audio.finish();
    expect(harness.storage.getItem(resumeKey("2026-10-07"))).toBeNull();
  });

  it("survives storage that throws or does not exist", () => {
    const harness = createHarness();
    harness.storage.throwOnWrite = true;
    startPlaying(harness);
    harness.audio.currentTime = 10;
    expect(() => vi.advanceTimersByTime(RESUME_SAVE_INTERVAL_MS)).not.toThrow();
    const without = createHarness({ storage: null });
    without.store.load(makeDigest());
    expect(without.store.getTime()).toBe(0);
  });

  it("saves through the page-hide hook", () => {
    const hooks: { hide: (() => void) | null } = { hide: null };
    const harness = createHarness({
      onPageHide: (callback) => {
        hooks.hide = callback;
        return () => {
          hooks.hide = null;
        };
      },
    });
    startPlaying(harness);
    harness.audio.currentTime = 33;
    hooks.hide?.();
    expect(harness.storage.getItem(resumeKey("2026-10-07"))).toBe("33");
  });
});

describe("system interruptions", () => {
  it("remembers a pause the player did not ask for and offers resume instead of playing", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.clock.now += 5_000;
    harness.audio.paused = true;
    harness.audio.emit("pause");
    expect(harness.store.getState()).toMatchObject({ status: "paused", interrupted: true });
    expect(harness.events).toContainEqual({ type: "interrupted" });
    expect(harness.audio.playCalls).toBe(1);
  });

  it("does not mark its own pause as an interruption", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.store.pause();
    harness.audio.emit("pause");
    expect(harness.store.getState().interrupted).toBe(false);
  });

  it("clears the interruption when the listener plays again", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.clock.now += 5_000;
    harness.audio.paused = true;
    harness.audio.emit("pause");
    harness.store.play();
    expect(harness.store.getState().interrupted).toBe(false);
  });
});

describe("the end of a digest", () => {
  it("ends, offers the previous digest and never autoplays it", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.audio.currentTime = 120;
    harness.audio.finish();
    expect(harness.store.getState()).toMatchObject({ status: "ended", upNextId: "2026-10-05" });
    expect(harness.events).toContainEqual({ type: "ended" });
    expect(harness.audio.playCalls).toBe(1);
  });

  it("plays again from the start", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.audio.currentTime = 120;
    harness.audio.finish();
    harness.store.play();
    expect(harness.audio.currentTime).toBe(0);
    expect(harness.audio.playCalls).toBe(2);
    expect(harness.store.getState().upNextId).toBeNull();
  });

  it("plays the story Previous lands on after the end", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.audio.currentTime = 120;
    harness.audio.finish();
    expect(harness.store.getState().status).toBe("ended");
    const calls = harness.audio.playCalls;
    expect(harness.store.previous()).toBe(true);
    expect(harness.audio.playCalls).toBe(calls + 1);
    expect(["playing", "loading"]).toContain(harness.store.getState().status);
  });

  it("leaves the ended state when the listener seeks back", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.audio.currentTime = 120;
    harness.audio.finish();
    harness.store.seekTo(10_000);
    expect(harness.store.getState().status).toBe("paused");
  });
});

describe("buffering", () => {
  it("shows the spinner state only after 300 ms", () => {
    const harness = createHarness();
    harness.store.load(makeDigest());
    harness.audio.loadMetadata(120);
    harness.store.play();
    vi.advanceTimersByTime(BUFFERING_DELAY_MS - 1);
    expect(harness.store.getState()).toMatchObject({ status: "loading", buffering: false });
    vi.advanceTimersByTime(1);
    expect(harness.store.getState().buffering).toBe(true);
    harness.audio.startPlaying();
    expect(harness.store.getState()).toMatchObject({ status: "playing", buffering: false });
  });

  it("never shows it when the audio starts quickly", () => {
    const harness = createHarness();
    harness.store.load(makeDigest());
    harness.audio.loadMetadata(120);
    harness.store.play();
    vi.advanceTimersByTime(100);
    harness.audio.startPlaying();
    vi.advanceTimersByTime(1_000);
    expect(harness.store.getState().buffering).toBe(false);
  });

  it("returns to loading when the stream stalls mid-playback", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.audio.emit("waiting");
    expect(harness.store.getState().status).toBe("loading");
    vi.advanceTimersByTime(BUFFERING_DELAY_MS);
    expect(harness.store.getState().buffering).toBe(true);
    harness.audio.emit("canplay");
    expect(harness.store.getState()).toMatchObject({ status: "playing", buffering: false });
  });
});

describe("errors", () => {
  it("explains a network failure in plain language", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.audio.error = { code: MEDIA_ERR_NETWORK };
    harness.audio.emit("error");
    const state = harness.store.getState();
    expect(state.status).toBe("error");
    expect(state.error?.kind).toBe("network");
    expect(state.error?.message).toMatch(/connection/);
  });

  it("shows the reason a playlist gave for a file it could not make, as the one message", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.audio.error = {
      code: MEDIA_ERR_NETWORK,
      narrated: {
        message: "Daily narration limit reached.",
        summary: "Daily limit reached",
        standing: true,
      },
    };
    harness.audio.emit("error");
    const error = harness.store.getState().error;
    expect(error?.message).toBe("Daily narration limit reached.");
    expect(error?.kind).toBe("refused");
    expect(error?.summary).toBe("Daily limit reached");
  });

  it("never shows the browser's own MediaError message", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.audio.error = {
      code: MEDIA_ERR_SRC_NOT_SUPPORTED,
      message: "MEDIA_ELEMENT_ERROR: Format error",
    };
    harness.audio.emit("error");
    const error = harness.store.getState().error;
    expect(error?.kind).toBe("unavailable");
    expect(error?.message).toBe("Audio is not available for this briefing.");
  });

  it("says a standing refusal again on play, without a retry", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.audio.error = {
      code: MEDIA_ERR_NETWORK,
      narrated: { message: "Daily narration limit reached.", standing: true },
    };
    harness.audio.emit("error");
    harness.events.length = 0;
    const before = harness.events.filter((event) => event.type === "error").length;
    harness.store.play();
    expect(harness.store.getState().status).toBe("error");
    expect(harness.events.filter((event) => event.type === "error")).toHaveLength(before + 1);
    expect(
      harness.events.some(
        (event) =>
          event.type === "willPlay" &&
          event.reason === "user" &&
          harness.events.indexOf(event) > 0 &&
          false,
      ),
    ).toBe(false);
  });

  it("says the audio is unavailable when the source cannot be used", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.audio.error = { code: MEDIA_ERR_SRC_NOT_SUPPORTED };
    harness.audio.emit("error");
    expect(harness.store.getState().error?.kind).toBe("unavailable");
  });

  it("treats an abort as a source change, not a failure", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.audio.error = { code: 1 };
    harness.audio.emit("error");
    expect(harness.store.getState().status).toBe("playing");
  });

  it("falls back to paused with a message when the browser blocks play", async () => {
    const harness = createHarness();
    harness.store.load(makeDigest());
    harness.audio.playRejection = Object.assign(new Error("blocked"), { name: "NotAllowedError" });
    harness.store.play();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.store.getState()).toMatchObject({ status: "paused" });
    expect(harness.store.getState().error?.kind).toBe("blocked");
  });

  it("reports a failed play once when the element's error and the rejected play both arrive", async () => {
    const harness = createHarness();
    harness.store.load(makeDigest());
    harness.audio.playRejection = Object.assign(new Error("no source"), {
      name: "NotSupportedError",
    });
    harness.store.play();
    harness.audio.error = { code: MEDIA_ERR_SRC_NOT_SUPPORTED };
    harness.audio.emit("error");
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.events.filter((event) => event.type === "error")).toHaveLength(1);
  });

  it("ignores a play rejected because a newer load won", async () => {
    const harness = createHarness();
    harness.store.load(makeDigest());
    harness.audio.playRejection = Object.assign(new Error("aborted"), { name: "AbortError" });
    harness.store.play();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.store.getState().error).toBeNull();
  });

  it("retries by attaching the source again and playing from the same place", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.audio.currentTime = 44;
    harness.flushFrames();
    harness.audio.error = { code: MEDIA_ERR_NETWORK };
    harness.audio.emit("error");
    harness.store.play();
    expect(harness.store.getState().error).toBeNull();
    expect(harness.audio.playCalls).toBe(2);
    harness.audio.loadMetadata(120);
    expect(harness.audio.currentTime).toBe(44);
  });
});

describe("scrubbing", () => {
  it("pauses the element but keeps the controls in the playing state", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.store.beginScrub();
    expect(harness.audio.paused).toBe(true);
    expect(harness.store.getState()).toMatchObject({ status: "playing", scrubbing: true });
    expect(harness.store.isNarrating()).toBe(false);
  });

  it("moves the playhead without seeking the element until release", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.audio.currentTime = 10;
    harness.store.beginScrub();
    harness.store.scrubTo(75);
    expect(harness.store.getTime()).toBe(75);
    expect(harness.audio.currentTime).toBe(10);
    expect(harness.store.getState().itemIndex).toBe(2);
    harness.store.endScrub(80);
    expect(harness.audio.currentTime).toBe(80);
    expect(harness.store.getState().scrubbing).toBe(false);
  });

  it("resumes playback on release only if it was playing", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.store.beginScrub();
    harness.store.endScrub(30);
    expect(harness.audio.playCalls).toBe(2);
    const paused = createHarness();
    startPlaying(paused);
    paused.store.pause();
    paused.store.beginScrub();
    paused.store.endScrub(30);
    expect(paused.audio.playCalls).toBe(1);
  });

  it("emits no play or pause cue for the scrub's own pause and resume", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.events.length = 0;
    harness.store.beginScrub();
    harness.store.endScrub(30);
    expect(
      harness.events.some((event) => event.type === "willPlay" || event.type === "didPause"),
    ).toBe(false);
  });

  it("marks item changes during a scrub with the scrub cause", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.events.length = 0;
    harness.store.beginScrub();
    harness.store.scrubTo(65);
    expect(harness.events).toContainEqual({ type: "itemChanged", index: 2, cause: "scrub" });
  });
});

describe("one digest at a time", () => {
  it("keeps the playing track when another page loads and follows the page while idle", () => {
    const harness = createHarness();
    const older = makeDigest({
      id: "2026-10-05",
      audio: { url: "/audio/old.mp3", duration_ms: 90_000 },
    });
    harness.store.setPageDigest(makeDigest());
    expect(harness.store.getState().digestId).toBe("2026-10-07");
    harness.store.setPageDigest(older);
    expect(harness.store.getState().digestId).toBe("2026-10-05");

    harness.audio.loadMetadata(90);
    harness.store.play();
    harness.audio.startPlaying();
    harness.store.setPageDigest(makeDigest());
    expect(harness.store.getState().digestId).toBe("2026-10-05");
    expect(harness.store.getPageDigest()?.id).toBe("2026-10-07");
    expect(harness.audio.src).toBe("/audio/old.mp3");
  });

  it("switches the source and stops the old narration when the listener picks another digest", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.audio.currentTime = 40;
    const other = makeDigest({
      id: "2026-10-05",
      audio: { url: "/audio/old.mp3", duration_ms: 90_000 },
    });
    harness.store.load(other);
    expect(harness.audio.src).toBe("/audio/old.mp3");
    expect(harness.store.getState()).toMatchObject({ digestId: "2026-10-05", status: "idle" });
    expect(harness.storage.getItem(resumeKey("2026-10-07"))).toBe("40");
    expect(harness.createdAudios).toHaveLength(1);
  });

  it("plays the page's digest once its data arrives when asked from Up next", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.store.playWhenPageLoads("2026-10-05");
    expect(harness.audio.playCalls).toBe(1);
    harness.store.setPageDigest(
      makeDigest({ id: "2026-10-05", audio: { url: "/audio/old.mp3", duration_ms: 90_000 } }),
    );
    expect(harness.audio.src).toBe("/audio/old.mp3");
    expect(harness.audio.playCalls).toBe(2);
    expect(harness.store.getState().status).toBe("loading");
  });
});

describe("listeners and disposal", () => {
  it("adds its audio listeners once, however many digests load", () => {
    const harness = createHarness();
    harness.store.load(makeDigest());
    const count = harness.audio.listenerCount();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < 5; index += 1) {
      harness.store.load(
        makeDigest({
          id: `2026-09-0${index + 1}`,
          audio: { url: `/a/${index}.mp3`, duration_ms: 60_000 },
        }),
      );
    }
    expect(harness.audio.listenerCount()).toBe(count);
  });

  it("removes every listener, timer and subscription on dispose", () => {
    const harness = createHarness();
    startPlaying(harness);
    const seen: number[] = [];
    harness.store.onFrame((time) => seen.push(time));
    harness.store.dispose();
    expect(harness.audio.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    harness.flushFrames(2);
    expect(seen).toEqual([]);
    harness.store.load(makeDigest({ id: "2026-10-05" }));
    harness.store.play();
    expect(harness.store.getState().digestId).toBe("2026-10-07");
    expect(harness.audio.src).toBe("");
    expect(harness.audio.listenerCount()).toBe(0);
  });

  it("returns an unsubscribe function from every subscription", () => {
    const harness = createHarness();
    harness.store.load(makeDigest());
    let coarse = 0;
    const off = harness.store.subscribe(() => {
      coarse += 1;
    });
    harness.store.setRate(1.5);
    off();
    harness.store.setRate(2);
    expect(coarse).toBe(1);
  });
});

describe("edge cases in the element's own behavior", () => {
  it("never saves the element's zero as the position while a saved one is waiting to be restored", () => {
    const hooks: { hide: (() => void) | null } = { hide: null };
    const harness = createHarness({
      onPageHide: (callback) => {
        hooks.hide = callback;
        return () => undefined;
      },
    });
    harness.storage.setItem(resumeKey("2026-10-07"), "58");
    harness.store.load(makeDigest());
    // iOS reports currentTime 0 and readyState 0 until the first play, whatever preload says.
    hooks.hide?.();
    expect(harness.storage.getItem(resumeKey("2026-10-07"))).toBe("58");
    harness.store.load(
      makeDigest({ id: "2026-10-05", audio: { url: "/a/b.mp3", duration_ms: 60_000 } }),
    );
    expect(harness.storage.getItem(resumeKey("2026-10-07"))).toBe("58");
  });

  it("does not treat a quiet fetch as a stall while the buffer holds data", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.audio.readyState = 4;
    harness.audio.emit("stalled");
    expect(harness.store.getState().status).toBe("playing");
    harness.audio.readyState = 1;
    harness.audio.emit("stalled");
    expect(harness.store.getState().status).toBe("loading");
  });

  it("returns from loading to playing when the clock proves the element is running", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.audio.emit("waiting");
    expect(harness.store.getState().status).toBe("loading");
    harness.audio.readyState = 4;
    harness.audio.currentTime = 12;
    harness.audio.emit("timeupdate");
    expect(harness.store.getState().status).toBe("playing");
  });

  it("pauses an element that starts by itself after the system interrupted it", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.clock.now += 5_000;
    harness.audio.paused = true;
    harness.audio.emit("pause");
    expect(harness.store.getState().interrupted).toBe(true);
    // Android resumes after a call on its own; the interface said "interrupted", so it obeys.
    harness.audio.startPlaying();
    expect(harness.audio.paused).toBe(true);
    expect(harness.store.getState()).toMatchObject({ status: "paused", interrupted: true });
  });

  it("still notices a real interruption right after a pause the listener made", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.store.pause();
    harness.audio.emit("pause");
    harness.store.play();
    harness.audio.startPlaying();
    // Same millisecond, same clock: the window of the earlier pause must not swallow this one.
    harness.audio.paused = true;
    harness.audio.emit("pause");
    expect(harness.store.getState()).toMatchObject({ status: "paused", interrupted: true });
  });

  it("does not read the late pause event of its own pause as an interruption of the next play", () => {
    const harness = createHarness();
    startPlaying(harness);
    // K then Space, a few milliseconds apart: the element delivers the pause event after play()
    // was already called again.
    harness.store.pause();
    harness.store.play();
    harness.audio.emit("pause");
    harness.audio.startPlaying();
    expect(harness.store.getState()).toMatchObject({ status: "playing", interrupted: false });
  });

  it("keeps the frame loop and save timer running through a pause event that was ours to ignore", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.store.beginScrub();
    harness.audio.emit("pause");
    harness.store.endScrub(20);
    harness.audio.startPlaying();
    const seen: number[] = [];
    harness.store.onFrame((time) => seen.push(time));
    harness.audio.currentTime = 21;
    harness.flushFrames();
    expect(seen).toEqual([21]);
  });

  it("does not restart narration at the end of a scrub if the listener paused during it", () => {
    const harness = createHarness();
    startPlaying(harness);
    harness.store.beginScrub();
    harness.store.pause();
    const plays = harness.audio.playCalls;
    harness.store.endScrub(30);
    expect(harness.audio.playCalls).toBe(plays);
    expect(harness.store.getState().status).toBe("paused");
  });
});
