import { describe, expect, it } from "vitest";
import { makeDigest } from "../testing/digestFactory";
import { buildEntries } from "./digests";
import { parseEpisodeFile } from "./episodeFile";
import { buildEpisodeEntries } from "./episodes";
import { episodeFacts, libraryItems } from "./libraryCard";

const episodeText = (id: string, at: string, format = "discussion") =>
  [
    "---",
    `id: ${id}`,
    `generated_at: ${at}`,
    "title: The week in AI",
    `format: ${format}`,
    "listen_minutes: 5",
    "sources:",
    "  - { item_id: s1, url: 'https://example.com/s1', headline: A new model ships, source: The Verge }",
    "turns:",
    "  - { idx: 0, speaker: a, text: Hello. }",
    "---",
    "",
  ].join("\n");

const episodes = (...texts: string[]) =>
  buildEpisodeEntries(texts.map((text) => parseEpisodeFile(text)));

describe("episodeFacts", () => {
  it("names the format and the length on the quiet line", () => {
    const [entry] = episodes(episodeText("ep-20261007-1930", "2026-10-07T17:30:00Z"));
    expect(entry && episodeFacts(entry)).toMatchObject({ line: "Discussion, 5 min", minutes: 5 });
    const [headlines] = episodes(
      episodeText("ep-20261007-1930", "2026-10-07T17:30:00Z", "headlines"),
    );
    expect(headlines && episodeFacts(headlines).line).toBe("Headlines, 5 min");
  });

  it("lets search find the title, the format, a headline and a publisher", () => {
    const [entry] = episodes(episodeText("ep-20261007-1930", "2026-10-07T17:30:00Z"));
    const search = entry ? episodeFacts(entry).search : "";
    for (const word of ["the week in ai", "discussion", "a new model ships", "the verge"]) {
      expect(search).toContain(word);
    }
  });
});

describe("libraryItems", () => {
  it("puts briefings and episodes in one list, newest first, an episode after a briefing written later that day", () => {
    const entries = buildEntries([
      { digest: makeDigest({ id: "2026-10-07" }), timeline: null },
      { digest: makeDigest({ id: "2026-10-05" }), timeline: null },
    ]);
    const items = libraryItems(
      entries,
      episodes(
        episodeText("ep-20261007-1930", "2026-10-07T17:30:00Z"),
        episodeText("ep-20261006-0900", "2026-10-06T07:00:00Z"),
      ),
    );
    expect(items.map((item) => item.id)).toEqual([
      "ep-20261007-1930",
      "2026-10-07",
      "ep-20261006-0900",
      "2026-10-05",
    ]);
    expect(items.map((item) => item.kind)).toEqual(["episode", "briefing", "episode", "briefing"]);
  });

  it("is empty with neither", () => {
    expect(libraryItems([], [])).toEqual([]);
  });
});
