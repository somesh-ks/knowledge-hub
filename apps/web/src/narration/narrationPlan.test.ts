import { describe, expect, it } from "vitest";
import { createHarness, FakeAudio, makeDigestWithoutAudio } from "../player/core/testing";
import {
  digestIdOfSource,
  narratedDigest,
  narrationSource,
  planNarration,
  type SegmentInfo,
} from "./narrationPlan";
import { createTrackAudio, type Playlist } from "./trackAudio";

const digest = makeDigestWithoutAudio();
const [first, second, third, fourth] = digest.items.map((item) => item.id);

/** An intro and four stories. Only the intro and the first story are narrated so far. */
function lookup(): SegmentInfo[] {
  return [
    {
      key: "intro",
      item_id: null,
      characters: 60,
      audio: { url: "https://blob.test/intro.mp3", duration_ms: 4_000 },
    },
    {
      key: first ?? "",
      item_id: first ?? "",
      characters: 400,
      audio: { url: "https://blob.test/one.mp3", duration_ms: 26_000 },
    },
    { key: second ?? "", item_id: second ?? "", characters: 500, audio: null },
    { key: third ?? "", item_id: third ?? "", characters: 300, audio: null },
    { key: fourth ?? "", item_id: fourth ?? "", characters: 200, audio: null },
  ];
}

describe("planNarration", () => {
  it("gives a narrated segment its real length and the rest an estimate", () => {
    const plan = planNarration(lookup(), 60);
    expect(plan.segments.map((segment) => [segment.start, segment.end])).toEqual([
      [0, 4],
      [4, 30],
      [30, 60],
      [60, 78],
      [78, 90],
    ]);
    expect(plan.total_ms).toBe(90_000);
    expect(plan.complete).toBe(false);
  });

  it("marks each story by its item id and leaves the intro unmarked", () => {
    const plan = planNarration(lookup(), 60);
    expect(plan.items.get(first ?? "")).toEqual({ start_ms: 4_000, end_ms: 30_000 });
    expect(plan.items.get(fourth ?? "")).toEqual({ start_ms: 78_000, end_ms: 90_000 });
    expect(plan.items.size).toBe(4);
  });

  it("merges the segments of one story: it starts at its first and ends at its last", () => {
    const turn = (key: string, itemId: string | null, characters: number): SegmentInfo => ({
      key,
      item_id: itemId,
      characters,
      audio: { url: `https://blob.test/${key}.mp3`, duration_ms: characters * 100 },
    });
    const plan = planNarration(
      [
        turn("t0", null, 10),
        turn("t1", "s1", 20),
        turn("t2", "s1", 30),
        turn("t3", "s2", 40),
        turn("t4", "s1", 10),
        turn("t5", null, 10),
      ],
      60,
    );
    // Every turn keeps its own span on the timeline.
    expect(plan.segments.map((segment) => [segment.start, segment.end])).toEqual([
      [0, 1],
      [1, 3],
      [3, 6],
      [6, 10],
      [10, 11],
      [11, 12],
    ]);
    expect(plan.items.get("s1")).toEqual({ start_ms: 1_000, end_ms: 11_000 });
    expect(plan.items.get("s2")).toEqual({ start_ms: 6_000, end_ms: 10_000 });
    expect(plan.items.size).toBe(2);
  });

  it("carries the file of every segment that has one", () => {
    const plan = planNarration(lookup(), 60);
    expect(plan.segments.map((segment) => segment.url)).toEqual([
      "https://blob.test/intro.mp3",
      "https://blob.test/one.mp3",
      null,
      null,
      null,
    ]);
  });

  it("is complete only when every segment has a file", () => {
    const all = lookup().map((segment) => ({
      ...segment,
      audio: segment.audio ?? { url: `https://blob.test/${segment.key}.mp3`, duration_ms: 9_000 },
    }));
    expect(planNarration(all, 60).complete).toBe(true);
    expect(planNarration([], 60).complete).toBe(false);
  });

  it("never lets a segment collapse to nothing", () => {
    const plan = planNarration([{ key: "intro", item_id: null, characters: 0, audio: null }], 60);
    expect(plan.total_ms).toBeGreaterThan(0);
  });
});

describe("narratedDigest", () => {
  it("turns a briefing without audio into one the player can load", () => {
    const narrated = narratedDigest(digest, planNarration(lookup(), 60));
    expect(narrated.audio).toEqual({ url: narrationSource(digest.id), duration_ms: 90_000 });
    expect(narrated.timeline).toBe("estimated");
    expect(narrated.items.map((item) => item.start_ms)).toEqual([4_000, 30_000, 60_000, 78_000]);
    // A section starts where its first story starts, after any intro.
    expect(narrated.sections.map((section) => section.start_ms)).toEqual([4_000, 30_000, 60_000]);
    // The page's own copy is not changed.
    expect(digest.audio).toBeNull();
  });

  it("round-trips the briefing id through the source string", () => {
    expect(digestIdOfSource(narrationSource("2026-10-07-weekly"))).toBe("2026-10-07-weekly");
    expect(digestIdOfSource("https://blob.test/whole.mp3")).toBeNull();
  });
});

describe("the player store on a planned narration", () => {
  /** The real store, the real adapter, and a fake element underneath. */
  function setup() {
    const plan = planNarration(lookup(), 60);
    const real = new FakeAudio();
    const waiting = new Map<number, (url: string) => void>();
    const playlist: Playlist = {
      segments: plan.segments,
      ensure(index) {
        const known = plan.segments[index]?.url;
        if (known) return Promise.resolve(known);
        return new Promise((resolve) => waiting.set(index, resolve));
      },
      prepare() {},
    };
    const harness = createHarness({
      createAudio: () =>
        createTrackAudio(real, {
          resolve: (src) => (digestIdOfSource(src) === digest.id ? playlist : null),
        }),
    });
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    const finishFile = async () => {
      real.ended = true;
      real.paused = true;
      real.emit("pause");
      real.emit("ended");
      await settle();
    };
    const deliver = async (index: number, url: string) => {
      const segment = plan.segments[index];
      if (segment) segment.url = url;
      waiting.get(index)?.(url);
      await settle();
    };
    return { harness, real, plan, settle, finishFile, deliver };
  }

  it("loads it as an ordinary briefing with story marks and a length", async () => {
    const { harness, plan, settle } = setup();
    harness.store.load(narratedDigest(digest, plan));
    await settle();
    const state = harness.store.getState();
    expect(state.availability).toBe("ready");
    expect(state.duration).toBe(90);
    expect(state.track?.timeline?.items.map((item) => item.startSec)).toEqual([4, 30, 60, 78]);
  });

  it("plays through a file boundary as one uninterrupted track", async () => {
    const { harness, real, plan, settle, finishFile } = setup();
    const { store } = harness;
    store.load(narratedDigest(digest, plan));
    await settle();
    store.play();
    await settle();
    expect(real.src).toBe("https://blob.test/intro.mp3");
    real.loadMetadata(4);
    real.startPlaying();
    expect(store.getState().status).toBe("playing");

    await finishFile();
    expect(real.src).toBe("https://blob.test/one.mp3");
    // No pause, no interruption, no end: the briefing is still playing to the store.
    expect(store.getState().status).toBe("playing");
    expect(store.getState().interrupted).toBe(false);
    real.loadMetadata(26);
    real.startPlaying();
    real.currentTime = 13;
    real.emit("timeupdate");
    harness.flushFrames();
    expect(store.getTime()).toBeCloseTo(17);
    expect(store.getState().itemIndex).toBe(0);
  });

  it("jumps to a story that is not narrated yet, waits, then plays it", async () => {
    const { harness, real, plan, settle, deliver } = setup();
    const { store } = harness;
    store.load(narratedDigest(digest, plan));
    await settle();
    store.playItemAt(2);
    await settle();
    expect(store.getState().itemIndex).toBe(2);
    expect(store.getState().status).toBe("loading");
    expect(real.playCalls).toBe(0);

    await deliver(3, "https://blob.test/three.mp3");
    expect(real.src).toBe("https://blob.test/three.mp3");
    real.loadMetadata(20);
    real.startPlaying();
    expect(store.getState().status).toBe("playing");
    expect(store.getTime()).toBeCloseTo(60);
  });

  it("ends once, after the last story, and offers the previous briefing", async () => {
    const { harness, real, plan, settle, finishFile, deliver } = setup();
    const { store } = harness;
    store.load(narratedDigest(digest, plan));
    await settle();
    store.playItemAt(3);
    await settle();
    await deliver(4, "https://blob.test/four.mp3");
    real.loadMetadata(12);
    real.startPlaying();
    await finishFile();
    const state = store.getState();
    expect(state.status).toBe("ended");
    expect(state.upNextId).toBe(digest.prev_id);
    expect(harness.events.filter((event) => event.type === "ended")).toHaveLength(1);
  });
});
