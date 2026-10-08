import { describe, expect, it } from "vitest";
import {
  type CardData,
  compareCards,
  matchCount,
  matchesFilter,
  normalize,
  resultSummary,
} from "./library";

function card(overrides: Partial<CardData> = {}): CardData {
  return {
    date: "2026-10-07",
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
    expect(matchesFilter(card({ kind: "on-demand" }), "daily")).toBe(true);
  });

  it("keeps podcast episodes out of the daily briefings and in their own filter", () => {
    const episode = card({ kind: "episode", hasAudio: false });
    expect(matchesFilter(episode, "episodes")).toBe(true);
    expect(matchesFilter(episode, "daily")).toBe(false);
    expect(matchesFilter(episode, "weekly")).toBe(false);
    expect(matchesFilter(episode, "all")).toBe(true);
    expect(matchesFilter(card(), "episodes")).toBe(false);
    expect(matchesFilter(card({ kind: "weekly" }), "episodes")).toBe(false);
  });

  it("keeps only briefings with audio when asked", () => {
    expect(matchesFilter(card({ hasAudio: false }), "audio")).toBe(false);
    expect(matchesFilter(card({ hasAudio: false }), "all")).toBe(true);
  });
});

describe("compareCards", () => {
  const older = card({ date: "2026-10-05", minutes: 12, stories: 8 });
  const newer = card({ date: "2026-10-07", minutes: 8, stories: 12 });

  it("sorts by date both ways", () => {
    expect([older, newer].sort((a, b) => compareCards(a, b, "newest"))).toEqual([newer, older]);
    expect([newer, older].sort((a, b) => compareCards(a, b, "oldest"))).toEqual([older, newer]);
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
    expect(resultSummary(0, 9)).toBe("No results");
  });
});
