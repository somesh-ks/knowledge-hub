import { describe, expect, it } from "vitest";
import { makeDigest, makeItem, makeTimeline } from "../testing/digestFactory";
import { audioModeOf, buildEntries, compareNewestFirst, orderItems } from "./digests";

const noTimeline = { timeline: null } as const;

describe("audioModeOf", () => {
  const digest = makeDigest({ audio: { url: "https://example.com/a.mp3", duration_ms: 12_000 } });

  it("is ready with both audio and a timeline", () => {
    expect(audioModeOf(digest, makeTimeline(digest))).toBe("ready");
  });

  it("is preparing when the text is out and nothing else exists", () => {
    expect(audioModeOf(makeDigest(), null)).toBe("preparing");
  });

  it("is expired when the audio was pruned but the timeline stayed", () => {
    const pruned = makeDigest({ audio: null });
    expect(audioModeOf(pruned, makeTimeline(pruned))).toBe("expired");
  });

  it("is preparing when audio is listed but the timeline is missing", () => {
    expect(audioModeOf(digest, null)).toBe("preparing");
  });
});

describe("orderItems", () => {
  it("groups by section in the fixed order, keeping the digest's order inside a section", () => {
    const items = [
      makeItem(1, "watch"),
      makeItem(2, "ai"),
      makeItem(3, "top"),
      makeItem(4, "ai"),
      makeItem(5, "top"),
    ];
    expect(orderItems(items).map((item) => item.section)).toEqual([
      "top",
      "top",
      "ai",
      "ai",
      "watch",
    ]);
    expect(orderItems(items).map((item) => item.id)).toEqual(
      [3, 5, 2, 4, 1].map((seed) => items.find((item) => item.url.endsWith(`-${seed}`))?.id),
    );
  });
});

describe("compareNewestFirst", () => {
  it("sorts by date, newest first", () => {
    const older = makeDigest({ id: "2026-10-05" });
    const newer = makeDigest({ id: "2026-10-07" });
    expect([older, newer].sort(compareNewestFirst).map((digest) => digest.id)).toEqual([
      "2026-10-07",
      "2026-10-05",
    ]);
  });

  it("puts a later run on the same day first", () => {
    const first = makeDigest({ id: "2026-10-07", generated_at: "2026-10-07T05:00:00.000Z" });
    const second = makeDigest({
      id: "2026-10-07-2",
      date: "2026-10-07",
      generated_at: "2026-10-07T16:00:00.000Z",
    });
    expect([first, second].sort(compareNewestFirst).map((digest) => digest.id)).toEqual([
      "2026-10-07-2",
      "2026-10-07",
    ]);
  });
});

describe("buildEntries", () => {
  it("returns no entries for no digests", () => {
    expect(buildEntries([])).toEqual([]);
  });

  it("sorts newest first and links neighbours", () => {
    const sources = ["2026-10-05", "2026-10-07", "2026-10-03"].map((id) => ({
      digest: makeDigest({ id }),
      ...noTimeline,
    }));
    const entries = buildEntries(sources);
    expect(entries.map((entry) => entry.id)).toEqual(["2026-10-07", "2026-10-05", "2026-10-03"]);
    expect(entries[0]).toMatchObject({ prevId: "2026-10-05", nextId: null });
    expect(entries[1]).toMatchObject({ prevId: "2026-10-03", nextId: "2026-10-07" });
    expect(entries[2]).toMatchObject({ prevId: null, nextId: "2026-10-05" });
  });

  it("derives the player data from the digest", () => {
    const [entry] = buildEntries([{ digest: makeDigest({ id: "2026-10-07" }), ...noTimeline }]);
    expect(entry?.player).toMatchObject({
      id: "2026-10-07",
      date: "2026-10-07",
      title: "Wednesday 7 October",
      kind: "regular",
      audio: null,
      timeline: null,
      cover: { src512: "/covers/2026-10-07-512.png", src1024: "/covers/2026-10-07-1024.png" },
      prev_id: null,
      next_id: null,
    });
    expect(entry?.player.cover.key).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("puts sections in the fixed order with Top picks first", () => {
    const digest = makeDigest({
      items: [makeItem(1, "watch"), makeItem(2, "ai"), makeItem(3, "top"), makeItem(4, "launches")],
    });
    const [entry] = buildEntries([{ digest, ...noTimeline }]);
    expect(entry?.player.sections.map((section) => section.slug)).toEqual([
      "top",
      "ai",
      "launches",
      "watch",
    ]);
    expect(entry?.player.sections[0]?.title).toBe("Top picks");
  });

  it("carries item times from the timeline when audio is ready", () => {
    const digest = makeDigest({ audio: { url: "https://example.com/a.mp3", duration_ms: 12_000 } });
    const timeline = makeTimeline(digest);
    const [entry] = buildEntries([{ digest, timeline }]);
    expect(entry?.audioMode).toBe("ready");
    expect(entry?.player.audio).toEqual({ url: "https://example.com/a.mp3", duration_ms: 12_000 });
    expect(entry?.player.timeline).toBe("marks");
    expect(entry?.player.items.map((item) => item.start_ms)).toEqual([0, 3000, 6000, 9000]);
    expect(entry?.player.sections.map((section) => section.start_ms)).toEqual([0, 6000, 9000]);
  });

  it("offers no audio and no times for an expired digest", () => {
    const digest = makeDigest({ audio: null });
    const [entry] = buildEntries([{ digest, timeline: makeTimeline(digest) }]);
    expect(entry?.audioMode).toBe("expired");
    expect(entry?.player.audio).toBeNull();
    expect(entry?.player.items.every((item) => item.start_ms === null)).toBe(true);
  });

  it("rewrites the audio URL through the resolver", () => {
    const digest = makeDigest({
      audio: { url: "https://fixtures.invalid/a.wav", duration_ms: 12_000 },
    });
    const [entry] = buildEntries([{ digest, timeline: makeTimeline(digest) }], {
      resolveAudioUrl: () => "/fixtures/audio.wav",
    });
    expect(entry?.player.audio?.url).toBe("/fixtures/audio.wav");
  });

  it("leaves out a digest with an unknown cover palette and says so", () => {
    const warnings: string[] = [];
    const good = makeDigest({ id: "2026-10-07" });
    const bad = makeDigest({
      id: "2026-10-05",
      cover: { template: "contour", palette: "no-such-palette", seed: 1 },
    });
    const entries = buildEntries(
      [
        { digest: good, ...noTimeline },
        { digest: bad, ...noTimeline },
      ],
      {},
      (message) => warnings.push(message),
    );
    expect(entries.map((entry) => entry.id)).toEqual(["2026-10-07"]);
    expect(warnings[0]).toContain("2026-10-05");
  });
});
