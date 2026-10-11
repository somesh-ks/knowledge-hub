import { describe, expect, it } from "vitest";
import {
  type CardData,
  compareCards,
  dateSearchLine,
  emptyCopy,
  factsLine,
  matchCount,
  matchDetail,
  matchesFilter,
  normalize,
  resultSummary,
  textHasWords,
} from "./library";

function card(overrides: Partial<CardData> = {}): CardData {
  return {
    date: "2026-10-07",
    order: 0,
    kind: "regular",
    stories: 12,
    minutes: 8,
    hasAudio: true,
    search: normalize(
      ["2026-10-07", "Wednesday 7 October", "Pixel 11 gets a brighter screen The Verge"].join("\n"),
    ),
    ...overrides,
  };
}

describe("matchCount", () => {
  it("matches every card once when nothing is typed", () => {
    expect(matchCount(card(), "")).toBe(1);
    expect(matchCount(card(), "   ")).toBe(1);
  });

  it("finds a headline, a publisher or a date, whatever the case", () => {
    expect(matchCount(card(), "pixel")).toBe(1);
    expect(matchCount(card(), "VERGE")).toBe(1);
    expect(matchCount(card(), "october")).toBe(1);
    expect(matchCount(card(), "2026-10")).toBe(1);
  });

  it("needs every word, on one line", () => {
    expect(matchCount(card(), "pixel screen")).toBe(1);
    // A story is one line, so its headline and its publisher can both be asked for.
    expect(matchCount(card(), "pixel verge")).toBe(1);
    expect(matchCount(card(), "pixel october")).toBe(0);
    expect(matchCount(card(), "foldable")).toBe(0);
  });

  it("counts the stories that match", () => {
    const two = card({ search: normalize("a\nSpring physics\nSpring layouts\nGrid") });
    expect(matchCount(two, "spring")).toBe(2);
  });

  it("folds accents", () => {
    expect(matchCount(card({ search: normalize("Café culture") }), "cafe")).toBe(1);
  });
});

describe("matchesFilter", () => {
  it("separates weekly briefings from the rest", () => {
    expect(matchesFilter(card({ kind: "weekly" }), "weekly")).toBe(true);
    expect(matchesFilter(card({ kind: "weekly" }), "daily")).toBe(false);
    expect(matchesFilter(card({ kind: "regular" }), "daily")).toBe(true);
  });

  it("puts everything made on request under Episodes: episodes and generated briefings", () => {
    const episode = card({ kind: "episode", hasAudio: false });
    const generated = card({ kind: "on-demand" });
    for (const made of [episode, generated]) {
      expect(matchesFilter(made, "custom")).toBe(true);
      expect(matchesFilter(made, "daily")).toBe(false);
      expect(matchesFilter(made, "weekly")).toBe(false);
      expect(matchesFilter(made, "all")).toBe(true);
    }
    expect(matchesFilter(card(), "custom")).toBe(false);
    expect(matchesFilter(card({ kind: "weekly" }), "custom")).toBe(false);
  });
});

describe("compareCards", () => {
  const older = card({ date: "2026-10-05", minutes: 12, stories: 8 });
  const newer = card({ date: "2026-10-07", minutes: 8, stories: 12 });

  it("sorts by date both ways", () => {
    expect([older, newer].sort((a, b) => compareCards(a, b, "newest"))).toEqual([newer, older]);
    expect([newer, older].sort((a, b) => compareCards(a, b, "oldest"))).toEqual([older, newer]);
  });

  it("reverses two cards of one day along with the rest", () => {
    const later = card({ order: 0 });
    const earlier = card({ order: 1 });
    expect([earlier, later].sort((a, b) => compareCards(a, b, "newest"))).toEqual([later, earlier]);
    expect([later, earlier].sort((a, b) => compareCards(a, b, "oldest"))).toEqual([earlier, later]);
  });

  it("sorts by length and by story count, newest first on a tie", () => {
    expect([newer, older].sort((a, b) => compareCards(a, b, "longest"))).toEqual([older, newer]);
    expect([older, newer].sort((a, b) => compareCards(a, b, "stories"))).toEqual([newer, older]);
    const twin = card({ date: "2026-10-06", minutes: 8 });
    expect([twin, newer].sort((a, b) => compareCards(a, b, "longest"))).toEqual([newer, twin]);
  });
});

describe("resultSummary", () => {
  it("says how many results are shown", () => {
    expect(resultSummary(3, 3)).toBe("3 results");
    expect(resultSummary(1, 1)).toBe("1 result");
    expect(resultSummary(2, 9)).toBe("2 of 9 results");
    expect(resultSummary(1, 5)).toBe("1 of 5 results");
    expect(resultSummary(0, 9)).toBe("No results");
  });
});

describe("textHasWords", () => {
  it("wants every word, in any order, ignoring case and accents", () => {
    const text = normalize("The host said: a fraction of the Café cost");
    expect(textHasWords(text, "Cost FRACTION")).toBe(true);
    expect(textHasWords(text, "cafe")).toBe(true);
    expect(textHasWords(text, "fraction zebra")).toBe(false);
  });

  it("does not match an empty query: the cards' own lines answer that", () => {
    expect(textHasWords("anything", "  ")).toBe(false);
  });
});

describe("matchDetail", () => {
  const lines = [
    "2026-10-07 wednesday 7 october",
    "wednesday 7 october",
    "daily",
    "spring physics verge",
  ];
  const detail = card({ search: normalize(lines.join("\n")), metaLines: 3 });

  it("tells a match on the card itself from a match on a story", () => {
    expect(matchDetail(detail, "october")).toEqual({ meta: 2, stories: 0 });
    expect(matchDetail(detail, "spring")).toEqual({ meta: 0, stories: 1 });
    expect(matchDetail(detail, "nothing")).toEqual({ meta: 0, stories: 0 });
  });

  it("counts a card with no meta lines as all stories, and an empty query once", () => {
    expect(matchDetail(card({ metaLines: undefined }), "pixel").stories).toBe(1);
    expect(matchDetail(detail, "")).toEqual({ meta: 1, stories: 0 });
  });
});

describe("dateSearchLine", () => {
  it("answers 7 october, oct 7, the ISO date and the weekday", () => {
    const line = normalize(dateSearchLine("2026-10-07", "Wednesday 7 October"));
    const wanted = card({ search: line, metaLines: 1 });
    for (const query of ["7 october", "oct 7", "2026-10-07", "wednesday", "WED"]) {
      expect(matchCount(wanted, query), query).toBe(1);
    }
    expect(matchCount(wanted, "oct 8")).toBe(0);
  });
});

describe("factsLine", () => {
  it("joins the parts with one separator and skips empty ones", () => {
    expect(factsLine(["Daily", "12 stories", "8 min"])).toBe(
      "Daily \u00b7 12 stories \u00b7 8 min",
    );
    expect(factsLine(["Episode", undefined, "5 min"])).toBe("Episode \u00b7 5 min");
  });
});

describe("emptyCopy", () => {
  it("names the search when one was typed", () => {
    expect(emptyCopy("zzz", "all")).toEqual({
      message: "No results for \u201czzz\u201d",
      action: "Clear search",
      resets: "search",
    });
  });

  it("names the filter too, and offers to show everything", () => {
    expect(emptyCopy("zzz", "custom")).toMatchObject({
      message: "No results for \u201czzz\u201d in episodes",
      action: "Show everything",
      resets: "everything",
    });
  });

  it("says nothing of a kind exists when only a filter is on", () => {
    expect(emptyCopy("  ", "weekly").message).toBe("No weekly briefings yet");
    expect(emptyCopy("", "custom").message).toBe("No episodes yet");
    expect(emptyCopy("", "weekly").resets).toBe("everything");
  });
});
