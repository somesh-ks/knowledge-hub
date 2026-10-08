import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planPodcast } from "../src/podcast/plan.js";
import { selectStories } from "../src/podcast/select.js";
import { PodcastError } from "../src/podcast/types.js";
import { dayAgo, makeDigest, NOW, REQUEST, tempRoot, writeDigest } from "./podcast-fixtures.js";

let ctx: Awaited<ReturnType<typeof tempRoot>>;
beforeEach(async () => {
  ctx = await tempRoot();
});
afterEach(async () => {
  await ctx.cleanup();
});

describe("selectStories", () => {
  it("takes stories by section or category, newest digest first", async () => {
    const old = dayAgo(3);
    const recent = dayAgo(1);
    await writeDigest(
      ctx.root,
      makeDigest(old.id, old.at, [
        { n: 1, section: "ai" },
        { n: 2, section: "research", category: "hci_empirical_research" },
      ]),
    );
    await writeDigest(
      ctx.root,
      makeDigest(recent.id, recent.at, [
        { n: 3, section: "ai" },
        // A category match counts even when the story sits in another section.
        { n: 4, section: "top", category: "frontier_model_releases" },
        { n: 5, section: "launches", category: "developer_tool_launches" },
      ]),
    );
    const request = { ...REQUEST, topic_ids: ["ai", "frontier_model_releases"] };
    const { stories, matched } = await selectStories(ctx.root, planPodcast(request), NOW);
    expect(matched).toBe(3);
    expect(stories.map((s) => s.item_id)).toEqual(["000000000003", "000000000004", "000000000001"]);
  });

  it("keeps the newest copy when two digests carry the same URL", async () => {
    const old = dayAgo(3);
    const recent = dayAgo(1);
    const shared = "https://example.com/shared";
    await writeDigest(
      ctx.root,
      makeDigest(old.id, old.at, [{ n: 1, url: shared, headline: "Old copy" }, { n: 2 }]),
    );
    await writeDigest(
      ctx.root,
      makeDigest(recent.id, recent.at, [{ n: 3, url: `${shared}/`, headline: "New copy" }]),
    );
    const { stories } = await selectStories(ctx.root, planPodcast(REQUEST), NOW);
    expect(stories).toHaveLength(2);
    expect(stories[0]?.headline).toBe("New copy");
    expect(stories.some((s) => s.headline === "Old copy")).toBe(false);
  });

  it("ignores digests outside the window", async () => {
    const inside = dayAgo(1);
    const outside = dayAgo(5);
    await writeDigest(ctx.root, makeDigest(inside.id, inside.at, [{ n: 1 }, { n: 2 }]));
    await writeDigest(ctx.root, makeDigest(outside.id, outside.at, [{ n: 3 }, { n: 4 }]));
    const twoDays = await selectStories(ctx.root, planPodcast({ ...REQUEST, window_days: 2 }), NOW);
    expect(twoDays.stories).toHaveLength(2);
    const week = await selectStories(ctx.root, planPodcast({ ...REQUEST, window_days: 7 }), NOW);
    expect(week.stories).toHaveLength(4);
  });

  it("ignores digests generated after now", async () => {
    const later = new Date(NOW.getTime() + 3_600_000);
    await writeDigest(
      ctx.root,
      makeDigest(later.toISOString().slice(0, 10), later.toISOString(), [{ n: 1 }, { n: 2 }]),
    );
    await expect(selectStories(ctx.root, planPodcast(REQUEST), NOW)).rejects.toThrow(
      /No stories in AI Products in the last 7 days\./,
    );
  });

  it("fails clearly with fewer than two matching stories", async () => {
    const recent = dayAgo(1);
    await writeDigest(ctx.root, makeDigest(recent.id, recent.at, [{ n: 1 }]));
    const request = { ...REQUEST, window_days: 2 as const };
    const attempt = selectStories(ctx.root, planPodcast(request), NOW);
    await expect(attempt).rejects.toThrow(/Only 1 story matches.*longer window/);
    await expect(attempt).rejects.toBeInstanceOf(PodcastError);
    await expect(
      selectStories(ctx.root, planPodcast({ ...request, window_days: 30 }), NOW),
    ).rejects.toThrow(/more topics/);
  });

  it("fails the same way when there are no digests at all", async () => {
    await expect(selectStories(ctx.root, planPodcast(REQUEST), NOW)).rejects.toThrow(
      /No stories in AI Products in the last 7 days\./,
    );
  });

  it("never builds an episode from top picks alone", async () => {
    const recent = dayAgo(1);
    await writeDigest(
      ctx.root,
      makeDigest(recent.id, recent.at, [
        { n: 1, section: "top", category: "frontier_model_releases" },
        { n: 2, section: "top", category: "frontier_model_releases" },
        { n: 3, section: "ui-craft", category: "design_engineering_craft" },
      ]),
    );
    const request = { ...REQUEST, topic_ids: ["design"] };
    await expect(selectStories(ctx.root, planPodcast(request), NOW)).rejects.toThrow(
      /^No stories in Design in the last 7 days\.$/,
    );
  });

  it("builds from the topics that have stories and names the empty ones", async () => {
    const recent = dayAgo(1);
    await writeDigest(
      ctx.root,
      makeDigest(recent.id, recent.at, [
        { n: 1, section: "ai" },
        { n: 2, section: "ai" },
        { n: 3, section: "top", category: "frontier_model_releases" },
      ]),
    );
    const request = { ...REQUEST, topic_ids: ["ai", "design"] };
    const selection = await selectStories(ctx.root, planPodcast(request), NOW);
    expect(selection.empty_topics).toEqual(["design"]);
    // Top picks still ride along with the chosen-topic stories.
    expect(selection.stories).toHaveLength(3);
    const full = await selectStories(ctx.root, planPodcast(REQUEST), NOW);
    expect(full.empty_topics).toEqual([]);
  });

  it.each([
    ["readout", 5, 10],
    ["discussion", 5, 6],
    ["headlines", 5, 28],
    ["readout", 15, 31],
    ["discussion", 15, 20],
    ["headlines", 15, 88],
  ] as const)("trims a %s of %i minutes to %i stories", async (format, minutes, count) => {
    // Eleven digests of nine stories on eleven days: more than the biggest budget can carry.
    for (let d = 1; d <= 11; d++) {
      const when = dayAgo(d);
      const specs = Array.from({ length: 9 }, (_, i) => ({ n: d * 100 + i }));
      await writeDigest(ctx.root, makeDigest(when.id, when.at, specs));
    }
    const plan = planPodcast({ ...REQUEST, format, length_minutes: minutes, window_days: 30 });
    const { stories, matched } = await selectStories(ctx.root, plan, NOW);
    expect(matched).toBe(99);
    expect(stories).toHaveLength(count);
    expect(count).toBe(plan.max_stories);
  });
});
