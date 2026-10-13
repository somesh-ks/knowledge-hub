import { describe, expect, it } from "vitest";
import { FakeAudio } from "../player/core/testing";
import { createTrackAudio, type Playlist, type TrackSegment } from "./trackAudio";

/** One turn heard; the writer has more coming until `complete()` says it has not. */
function growing() {
  const list: TrackSegment[] = [{ key: "t0", start: 0, end: 10, url: "https://blob.test/t0.mp3" }];
  let pending = true;
  let wake: ((grew: boolean) => void) | null = null;
  const real = new FakeAudio();
  const playlist: Playlist = {
    segments: list,
    ensure: (index) => Promise.resolve(list[index]?.url ?? ""),
    prepare: () => {},
    growth: {
      pending: () => pending,
      waitForMore: () => new Promise((resolve) => (wake = resolve)),
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
    async reachEnd() {
      audio.src = "narration:ep";
      await Promise.resolve();
      await audio.play();
      real.loadMetadata(10);
      real.startPlaying();
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

  it("ends when the script turns out to be complete, so the player is not left buffering for good", async () => {
    const live = growing();
    await live.reachEnd();
    await live.complete();
    expect(live.audio.ended).toBe(true);
    expect(live.events).toContain("ended");
  });
});
