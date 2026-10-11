import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  COVER_TEMPLATES,
  Episode,
  episodeRelPath,
  parseEpisodeFile,
  serializeEpisodeFile,
} from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  allocateEpisodeId,
  buildEpisode,
  episodeIdAt,
  episodeTitle,
  writeEpisodeFile,
} from "../src/podcast/episode.js";
import type { PodcastStory, ScriptTurn } from "../src/podcast/types.js";
import { itemId, NOW, REQUEST, tempRoot } from "./podcast-fixtures.js";

let ctx: Awaited<ReturnType<typeof tempRoot>>;
beforeEach(async () => {
  ctx = await tempRoot();
});
afterEach(async () => {
  await ctx.cleanup();
});

const STORIES: PodcastStory[] = [1, 2].map((n) => ({
  item_id: itemId(n),
  headline: `Model ${n}: a "quoted" headline, with: punctuation`,
  summary: "It cuts latency by 40 percent.",
  source: "Example Wire",
  url: `https://example.com/story-${n}`,
  section: "ai",
  category: "frontier_model_releases",
}));

const TURNS: ScriptTurn[] = [
  { speaker: "a", text: "Welcome to Singularity: here is the week." },
  { speaker: "a", text: "Model 2 first. It cuts latency by 40 percent.", item_id: itemId(2) },
  { speaker: "b", text: 'What is the "catch"? Is it free?', item_id: itemId(2) },
  { speaker: "a", text: "Model 1 next.", item_id: itemId(1) },
  { speaker: "a", text: "That is Singularity for now." },
];

describe("the episode file", () => {
  it("round-trips through the file format", async () => {
    const episode = await buildEpisode({
      root: ctx.root,
      id: "ep-20261008-0913",
      now: NOW,
      request: { ...REQUEST, format: "discussion", title: "Week in models" },
      stories: STORIES,
      turns: TURNS,
    });
    const text = serializeEpisodeFile(episode);
    expect(parseEpisodeFile(text)).toEqual(episode);
    // Line endings from a Windows checkout must not matter.
    expect(parseEpisodeFile(text.replace(/\n/g, "\r\n"))).toEqual(episode);
  });

  it("reads as a script, with the sources listed after it", async () => {
    const episode = await buildEpisode({
      root: ctx.root,
      id: "ep-20261008-0913",
      now: NOW,
      request: { ...REQUEST, format: "discussion" },
      stories: STORIES,
      turns: TURNS,
    });
    const body = serializeEpisodeFile(episode).split("\n---\n")[1] ?? "";
    expect(body).toContain("A: Welcome to Singularity");
    expect(body).toContain('B: What is the "catch"?');
    expect(body).toContain("## Sources");
    expect(body).toContain("(https://example.com/story-2)");
  });

  it("fills the derived fields from the script", async () => {
    const episode = await buildEpisode({
      root: ctx.root,
      id: "ep-20261008-0913",
      now: NOW,
      request: REQUEST,
      stories: STORIES,
      turns: TURNS,
    });
    expect(episode.turns.map((t) => t.idx)).toEqual([0, 1, 2, 3, 4]);
    expect(episode.char_count).toBe(TURNS.reduce((sum, t) => sum + t.text.length, 0));
    expect(episode.listen_minutes).toBe(1);
    expect(episode.generated_at).toBe("2026-10-08T07:13:00.000Z");
    expect(episode.format).toBe("readout");
    // Sources follow the order the script first speaks of them.
    expect(episode.sources.map((s) => s.item_id)).toEqual([itemId(2), itemId(1)]);
    expect(COVER_TEMPLATES).toContain(episode.cover.template);
    expect(Episode.safeParse(episode).success).toBe(true);
  });

  it("omits stories the script never reached", async () => {
    const episode = await buildEpisode({
      root: ctx.root,
      id: "ep-20261008-0913",
      now: NOW,
      request: REQUEST,
      stories: STORIES,
      turns: TURNS.filter((t) => t.item_id !== itemId(1)),
    });
    expect(episode.sources.map((s) => s.item_id)).toEqual([itemId(2)]);
  });

  it("rejects text without frontmatter", () => {
    expect(() => parseEpisodeFile("# Just a script")).toThrow(/no frontmatter/);
    expect(() => parseEpisodeFile("---\nid: x\n")).toThrow(/not closed/);
  });

  it("never overwrites an episode", async () => {
    const episode = await buildEpisode({
      root: ctx.root,
      id: "ep-20261008-0913",
      now: NOW,
      request: REQUEST,
      stories: STORIES,
      turns: TURNS,
    });
    const first = await writeEpisodeFile(ctx.root, episode);
    expect(first.relPath).toBe("Podcasts/2026/10/ep-20261008-0913.md");
    await expect(writeEpisodeFile(ctx.root, episode)).rejects.toThrow(/already exists/);
  });
});

describe("ids and paths", () => {
  it("names the file by year and month of the id", () => {
    expect(episodeRelPath("ep-20261008-0913")).toBe("Podcasts/2026/10/ep-20261008-0913.md");
    expect(() => episodeRelPath("2026-10-08")).toThrow();
  });

  it("stamps the id in Stockholm time", () => {
    expect(episodeIdAt(NOW)).toBe("ep-20261008-0913");
    // Winter time is one hour behind summer time.
    expect(episodeIdAt(new Date("2026-12-01T23:30:00Z"))).toBe("ep-20261202-0030");
  });

  it("moves to the next free minute when the id is taken", async () => {
    const taken = join(ctx.root, episodeRelPath("ep-20261008-0913"));
    await mkdir(dirname(taken), { recursive: true });
    await writeFile(taken, "x");
    expect(await allocateEpisodeId(ctx.root, NOW)).toBe("ep-20261008-0914");
  });
});

describe("the title", () => {
  it("uses the listener's title", () => {
    expect(episodeTitle({ ...REQUEST, title: "Week in models" })).toBe("Week in models");
  });

  it("names up to two topics and counts the rest, so it reads in two short lines", () => {
    expect(episodeTitle({ ...REQUEST, topic_ids: ["ai"] })).toBe("AI");
    expect(episodeTitle({ ...REQUEST, topic_ids: ["ai", "design"] })).toBe("AI and Design");
    expect(episodeTitle({ ...REQUEST, topic_ids: ["ai", "design", "tech", "trending"] })).toBe(
      "AI, Design and 2 more",
    );
    const long = episodeTitle({
      ...REQUEST,
      topic_ids: [
        "design_engineering_craft",
        "hci_empirical_research",
        "ui_component_primitives",
        "ai_ux_interaction_patterns",
      ],
    });
    expect(long.length).toBeLessThanOrEqual(80);
  });
});
