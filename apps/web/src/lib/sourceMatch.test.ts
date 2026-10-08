import { describe, expect, it } from "vitest";
import { MAX_SUGGESTIONS, matchOffers, matchScore, wordsOf } from "./sourceMatch";

const offer = (name: string, ...tags: string[]) => ({ name, tags });

describe("wordsOf", () => {
  it("lowercases, splits on anything that is not a letter or digit and drops repeats", () => {
    expect([...wordsOf("Design, DESIGN & UX-research (2026)")].sort()).toEqual([
      "2026",
      "design",
      "research",
      "ux",
    ]);
  });

  it("folds a plural into its singular, and leaves short words and double s alone", () => {
    expect([...wordsOf("interfaces launches stories boxes ai bus class")].sort()).toEqual([
      "ai",
      "box",
      "bus",
      "class",
      "interface",
      "launch",
      "story",
    ]);
  });

  it("is empty for text with no words", () => {
    expect(wordsOf("  ,,, ").size).toBe(0);
  });
});

describe("matchScore", () => {
  it("counts the tags that appear among the topic's words, each once", () => {
    const words = wordsOf("Motion design for interfaces");
    expect(matchScore(words, ["motion", "design", "interface", "motion"])).toBe(3);
    expect(matchScore(words, ["audio"])).toBe(0);
  });

  it("matches a tag in any case and in its plural form", () => {
    expect(matchScore(wordsOf("tool launch"), ["Tools", "LAUNCHES"])).toBe(2);
  });
});

describe("matchOffers", () => {
  const catalogue = [
    offer("Zeta Design", "design", "ux"),
    offer("Alpha Design", "design", "ux"),
    offer("Motion Weekly", "motion", "animation", "design"),
    offer("Model Ledger", "ai", "models"),
  ];

  it("returns the offers that share a word with the name or the description", () => {
    const found = matchOffers(
      { name: "Spatial computing", description: "Headsets and the AI models behind them." },
      catalogue,
    );
    expect(found.map((entry) => entry.name)).toEqual(["Model Ledger"]);
  });

  it("puts the offer with the most shared words first and breaks ties by name", () => {
    const found = matchOffers(
      { name: "Motion design", description: "Animation and ux" },
      catalogue,
    );
    expect(found.map((entry) => entry.name)).toEqual([
      "Motion Weekly",
      "Alpha Design",
      "Zeta Design",
    ]);
  });

  it("returns nothing when no word is shared, or when there is no text yet", () => {
    expect(matchOffers({ name: "Gardening", description: "Soil and seeds" }, catalogue)).toEqual(
      [],
    );
    expect(matchOffers({ name: "", description: "" }, catalogue)).toEqual([]);
  });

  it("returns at most six by default, and as many as asked when asked", () => {
    const many = Array.from({ length: 10 }, (_, index) => offer(`Source ${index}`, "design"));
    expect(MAX_SUGGESTIONS).toBe(6);
    expect(matchOffers({ name: "Design", description: "" }, many)).toHaveLength(6);
    expect(matchOffers({ name: "Design", description: "" }, many, 2)).toHaveLength(2);
  });

  it("keeps the extra fields of each offer", () => {
    const found = matchOffers(
      { name: "Design", description: "" },
      [{ name: "A", tags: ["design"], id: "a" }],
    );
    expect(found[0]?.id).toBe("a");
  });
});
