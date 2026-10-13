import { describe, expect, it } from "vitest";
import {
  type CardData,
  chipFilter,
  compareCards,
  dateSearchLine,
  emptyCopy,
  factsLine,
  matchCount,
  matchDetail,
  matchExcerpt,
  matchesFilter,
  moreMatches,
  normalize,
  resultSummary,
  storyHeadline,
  textHasWords,
} from "./library";

function card(overrides: Partial<CardData> = {}): CardData {
  return {
    date: "2026-10-07",
    order: 0,
    kind: "regular",
    minutes: 8,
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

  it("finds a word where one of the card's words starts, never inside one", () => {
    const lines = [
      "Wednesday 7 October",
      "AI headlines",
      "More detail on Hairline 0.9",
      "OpenAI ships",
    ];
    const found = card({ search: normalize(lines.join("\n")), metaLines: 1 });
    // "detail", "Hairline" and "OpenAI" hold "ai" inside a word: only the story that starts with it counts.
    expect(matchDetail(found, "ai")).toEqual({ meta: 0, stories: 1, first: 1 });
    expect(matchCount(card({ search: normalize("A closer detail") }), "ai")).toBe(0);
    // The rest of a word may be left off ("lat" finds "latency"), the start of it may not.
    expect(matchCount(card({ search: normalize("Tap latency") }), "lat")).toBe(1);
    expect(matchCount(card({ search: normalize("Tap latency") }), "tency")).toBe(0);
    // A word with punctuation in it begins where its first letter does.
    const query = card({ search: normalize("Adds container-query tokens") });
    expect(matchCount(query, "container-query")).toBe(1);
    expect(matchCount(query, "query")).toBe(1);
    expect(matchCount(query, "tainer")).toBe(0);
  });
});

describe("matchesFilter", () => {
  it("separates weekly briefings from the rest", () => {
    expect(matchesFilter(card({ kind: "weekly" }), "weekly")).toBe(true);
    expect(matchesFilter(card({ kind: "weekly" }), "daily")).toBe(false);
    expect(matchesFilter(card({ kind: "regular" }), "daily")).toBe(true);
  });

  it("puts everything made on request under Custom: episodes and generated briefings", () => {
    const episode = card({ kind: "episode" });
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
  const older = card({ date: "2026-10-05", minutes: 12 });
  const newer = card({ date: "2026-10-07", minutes: 8 });

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

  it("sorts by length, newest first on a tie", () => {
    expect([newer, older].sort((a, b) => compareCards(a, b, "longest"))).toEqual([older, newer]);
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

  it("matches a number only as a whole word", () => {
    expect(textHasWords("released in 2026 for 6 teams", "6")).toBe(true);
    expect(textHasWords("released in 2026", "6")).toBe(false);
    expect(textHasWords("released in 2026", "202")).toBe(false);
    expect(textHasWords("released in 2026", "2026")).toBe(true);
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
    expect(matchDetail(detail, "spring")).toEqual({ meta: 0, stories: 1, first: 3 });
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

  it("finds a day by its number alone, not by a digit of the year", () => {
    const cards = ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"].map((date, order) => {
      const long = new Intl.DateTimeFormat("en-GB", {
        timeZone: "UTC",
        weekday: "long",
        day: "numeric",
        month: "long",
      })
        .format(new Date(`${date}T12:00:00Z`))
        .replace(",", "")
        .replace(/(\d) /, "$1\u00a0");
      return card({ date, order, search: normalize(dateSearchLine(date, long)), metaLines: 1 });
    });
    const kept = (query: string) =>
      cards.filter((one) => matchCount(one, query) > 0).map((one) => one.date);
    expect(kept("6 oct")).toEqual(["2026-10-06"]);
    expect(kept("6 october")).toEqual(["2026-10-06"]);
    expect(kept("oct 6")).toEqual(["2026-10-06"]);
    expect(kept("2 oct")).toEqual([]);
    expect(kept("1 oct")).toEqual([]);
    expect(kept("2026")).toHaveLength(4);
  });
});

describe("storyHeadline", () => {
  it("is the part of a story's line before its publisher", () => {
    expect(storyHeadline("A new model ships\tThe Verge")).toBe("A new model ships");
    expect(storyHeadline("No publisher")).toBe("No publisher");
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
      action: "Show all",
      resets: "everything",
    });
  });

  it("says nothing of a kind exists when only a filter is on", () => {
    expect(emptyCopy("  ", "weekly").message).toBe("No weekly briefings yet");
    expect(emptyCopy("", "custom").message).toBe("No episodes yet");
    expect(emptyCopy("", "weekly").resets).toBe("everything");
    expect(emptyCopy("", "weekly").action).toBe("Show all");
  });

  it("names the kind in full: daily briefings, not daily", () => {
    expect(emptyCopy("zzz", "daily").message).toBe(
      "No results for \u201czzz\u201d in daily briefings",
    );
    expect(emptyCopy("zzz", "weekly").message).toBe(
      "No results for \u201czzz\u201d in weekly briefings",
    );
  });
});

describe("matchExcerpt", () => {
  const show = (parts: ReturnType<typeof matchExcerpt>) =>
    parts.map((part) => (part.hit ? `[${part.text}]` : part.text)).join("");

  it("starts a little before the first find, at a space, so the found word is in view", () => {
    const text = "Spring-based motion lowers measured tap latency on a mid-range phone";
    expect(show(matchExcerpt(text, "latency"))).toBe(
      "…measured tap [latency] on a mid-range phone",
    );
  });

  it("shows more before a find near the end, since little follows it", () => {
    const text =
      "Springlet 2.0 retargets springs mid-flight, so interrupted drawers keep their velocity";
    const shown = show(matchExcerpt(text, "velocity"));
    expect(shown.endsWith("[velocity]")).toBe(true);
    // Two lines hold about 44 characters; "…keep their velocity" (20) wasted most of them.
    expect(shown.length).toBeGreaterThanOrEqual(40);
  });

  it("keeps the start when the find is near it, and marks every word of the query", () => {
    expect(show(matchExcerpt("Measuring tap latency on phones", "tap phones"))).toBe(
      "Measuring [tap] latency on [phones]",
    );
  });

  it("finds words whatever their case or accents, and keeps the text as written", () => {
    expect(show(matchExcerpt("A Café for Small Teams", "cafe small"))).toBe(
      "A [Café] for [Small] Teams",
    );
  });

  it("marks a number only as a whole token", () => {
    expect(show(matchExcerpt("6 ideas for 2026", "6"))).toBe("[6] ideas for 2026");
  });

  it("marks a word only where a word of the text starts", () => {
    expect(show(matchExcerpt("AI headlines add detail", "ai"))).toBe("[AI] headlines add detail");
    expect(show(matchExcerpt("Hairline 0.9 adds container-query", "ai"))).toBe(
      "Hairline 0.9 adds container-query",
    );
    expect(show(matchExcerpt("Measuring latency", "lat"))).toBe("Measuring [lat]ency");
  });

  it("marks nothing for an empty query", () => {
    expect(matchExcerpt("Anything at all", "")).toEqual([{ text: "Anything at all", hit: false }]);
  });
});

describe("moreMatches", () => {
  it("says how many other stories matched in words, and nothing for none", () => {
    expect(moreMatches(1)).toBe("and 1 more");
    expect(moreMatches(3)).toBe("and 3 more");
    expect(moreMatches(0)).toBe("");
  });
});

describe("chipFilter", () => {
  it("is the chip just ticked, whatever else was ticked", () => {
    expect(chipFilter(["weekly", "daily"], { value: "daily", checked: true })).toBe("daily");
    expect(chipFilter(["custom"], { value: "custom", checked: true })).toBe("custom");
  });

  it("shows everything once the ticked chip is unticked", () => {
    expect(chipFilter([], { value: "weekly", checked: false })).toBe("all");
  });

  it("reads a page's ticks without a press, and refuses a value it does not offer", () => {
    expect(chipFilter(["weekly"])).toBe("weekly");
    expect(chipFilter([])).toBe("all");
    expect(chipFilter(["all"])).toBe("all");
    expect(chipFilter(["monthly"])).toBe("all");
  });
});

describe("quotedQuery", async () => {
  const { emptyCopy, quotedQuery } = await import("./library");

  it("cuts a long query to 24 characters with an ellipsis, inside balanced quotes", () => {
    const link = "https://example.com/a/very/long/pasted/link/that/runs/on/and/on?with=query";
    const quoted = quotedQuery(link);
    expect(Array.from(quoted)).toHaveLength(24);
    expect(quoted.endsWith("…")).toBe(true);
    expect(link.startsWith(quoted.slice(0, -1))).toBe(true);
    expect(emptyCopy(link, "all").message).toBe(`No results for “${quoted}”`);
  });

  it("leaves a short query whole, and never splits a character", () => {
    expect(quotedQuery("  springs  ")).toBe("springs");
    expect(quotedQuery("🎧".repeat(40))).toBe(`${"🎧".repeat(23)}…`);
  });
});
