import { describe, expect, it } from "vitest";
import { type EmojiGroup, searchEmoji, suggestedEmoji } from "./emojiSearch";

const groups: EmojiGroup[] = [
  {
    name: "Objects",
    emoji: [
      ["🚀", "rocket", "launch ship space"],
      ["🛸", "flying saucer", "alien ufo"],
    ],
  },
  {
    name: "Flags",
    emoji: [
      ["🏁", "chequered flag", "race"],
      ["🇮🇳", "flag: india", "in"],
    ],
  },
];

describe("searchEmoji", () => {
  it("finds an emoji by a name's start or a keyword, a name before a keyword", () => {
    expect(searchEmoji(groups, "ind")[0]?.[0]).toBe("🇮🇳");
    expect(searchEmoji(groups, "space")[0]?.[0]).toBe("🚀");
    // "flag" names two; every typed word must match.
    expect(searchEmoji(groups, "flag").length).toBe(2);
    expect(searchEmoji(groups, "flag race").map((e) => e[0])).toEqual(["🏁"]);
    expect(searchEmoji(groups, "   ")).toEqual([]);
  });
});

describe("suggestedEmoji", () => {
  it("starts with the topic's own emoji and its name's flag, once each, and fits the row", () => {
    const row = suggestedEmoji("India", "🌍");
    expect(row.slice(0, 2)).toEqual(["🌍", "🇮🇳"]);
    expect(new Set(row).size).toBe(row.length);
    expect(row.length).toBeLessThanOrEqual(8);
  });

  it("fills the row when the name matches little, so the owner never sees a lone emoji", () => {
    expect(suggestedEmoji("Audio interfaces", "🎵")).toHaveLength(8);
  });
});
