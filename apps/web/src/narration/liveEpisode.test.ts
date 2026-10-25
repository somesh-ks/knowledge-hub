import { describe, expect, it } from "vitest";
import type { StreamDoc } from "../lib/liveStream";
import { storyEntries } from "../player/core/storyEntries";
import { buildTimeline } from "../player/core/timeline";
import { createGrowth, liveDigestFrom } from "./liveEpisode";
import { narratedDigest, planNarration } from "./narrationPlan";
import type { TrackSegment } from "./trackAudio";

const doc = (status: StreamDoc["status"], turns: number): StreamDoc => ({
  id: "ep-20261013-1200",
  title: "AI",
  status,
  turns: Array.from({ length: turns }, (_, i) => ({ speaker: "a", text: "x".repeat(100 + i) })),
  voices: { a: null, b: null },
  hosts: null,
  format: "readout",
  stories: [],
  updated_at: "",
});

const first = (): TrackSegment[] => [{ key: "t0", start: 0, end: 5, url: null }];

function growth(docs: StreamDoc[], segments = first(), extra: { giveUpMs?: number } = {}) {
  let clock = 0;
  const asked: number[] = [];
  const api = createGrowth(
    segments,
    { status: "writing" },
    {
      fetchDoc: async () => docs[Math.min(asked.push(clock) - 1, docs.length - 1)] ?? null,
      delay: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      msPerCharacter: 10,
      ...extra,
    },
  );
  return { api, segments, asked };
}

describe("a track that grows with the script", () => {
  it("keeps asking while the writer is going and adds turns after the last one, so playback continues instead of ending", async () => {
    const { api, segments, asked } = growth([
      doc("writing", 1),
      doc("writing", 1),
      doc("writing", 3),
    ]);
    expect(api.pending()).toBe(true);
    await expect(api.waitForMore()).resolves.toBe(true);
    expect(asked).toHaveLength(3);
    expect(segments.map((s) => s.key)).toEqual(["t0", "t1", "t2"]);
    expect(segments[1]?.start).toBe(5);
    expect(segments[2]?.start).toBe(segments[1]?.end);
  });

  it("ends the track when the script is finished and there is nothing more, so the player does not buffer forever", async () => {
    const { api } = growth([doc("done", 1)]);
    await expect(api.waitForMore()).resolves.toBe(false);
    expect(api.pending()).toBe(false);
  });

  it("hands over the last turns of a finished script before it lets the track end", async () => {
    const { api, segments } = growth([doc("done", 3)]);
    await expect(api.waitForMore()).resolves.toBe(true);
    expect(segments).toHaveLength(3);
    expect(api.pending()).toBe(false);
  });

  it("gives up when a run that says it is writing never adds a turn, so a dead run does not hold the player", async () => {
    const { api } = growth([doc("writing", 1)], first(), { giveUpMs: 10_000 });
    await expect(api.waitForMore()).resolves.toBe(false);
    expect(api.pending()).toBe(false);
  });

  it("stops waiting on a failed run", async () => {
    const { api } = growth([doc("failed", 1)]);
    await expect(api.waitForMore()).resolves.toBe(false);
  });
});

describe("the player's copy of a live catch-up episode", () => {
  it("lists its stories under one section the player names, so a catch-up across topics shows chapters and transcript instead of nothing", () => {
    const live: StreamDoc = {
      ...doc("writing", 0),
      turns: [
        { speaker: "a", text: "Welcome." },
        { speaker: "b", text: "First story.", item_id: "i1" },
        { speaker: "a", text: "Second story.", item_id: "i2" },
      ],
      stories: [
        { item_id: "i1", headline: "One", source: "S", url: "https://a.test", section: "design" },
        { item_id: "i2", headline: "Two", source: "S", url: "https://b.test", section: "tech" },
      ],
    };
    const digest = liveDigestFrom(live, new Date("2026-10-25T10:00:00Z"));
    const plan = planNarration(
      live.turns.map((turn, idx) => ({
        key: `t${idx}`,
        item_id: turn.item_id ?? null,
        characters: turn.text.length,
        audio: null,
      })),
      10,
    );
    const narrated = narratedDigest(digest, plan);
    const entries = storyEntries(buildTimeline(narrated), narrated);
    expect(entries.items.length).toBe(2);
    const named = new Set(entries.sections.map((section) => section.slug));
    expect(entries.items.every((item) => named.has(item.section))).toBe(true);
    expect(named.size).toBe(1);
  });
});
