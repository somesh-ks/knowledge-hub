import { describe, expect, it } from "vitest";
import { makeDigest } from "../testing/digestFactory";
import { buildEntries } from "./digests";
import { parseEpisodeFile } from "./episodeFile";
import { buildEpisodeEntries } from "./episodes";
import { matchDetail, normalize } from "./library";
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
  it("follows one pattern, kind then contents then length, for every podcast", () => {
    const entries = buildEntries([
      { digest: makeDigest({ id: "2026-10-04-weekly", kind: "weekly" }), timeline: null },
      { digest: makeDigest({ id: "2026-10-05" }), timeline: null },
      { digest: makeDigest({ id: "2026-10-06-on-demand", kind: "on-demand" }), timeline: null },
    ]);
    const facts = (kind: string) => {
      const entry = entries.find((one) => one.digest.kind === kind);
      return entry ? cardFacts(entry) : null;
    };
    expect(facts("weekly")).toMatchObject({
      line: "Weekly \u00b7 4 stories \u00b7 4 min",
      minutes: 4,
    });
    expect(facts("regular")?.line).toBe("Daily \u00b7 4 stories \u00b7 4 min");
    // A briefing made on request is a Catch up and follows an episode's pattern: kind, then length.
    expect(facts("on-demand")?.line).toBe("Catch up \u00b7 4 min");
  });

  it("finds a podcast by its date in any form", () => {
    const entries = buildEntries([{ digest: makeDigest({ id: "2026-10-07" }), timeline: null }]);
    const entry = entries[0];
    const facts = entry ? cardFacts(entry) : null;
    const card = {
      date: "2026-10-07",
      order: 0,
      kind: "regular",
      stories: 4,
      minutes: 4,
      hasAudio: false,
      search: normalize(facts?.search ?? ""),
      metaLines: facts?.metaLines,
    };
    for (const query of ["7 october", "oct 7", "2026-10-07", "wednesday"]) {
      expect(matchDetail(card, query).meta, query).toBeGreaterThan(0);
    }
    expect(matchDetail(card, "tuesday").meta).toBe(0);
  });
});

describe("episodeFacts", () => {
  it("names the kind and the length on the quiet line, and keeps the format searchable", () => {
    const [entry] = episodes(episodeText("ep-20261007-1930", "2026-10-07T17:30:00Z"));
    expect(entry && episodeFacts(entry)).toMatchObject({
      line: "Catch up \u00b7 5 min",
      minutes: 5,
    });
    expect(entry && episodeFacts(entry).search).toContain("catch up Discussion");
    const [headlines] = episodes(
      episodeText("ep-20261007-1930", "2026-10-07T17:30:00Z", "headlines"),
    );
    // Whatever the format, the card says Catch up; a stored headlines episode searches as a readout.
    expect(headlines && episodeFacts(headlines).line).toBe("Catch up \u00b7 5 min");
    expect(headlines && episodeFacts(headlines).search).toContain("catch up Readout");
  });

  it("finds an episode by its date in any form, not as a matching story", () => {
    const [entry] = episodes(episodeText("ep-20261007-1930", "2026-10-07T17:30:00Z"));
    const facts = entry ? episodeFacts(entry) : null;
    const card = {
      date: "2026-10-07",
      order: 0,
      kind: "episode",
      stories: 1,
      minutes: 5,
      hasAudio: false,
      search: normalize(facts?.search ?? ""),
      metaLines: facts?.metaLines,
    };
    for (const query of ["7 october", "oct 7", "2026-10-07", "wednesday", "discussion"]) {
      const detail = matchDetail(card, query);
      expect(detail.meta, query).toBeGreaterThan(0);
      expect(detail.stories, query).toBe(0);
    }
    expect(matchDetail(card, "verge")).toEqual({ meta: 0, stories: 1, first: 3 });
  });

  it("keeps each story's headline as written, apart from its publisher", () => {
    const [entry] = episodes(episodeText("ep-20261007-1930", "2026-10-07T17:30:00Z"));
    const lines = (entry ? episodeFacts(entry).search : "").split("\n");
    expect(lines.at(-1)).toBe("A new model ships\tThe Verge");
  });

  it("lets search find the title, the format, a headline and a publisher", () => {
    const [entry] = episodes(episodeText("ep-20261007-1930", "2026-10-07T17:30:00Z"));
    const search = normalize(entry ? episodeFacts(entry).search : "");
    for (const word of ["the week in ai", "discussion", "a new model ships", "the verge"]) {
      expect(search).toContain(word);
    }
  });
});

describe("searchIndex", () => {
  it("holds an episode's whole script and a podcast's story text, normalized, one blob each", () => {
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
  it("puts podcasts and episodes in one list, newest first, an episode after a podcast written later that day", () => {
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
