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
    expect(audio.readyState).toBe(1);
    expect(audio.paused).toBe(true);
    // Nothing is fetched until the listener asks for sound.
    expect(real.src).toBe("");
    await Promise.resolve();
    expect(heard).toEqual(["loadedmetadata"]);
  });

  it("plays the first file and reports its time on the virtual timeline", async () => {
    const { real, audio, events } = harness();
    audio.src = "narration:2026-10-07";
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
    audio.currentTime = 12;
    const started = audio.play();
    await refuse(1);
    await expect(started).resolves.toBeUndefined();
    expect(events.filter((type) => type === "error")).toHaveLength(1);
    expect(audio.error).toEqual({ code: 2 });
    expect(audio.paused).toBe(true);
  });

  it("seeks inside the loaded file without reloading it", async () => {
    const { real, audio } = harness();
    audio.src = "narration:2026-10-07";
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
    await audio.play();
    startFile(real, 8);
    expect(prepared).toContain(1);
    expect(prepared).not.toContain(2);
  });

  it("treats a pause it did not ask for as the track pausing", async () => {
    const { real, audio, events } = harness();
    audio.src = "narration:2026-10-07";
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
