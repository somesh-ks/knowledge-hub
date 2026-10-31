import { describe, expect, it } from "vitest";
import { createTrackAudio, type Playlist, type TrackSegment } from "../../narration/trackAudio";
import { MEDIA_ERR_DECODE, MEDIA_ERR_NETWORK } from "./audioErrors";
import type { PlayerEvent } from "./playerTypes";
import { createHarness, FakeAudio, makeDigest } from "./testing";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function startPlaying(harness: ReturnType<typeof createHarness>): void {
  harness.store.load(makeDigest());
  harness.audio.loadMetadata(120);
  harness.store.play();
  harness.audio.startPlaying();
}

/**
 * The store over the narration's adapter: four stories of 30 s, only the first one made. Story 2's
 * file is refused for a reason that stands, late (the first story has ended by then), and every
 * later ask for it is refused at once, as the narration's queue does.
 */
async function refusedWhileLoading() {
  const real = new FakeAudio();
  const segments: TrackSegment[] = [0, 1, 2, 3].map((index) => ({
    key: `s${index}`,
    start: index * 30,
    end: index * 30 + 30,
    url: index === 0 ? "https://blob.test/s0.mp3" : null,
  }));
  let refuseLate: ((error: Error) => void) | null = null;
  let standing = false;
  const playlist: Playlist = {
    segments,
    ensure(index) {
      const known = segments[index]?.url;
      if (known) return Promise.resolve(known);
      if (standing) return Promise.reject(new Error("monthly_budget"));
      return new Promise((_, reject) => {
        refuseLate = reject;
      });
    },
    prepare() {},
    describeFailure: () => ({ message: "Monthly allowance used up.", standing: true }),
  };
  const audio = createTrackAudio(real, {
    resolve: (src) => (src.startsWith("narration:") ? playlist : null),
  });
  const harness = createHarness({ createAudio: () => audio });
  harness.store.load(makeDigest({ audio: { url: "narration:2026-10-07", duration_ms: 120_000 } }));
  await settle();
  harness.store.play();
  await settle();
  real.loadMetadata(10);
  real.startPlaying();
  // The last frame before story 1 ends.
  real.currentTime = 9.9;
  harness.flushFrames();
  real.finish();
  await settle();
  standing = true;
  (refuseLate as ((error: Error) => void) | null)?.(new Error("monthly_budget"));
  await settle();
  return { harness, real };
}

describe("a refusal and a press on Play", () => {
  it("leaves the playhead at the start of the story that was refused, not in the tail before it", async () => {
    const { harness } = await refusedWhileLoading();
    const state = harness.store.getState();
    expect(state.status).toBe("error");
    expect(state.error?.kind).toBe("refused");
    expect(harness.store.getTime()).toBe(30);
    expect(state.itemIndex).toBe(1);
  });

  it("a press is refused at once: the element plays nothing and nothing says Playing", async () => {
    const { harness, real } = await refusedWhileLoading();
    const plays = real.playCalls;
    const statuses: string[] = [];
    harness.store.subscribe((next) => statuses.push(next.status));
    const errors = harness.events.filter((event) => event.type === "error").length;
    harness.store.play();
    await settle();
    expect(real.playCalls).toBe(plays);
    expect(statuses).not.toContain("playing");
    expect(harness.store.getState().status).toBe("error");
    expect(harness.events.filter((event) => event.type === "error")).toHaveLength(errors + 1);
  });

  it("a story step out of a failure is announced as the story, not as a press on Play", () => {
    const harness = createHarness();
    startPlaying(harness);
    // A decode failure, not a dropped connection: that one is retried by itself first (PWA-02).
    harness.audio.error = { code: MEDIA_ERR_DECODE };
    harness.audio.emit("error");
    harness.events.length = 0;
    harness.store.next();
    const willPlay = harness.events.find(
      (event): event is Extract<PlayerEvent, { type: "willPlay" }> => event.type === "willPlay",
    );
    expect(willPlay?.reason).toBe("item");
  });

  it("offline, a press tells the reason again and loads nothing", () => {
    let online = true;
    const harness = createHarness({ isOnline: () => online });
    startPlaying(harness);
    online = false;
    harness.audio.error = { code: MEDIA_ERR_NETWORK };
    harness.audio.emit("error");
    const before = harness.store.getState().error;
    expect(before?.kind).toBe("offline");
    const plays = harness.audio.playCalls;
    harness.events.length = 0;
    harness.store.play();
    expect(harness.audio.playCalls).toBe(plays);
    expect(harness.events.map((event) => event.type)).toEqual(["error"]);
    const after = harness.store.getState();
    expect(after.status).toBe("error");
    expect(after.error).not.toBe(before);
    expect(after.error?.message).toBe(before?.message);
  });
});
