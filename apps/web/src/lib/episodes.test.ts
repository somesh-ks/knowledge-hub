import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseEpisodeFile } from "./episodeFile";
import { buildEpisodeEntries, episodeLength, readEpisodeFiles } from "./episodes";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "singularity-episodes-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const text = (id: string, at: string, extra: string[] = []) =>
  [
    "---",
    `id: ${id}`,
    `generated_at: ${at}`,
    "title: An episode",
    "sources:",
    "  - { item_id: s1, url: 'https://example.com/s1', headline: Story one, source: Example }",
    "  - { item_id: s2, url: 'javascript:alert(1)', headline: Story two, source: Example }",
    "turns:",
    "  - { idx: 0, speaker: a, text: Hello., item_id: s1 }",
    ...extra,
    "---",
    "",
  ].join("\n");

async function add(id: string, at: string): Promise<void> {
  const file = join(root, "2026", "10", `${id}.md`);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, text(id, at));
}

describe("readEpisodeFiles", () => {
  it("treats a folder that does not exist as no episodes", async () => {
    expect(await readEpisodeFiles(join(root, "Podcasts"))).toEqual({ episodes: [], warnings: [] });
  });

  it("reads every episode and skips a bad file with a warning", async () => {
    await add("ep-20261007-1000", "2026-10-07T08:00:00Z");
    await add("ep-20261008-1000", "2026-10-08T08:00:00Z");
    await writeFile(join(root, "2026", "10", "broken.md"), "no frontmatter");
    const { episodes, warnings } = await readEpisodeFiles(root);
    expect(episodes.map((episode) => episode.id).sort()).toEqual([
      "ep-20261007-1000",
      "ep-20261008-1000",
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("broken.md");
    expect(warnings[0]).toContain("skipped");
  });

  it("skips a second file that repeats an id", async () => {
    await add("ep-20261007-1000", "2026-10-07T08:00:00Z");
    await writeFile(
      join(root, "2026", "10", "copy.md"),
      text("ep-20261007-1000", "2026-10-07T08:00:00Z"),
    );
    const { episodes, warnings } = await readEpisodeFiles(root);
    expect(episodes).toHaveLength(1);
    expect(warnings.some((warning) => warning.includes("duplicate episode id"))).toBe(true);
  });
});

describe("buildEpisodeEntries", () => {
  const episodes = [
    parseEpisodeFile(text("ep-20261007-1000", "2026-10-07T08:00:00Z")),
    parseEpisodeFile(text("ep-20261009-1000", "2026-10-09T08:00:00Z")),
  ];

  it("sorts newest first", () => {
    expect(buildEpisodeEntries(episodes).map((entry) => entry.id)).toEqual([
      "ep-20261009-1000",
      "ep-20261007-1000",
    ]);
  });

  it("gives the player the page data a briefing gives it: sources as items in one section", () => {
    const entry = buildEpisodeEntries(episodes)[0];
    expect(entry?.player).toMatchObject({
      id: "ep-20261009-1000",
      date: "2026-10-09",
      title: "An episode",
      audio: null,
      timeline: null,
      sections: [{ slug: "top", title: "Stories", start_ms: null }],
      cover: {
        src512: "/covers/ep-20261009-1000-512.webp",
        src1024: "/covers/ep-20261009-1000-1024.webp",
      },
      prev_id: null,
      next_id: null,
    });
    expect(entry?.player.items.map((item) => [item.id, item.section, item.url])).toEqual([
      ["s1", "top", "https://example.com/s1"],
      // A link that is not http or https is never offered.
      ["s2", "top", null],
    ]);
  });

  it("hands the player the hosts' names when the file stored them, and none when it did not", () => {
    const named = parseEpisodeFile(
      text("ep-20261010-1000", "2026-10-10T08:00:00Z", [
        "  - { idx: 1, speaker: b, text: Hi., item_id: s1 }",
        "request:",
        "  format: discussion",
        "  topic_ids: [design]",
        "  host_names: { a: Maya, b: Theo }",
      ]),
    );
    expect(buildEpisodeEntries([named])[0]?.player.hosts).toEqual({ a: "Maya", b: "Theo" });
    // Made before names were stored: the player falls back to the pair its script was written with.
    expect(buildEpisodeEntries(episodes)[0]?.player.hosts).toBeNull();
  });

  it("picks a cover from the id when the file names none, the same one every time", () => {
    const first = buildEpisodeEntries(episodes)[0]?.cover;
    expect(first).toEqual(buildEpisodeEntries(episodes)[0]?.cover);
    expect(first?.palette).toBeTruthy();
  });

  it("uses the file's own cover when it can be drawn, and picks one when it cannot", () => {
    const named = (palette: string, template: string) =>
      parseEpisodeFile(
        text("ep-20261007-1000", "2026-10-07T08:00:00Z", [
          `cover: { palette: ${palette}, template: ${template}, seed: 3 }`,
        ]),
      );
    expect(buildEpisodeEntries([named("ultramarine", "orbit")])[0]?.cover).toEqual({
      palette: "ultramarine",
      template: "orbit",
      seed: 3,
    });
    expect(buildEpisodeEntries([named("no-such-palette", "orbit")])[0]?.cover.palette).not.toBe(
      "no-such-palette",
    );
  });
});

describe("episodeLength", () => {
  it("says how long the episode takes to hear, as its play controls do", () => {
    expect(episodeLength({ listen_minutes: 8 })).toBe("8 min");
  });
});
