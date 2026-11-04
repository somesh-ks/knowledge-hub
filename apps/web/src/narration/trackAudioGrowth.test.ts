import { describe, expect, it } from "vitest";
import { FakeAudio } from "../player/core/testing";
import { createTrackAudio, type Playlist, type TrackSegment } from "./trackAudio";

/**
 * One turn heard; the writer has more coming until `complete()` says it has not, and expects the
 * episode to run `expected` seconds in all.
 */
function growing(expected = 0) {
  const list: TrackSegment[] = [{ key: "t0", start: 0, end: 10, url: "https://blob.test/t0.mp3" }];
  let pending = true;
  let wake: ((grew: boolean) => void) | null = null;
  /** What each wait was told to ask about whether it is still wanted. */
  const waits: Array<() => boolean> = [];
  const real = new FakeAudio();
  const playlist: Playlist = {
    segments: list,
    ensure: (index) => Promise.resolve(list[index]?.url ?? ""),
    prepare: () => {},
    growth: {
      pending: () => pending,
      waitForMore: (wanted = () => true) => {
        waits.push(wanted);
        return new Promise((resolve) => (wake = resolve));
      },
      expected: () => expected,
    },
  };
  const audio = createTrackAudio(real, { resolve: () => playlist });
  const events: string[] = [];
  for (const type of ["ended", "waiting", "pause"]) {
    audio.addEventListener(type, () => events.push(type));
  }
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  return {
    real,
    audio,
    events,
    waits,
    async start() {
      audio.src = "narration:ep";
      await Promise.resolve();
      await audio.play();
      real.loadMetadata(10);
      real.startPlaying();
    },
    async reachEnd() {
      await this.start();
      real.ended = true;
      real.emit("ended");
    },
    async add(key: string) {
      const start = list.length * 10;
      list.push({ key, start, end: start + 10, url: `https://blob.test/${key}.mp3` });
      wake?.(true);
      await settle();
    },
    async complete() {
      pending = false;
      wake?.(false);
      await settle();
    },
  };
}

describe("a script that is still being written", () => {
  it("waits at the last turn heard instead of ending, so the episode does not stop mid-script", async () => {
    const live = growing();
    await live.reachEnd();
    expect(live.audio.ended).toBe(false);
    expect(live.events).toContain("waiting");
    expect(live.events).not.toContain("ended");
  });

  it("plays the next turn by itself when it arrives, with the longer length announced", async () => {
    const live = growing();
    await live.reachEnd();
    await live.add("t1");
    expect(live.real.src).toBe("https://blob.test/t1.mp3");
    expect(live.audio.duration).toBe(20);
  });

  // Owner, 2026-11-04: while it is written, the timer shows the length the episode will run, not a
  // length that grows turn by turn, and then the length it turned out to be (D366).
  it("is as long as it is expected to run until the script is done, then as long as it is", async () => {
    const live = growing(300);
    await live.reachEnd();
    expect(live.audio.duration).toBe(300);
    await live.add("t1");
    expect(live.audio.duration).toBe(300);
    await live.complete();
    expect(live.audio.duration).toBe(20);
  });

  it("holds a seek past what is made, buffering there, and lands it once the turns reach it", async () => {
    const live = growing(300);
    await live.start();
    live.audio.currentTime = 25;
    expect(live.audio.currentTime).toBe(25);
    expect(live.events).toContain("waiting");
    // The turn that was playing stops instead of running on under the wait.
    expect(live.real.paused).toBe(true);
    // Seeking there again leaves the first wait behind, so one wait polls, not one per seek.
    const first = live.waits.at(-1);
    live.audio.currentTime = 25;
    expect(first?.()).toBe(false);
    expect(live.waits.at(-1)?.()).toBe(true);
    await live.add("t1");
    expect(live.audio.currentTime).toBe(25);
    await live.add("t2");
    expect(live.real.src).toBe("https://blob.test/t2.mp3");
    expect(live.audio.currentTime).toBe(25);
  });

  it("ends when the script turns out to be complete, so the player is not left buffering for good", async () => {
    const live = growing();
    await live.reachEnd();
    await live.complete();
    expect(live.audio.ended).toBe(true);
    expect(live.events).toContain("ended");
  });
});
