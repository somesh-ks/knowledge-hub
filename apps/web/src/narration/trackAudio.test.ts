import { describe, expect, it } from "vitest";
import { FakeAudio } from "../player/core/testing";
import { createTrackAudio, type Playlist, segmentIndexAt, type TrackSegment } from "./trackAudio";

/** Three stories of ten virtual seconds each. The middle one has no file yet. */
function segments(): TrackSegment[] {
  return [
    { key: "intro", start: 0, end: 10, url: "https://blob.test/intro.mp3" },
    { key: "a", start: 10, end: 20, url: null },
    { key: "b", start: 20, end: 30, url: "https://blob.test/b.mp3" },
  ];
}

interface Harness {
  real: FakeAudio;
  audio: ReturnType<typeof createTrackAudio>;
  list: TrackSegment[];
  events: string[];
  ensured: number[];
  prepared: number[];
  /** Delivers the file a pending ensure() is waiting for. */
  deliver(index: number, url?: string): Promise<void>;
  refuse(index: number): Promise<void>;
}

function harness(list: TrackSegment[] = segments()): Harness {
  const real = new FakeAudio();
  const ensured: number[] = [];
  const prepared: number[] = [];
  const pending = new Map<number, { resolve(url: string): void; reject(error: Error): void }>();
  const playlist: Playlist = {
    segments: list,
    ensure(index) {
      ensured.push(index);
      const known = list[index]?.url;
      if (known) return Promise.resolve(known);
      return new Promise((resolve, reject) => pending.set(index, { resolve, reject }));
    },
    prepare(index) {
      prepared.push(index);
    },
    describeFailure: (error) =>
      error instanceof Error ? { message: `Said: ${error.message}`, standing: true } : null,
  };
  const audio = createTrackAudio(real, {
    resolve: (src) => (src.startsWith("narration:") ? playlist : null),
    lookAhead: 1,
  });
  const events: string[] = [];
  for (const type of ["playing", "pause", "ended", "waiting", "timeupdate", "error"]) {
    audio.addEventListener(type, () => events.push(type));
  }
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  return {
    real,
    audio,
    list,
    events,
    ensured,
    prepared,
    async deliver(index, url = `https://blob.test/${list[index]?.key}.mp3`) {
      const segment = list[index];
      if (segment) segment.url = url;
      pending.get(index)?.resolve(url);
      await settle();
    },
    async refuse(index) {
      pending.get(index)?.reject(new Error("narration failed"));
      await settle();
    },
  };
}

/** One turn of the microtask queue: the adapter has told its listeners the track's length. */
const announced = () => Promise.resolve();

/** The element has loaded a file's header and started it. */
function startFile(real: FakeAudio, seconds: number): void {
  real.loadMetadata(seconds);
  real.startPlaying();
}

describe("segmentIndexAt", () => {
  it("finds the segment that holds a moment, and gives the very end to the last one", () => {
    const list = segments();
    expect(segmentIndexAt(list, 0)).toBe(0);
    expect(segmentIndexAt(list, 9.99)).toBe(0);
    expect(segmentIndexAt(list, 10)).toBe(1);
    expect(segmentIndexAt(list, 30)).toBe(2);
    expect(segmentIndexAt(list, -5)).toBe(0);
  });
});

describe("a source without a playlist", () => {
  it("passes straight through to the element", async () => {
    const { real, audio, events } = harness();
    audio.src = "https://blob.test/whole.mp3";
    expect(real.src).toBe("https://blob.test/whole.mp3");
    expect(audio.src).toBe("https://blob.test/whole.mp3");
    await audio.play();
    real.loadMetadata(120);
    real.currentTime = 42;
    real.startPlaying();
    expect(audio.duration).toBe(120);
    expect(audio.currentTime).toBe(42);
    expect(audio.paused).toBe(false);
    real.finish();
    expect(events).toEqual(["playing", "ended"]);
  });
});

describe("a playlist as one track", () => {
  it("knows its whole length before any file is read", async () => {
    const { real, audio } = harness();
    const heard: string[] = [];
    audio.addEventListener("loadedmetadata", () => heard.push("loadedmetadata"));
    audio.src = "narration:2026-10-07";
    expect(audio.duration).toBe(30);
    // Nothing is loaded as far as the player can tell, until it has been told the length.
    expect(audio.readyState).toBe(0);
    await announced();
    expect(heard).toEqual(["loadedmetadata"]);
    expect(audio.readyState).toBe(1);
    expect(audio.paused).toBe(true);
    // Nothing is fetched until the listener asks for sound.
    expect(real.src).toBe("");
  });

  it("holds a play made before the length is announced, so a seek can say where to start", async () => {
    const { real, audio } = harness();
    audio.addEventListener("loadedmetadata", () => {
      // What the player does with a saved position or a tapped story.
      audio.currentTime = 22;
    });
    audio.src = "narration:2026-10-07";
    void audio.play();
    expect(real.src).toBe("");
    await announced();
    // The intro was never fetched: the first file is the one the seek chose.
    expect(real.src).toBe("https://blob.test/b.mp3");
    expect(real.playCalls).toBe(1);
  });

  it("silences the old story while a tapped one is being made", async () => {
    const { real, audio, events, deliver } = harness();
    audio.src = "narration:2026-10-07";
    await announced();
    await audio.play();
    startFile(real, 8);
    events.length = 0;
    audio.currentTime = 12;
    expect(real.paused).toBe(true);
    // The element's pause is the adapter's own doing, not the track pausing.
    real.emit("pause");
    expect(events).not.toContain("pause");
    expect(audio.paused).toBe(false);
    await deliver(1);
    expect(real.src).toBe("https://blob.test/a.mp3");
  });

  it("seeks back into a file that has just ended, at the place asked for", async () => {
    const { real, audio } = harness();
    audio.src = "narration:2026-10-07";
    await announced();
    await audio.play();
    startFile(real, 10);
    // The file ends; the next story has no file yet.
    real.ended = true;
    real.paused = true;
    real.emit("pause");
    real.emit("ended");
    await Promise.resolve();
    audio.currentTime = 7;
    expect(real.currentTime).toBe(7);
    expect(audio.currentTime).toBe(7);
    expect(real.playCalls).toBe(2);
  });

  it("ignores a late pause event that a newer play has already undone", async () => {
    const { real, audio, events } = harness();
    audio.src = "narration:2026-10-07";
    await announced();
    await audio.play();
    startFile(real, 8);
    audio.pause();
    await audio.play();
    events.length = 0;
    // The event for the pause arrives after the play.
    real.emit("pause");
    expect(events).toEqual([]);
    expect(audio.paused).toBe(false);
  });

  it("reports a pause from outside that landed while the next file was loading", async () => {
    const { real, audio, events } = harness();
    audio.src = "narration:2026-10-07";
    await announced();
    await audio.play();
    events.length = 0;
    // A call comes in before the header is read.
    real.paused = true;
    real.loadMetadata(8);
    expect(events).toEqual(["pause"]);
    expect(audio.paused).toBe(true);
  });

  it("makes the file when a guessed address turns out to be empty", async () => {
    const list = segments();
    for (const segment of list) {
      segment.url = `https://blob.test/guess-${segment.key}.mp3`;
      segment.unconfirmed = true;
    }
    const { real, audio, events, ensured, deliver } = harness(list);
    audio.src = "narration:2026-10-07";
    await announced();
    await audio.play();
    expect(real.src).toBe("https://blob.test/guess-intro.mp3");
    // Nothing is there.
    real.error = { code: 4 };
    real.emit("error");
    await Promise.resolve();
    // Not an error to the player: the file is asked for, and every other guess is dropped too.
    expect(events).not.toContain("error");
    expect(ensured).toEqual([0]);
    expect(list.map((segment) => segment.url)).toEqual([null, null, null]);
    await deliver(0);
    expect(real.src).toBe("https://blob.test/intro.mp3");
    expect(audio.paused).toBe(false);
  });

  it("is not stopped by the late refusal of a guessed file it has already given up on", async () => {
    const list = segments();
    for (const segment of list) {
      segment.url = `https://blob.test/guess-${segment.key}.mp3`;
      segment.unconfirmed = true;
    }
    const { real, audio, events, ensured, deliver } = harness(list);
    // A browser rejects the play() of a file it could not load after it has raised the error event.
    let refuse: (error: Error) => void = () => undefined;
    real.play = () => {
      real.playCalls += 1;
      real.paused = false;
      return new Promise<void>((_, reject) => {
        refuse = reject;
      });
    };
    audio.src = "narration:2026-10-07";
    // Pressed before the length is announced, as the first press of Play is.
    void audio.play();
    await announced();
    expect(real.src).toBe("https://blob.test/guess-intro.mp3");
    real.error = { code: 4 };
    real.emit("error");
    await Promise.resolve();
    expect(ensured).toEqual([0]);
    const refusal = new Error("The element has no supported sources.");
    refusal.name = "NotSupportedError";
    refuse(refusal);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    // The listener still wants to hear it: no pause is announced, and the made file plays.
    expect(events).not.toContain("pause");
    expect(audio.paused).toBe(false);
    real.play = FakeAudio.prototype.play;
    await deliver(0);
    expect(real.src).toBe("https://blob.test/intro.mp3");
    expect(real.paused).toBe(false);
  });

  it("trusts a guessed address once its file plays", async () => {
    const list = segments();
    const intro = list[0];
    if (intro) intro.unconfirmed = true;
    const { real, audio, events } = harness(list);
    audio.src = "narration:2026-10-07";
    await announced();
    await audio.play();
    startFile(real, 8);
    expect(intro?.unconfirmed).toBe(false);
    // A failure now is a real one.
    real.error = { code: 2 };
    real.emit("error");
    expect(events).toContain("error");
  });

  it("keeps a header that arrived while the playhead was elsewhere", async () => {
    const { real, audio } = harness();
    audio.src = "narration:2026-10-07";
    await announced();
    await audio.play();
    audio.pause();
    real.paused = true;
    audio.currentTime = 25;
    real.loadMetadata(10);
    audio.currentTime = 3;
    expect(real.currentTime).toBe(3);
    expect(audio.currentTime).toBe(3);
  });

  it("plays the first file and reports its time on the virtual timeline", async () => {
    const { real, audio, events } = harness();
    audio.src = "narration:2026-10-07";
    await announced();
    await audio.play();
    expect(real.src).toBe("https://blob.test/intro.mp3");
    // The real file runs eight seconds; its span on the timeline is ten. Half way is half way.
    startFile(real, 8);
    real.currentTime = 4;
    expect(audio.currentTime).toBe(5);
    expect(events).toEqual(["playing"]);
  });

  it("moves to the next file at the end of one without pausing or ending", async () => {
    const { real, audio, events, deliver } = harness();
    audio.src = "narration:2026-10-07";
    await announced();
    await audio.play();
    startFile(real, 8);
    await deliver(1);
    events.length = 0;

    // A real element pauses itself and then reports the end.
    real.ended = true;
    real.paused = true;
    real.emit("pause");
    real.emit("ended");
    await Promise.resolve();

    expect(events).toEqual(["timeupdate"]);
    expect(audio.paused).toBe(false);
    expect(audio.ended).toBe(false);
    expect(real.src).toBe("https://blob.test/a.mp3");
    expect(audio.currentTime).toBe(10);
    startFile(real, 12);
    real.currentTime = 6;
    expect(audio.currentTime).toBe(15);
  });

  it("ends once, after the last file", async () => {
    const { real, audio, events } = harness();
    audio.src = "narration:2026-10-07";
    await announced();
    audio.currentTime = 25;
    await audio.play();
    expect(real.src).toBe("https://blob.test/b.mp3");
    startFile(real, 10);
    // The seek waited for the header: half way into the last segment.
    expect(real.currentTime).toBe(5);
    events.length = 0;
    real.ended = true;
    real.paused = true;
    real.emit("pause");
    real.emit("ended");
    expect(events).toEqual(["pause", "ended"]);
    expect(audio.ended).toBe(true);
    expect(audio.paused).toBe(true);
    expect(audio.currentTime).toBe(30);
  });

  it("waits for a file that does not exist yet, then plays it", async () => {
    const { real, audio, events, ensured, deliver } = harness();
    audio.src = "narration:2026-10-07";
    await announced();
    audio.currentTime = 12;
    const started = audio.play();
    await Promise.resolve();
    expect(ensured).toEqual([1]);
    expect(events).toContain("waiting");
    expect(audio.paused).toBe(false);
    expect(real.src).toBe("");
    // The playhead holds where the listener put it while the file is made.
    expect(audio.currentTime).toBe(12);

    await deliver(1);
    await started;
    expect(real.src).toBe("https://blob.test/a.mp3");
    expect(real.playCalls).toBe(1);
    startFile(real, 20);
    expect(real.currentTime).toBeCloseTo(4);
    expect(audio.currentTime).toBeCloseTo(12);
  });

  it("does not start a late file after the listener paused", async () => {
    const { real, audio, deliver } = harness();
    audio.src = "narration:2026-10-07";
    await announced();
    audio.currentTime = 12;
    const started = audio.play();
    audio.pause();
    await deliver(1);
    await started;
    expect(real.playCalls).toBe(0);
    expect(real.src).toBe("");
    expect(audio.paused).toBe(true);
  });

  it("drops a late file when the listener has moved to another story", async () => {
    const { real, audio, deliver } = harness();
    audio.src = "narration:2026-10-07";
    await announced();
    audio.currentTime = 12;
    void audio.play();
    await Promise.resolve();
    audio.currentTime = 22;
    expect(real.src).toBe("https://blob.test/b.mp3");
    await deliver(1);
    expect(real.src).toBe("https://blob.test/b.mp3");
  });

  it("reports a file that could not be made as an error, once", async () => {
    const { audio, events, refuse } = harness();
    audio.src = "narration:2026-10-07";
    await announced();
    audio.currentTime = 12;
    const started = audio.play();
    await refuse(1);
    await expect(started).resolves.toBeUndefined();
    expect(events.filter((type) => type === "error")).toHaveLength(1);
    // The playlist's own words for why, so the player says it once and does not guess.
    expect(audio.error).toEqual({
      code: 2,
      narrated: { message: "Said: narration failed", standing: true },
    });
    expect(audio.paused).toBe(true);
  });

  it("seeks inside the loaded file without reloading it", async () => {
    const { real, audio } = harness();
    audio.src = "narration:2026-10-07";
    await announced();
    await audio.play();
    startFile(real, 8);
    const loaded = real.src;
    audio.currentTime = 7.5;
    expect(real.src).toBe(loaded);
    expect(real.currentTime).toBe(6);
  });

  it("holds a seek made while paused and fetches nothing until play", async () => {
    const { real, audio, prepared } = harness();
    audio.src = "narration:2026-10-07";
    await announced();
    audio.currentTime = 22;
    expect(real.src).toBe("");
    expect(audio.currentTime).toBe(22);
    // The file can be made ready in the meantime.
    expect(prepared).toEqual([2]);
    await audio.play();
    expect(real.src).toBe("https://blob.test/b.mp3");
  });

  it("returns to the loaded file's own clock after a seek away and back while paused", async () => {
    const { real, audio } = harness();
    audio.src = "narration:2026-10-07";
    await announced();
    await audio.play();
    startFile(real, 10);
    audio.pause();
    real.emit("pause");
    audio.currentTime = 25;
    audio.currentTime = 3;
    expect(real.currentTime).toBe(3);
    expect(audio.currentTime).toBe(3);
  });

  it("asks for the files just ahead of the playhead", async () => {
    const { real, audio, prepared } = harness();
    audio.src = "narration:2026-10-07";
    await announced();
    await audio.play();
    startFile(real, 8);
    expect(prepared).toContain(1);
    expect(prepared).not.toContain(2);
  });

  it("treats a pause it did not ask for as the track pausing", async () => {
    const { real, audio, events } = harness();
    audio.src = "narration:2026-10-07";
    await announced();
    await audio.play();
    startFile(real, 8);
    events.length = 0;
    // A phone call: the system pauses the element.
    real.paused = true;
    real.emit("pause");
    expect(events).toEqual(["pause"]);
    expect(audio.paused).toBe(true);
  });

  it("offers a resume when the browser will not start the next file by itself", async () => {
    const { real, audio, events, deliver } = harness();
    audio.src = "narration:2026-10-07";
    await announced();
    await audio.play();
    startFile(real, 8);
    await deliver(1);
    events.length = 0;
    const refusal = new Error("blocked");
    refusal.name = "NotAllowedError";
    real.playRejection = refusal;
    real.ended = true;
    real.paused = true;
    real.emit("pause");
    real.emit("ended");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["timeupdate", "pause"]);
    expect(audio.paused).toBe(true);
    // The position is kept: the next play starts the story that could not start.
    expect(audio.currentTime).toBe(10);
  });

  it("keeps the playback rate across a file swap", async () => {
    const { real, audio, deliver } = harness();
    audio.src = "narration:2026-10-07";
    await announced();
    audio.defaultPlaybackRate = 1.5;
    audio.playbackRate = 1.5;
    await audio.play();
    startFile(real, 8);
    await deliver(1);
    real.ended = true;
    real.paused = true;
    real.emit("ended");
    await Promise.resolve();
    expect(real.playbackRate).toBe(1.5);
    expect(real.defaultPlaybackRate).toBe(1.5);
  });

  it("starts over from the first file when played again after the end", async () => {
    const { real, audio } = harness([
      { key: "only", start: 0, end: 10, url: "https://blob.test/only.mp3" },
    ]);
    audio.src = "narration:2026-10-07";
    await announced();
    await audio.play();
    startFile(real, 10);
    real.finish();
    expect(audio.ended).toBe(true);
    await audio.play();
    expect(audio.ended).toBe(false);
    expect(audio.currentTime).toBe(0);
  });

  it("lets go of the playlist when the source is removed", async () => {
    const { real, audio } = harness();
    audio.src = "narration:2026-10-07";
    await announced();
    await audio.play();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    expect(audio.src).toBe("");
    expect(real.src).toBe("");
    audio.src = "https://blob.test/whole.mp3";
    expect(real.src).toBe("https://blob.test/whole.mp3");
  });
});
