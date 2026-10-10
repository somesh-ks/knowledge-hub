import { describe, expect, it } from "vitest";
import { makeDigest } from "../testing/digestFactory";
import { buildEntries } from "./digests";
import { parseEpisodeFile } from "./episodeFile";
import { buildEpisodeEntries } from "./episodes";
import { cardFacts, episodeFacts, libraryItems, searchIndex } from "./libraryCard";

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

describe("cardFacts", () => {
  it("says Weekly first on a weekly briefing, and keeps the kind apart for the list", () => {
    const entries = buildEntries([
      { digest: makeDigest({ id: "2026-10-04-weekly", kind: "weekly" }), timeline: null },
      { digest: makeDigest({ id: "2026-10-05" }), timeline: null },
    ]);
    const weekly = entries.find((entry) => entry.digest.kind === "weekly");
    const daily = entries.find((entry) => entry.digest.kind === "regular");
    expect(weekly && cardFacts(weekly)).toMatchObject({
      line: "Weekly, 4 stories, 4 min",
      kind: "Weekly",
      rest: "4 stories, 4 min",
      minutes: 4,
    });
    expect(daily && cardFacts(daily)).toMatchObject({
      line: "4 stories, 4 min",
      kind: "",
      rest: "4 stories, 4 min",
    });
  });
});

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

describe("searchIndex", () => {
  it("holds an episode's whole script and a briefing's story text, normalized, one blob each", () => {
    const [episode] = episodes(
      episodeText("ep-20261007-1930", "2026-10-07T17:30:00Z").replace(
        "text: Hello.",
        "text: Café talk about a fraction.",
      ),
    );
    const entries = buildEntries([{ digest: makeDigest({ id: "2026-10-07" }), timeline: null }]);
    const index = searchIndex(entries, episode ? [episode] : []);
    expect(index.map((entry) => [entry.id, entry.kind])).toEqual([
      ["2026-10-07", "briefing"],
      ["ep-20261007-1930", "episode"],
    ]);
    expect(index[1]?.text).toContain("cafe talk about a fraction");
    expect(index[0]?.text.split("\n")).toHaveLength(entries[0]?.digest.items.length ?? -1);
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
