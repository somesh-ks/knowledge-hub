import { describe, expect, it } from "vitest";
import { placeEmoji } from "./placeEmoji.js";
import { fallbackEmoji, TOPIC_EMOJIS, topicEmoji } from "./topicEmoji.js";

describe("topic emoji", () => {
  // Without Jev a new topic must still get one emoji from the list, and the same one on every
  // reload: a hash of the name, never a random pick that changes the page between builds.
  it("falls back to the same listed emoji for the same name", () => {
    for (const name of ["Quantum gardening", "Zebra finches", "Cheese", "Zymurgy"]) {
      const emoji = fallbackEmoji(name);
      expect(Object.keys(TOPIC_EMOJIS)).toContain(emoji);
      expect(emoji).toBe(fallbackEmoji(name));
    }
  });

  // Stemming "news" to "new" gave "New in CSS" the newspaper.
  it("does not read the word new as news", () => {
    expect(fallbackEmoji("New in CSS")).not.toBe("📰");
    expect(fallbackEmoji("Tech news")).toBe("📰");
  });

  it("shows the stored emoji first, then the shipped one, then the fallback", () => {
    expect(topicEmoji({ id: "x", name: "Music", emoji: "🍳" })).toBe("🍳");
    expect(topicEmoji({ id: "world", name: "World" })).toBe("🌍");
    expect(topicEmoji({ id: "x", name: "Music" })).toBe("🎵");
  });

  // "India" got no flag because the choice list has none. A place comes from a table before Jev, by
  // whole word, and a subject word keeps the flag. Keywords match whole words and the most specific
  // one wins ("venture capital" over "capital", "mental health" over "health").
  it.each([
    ["India", "🇮🇳"],
    ["Indian politics", "🇮🇳"],
    ["India tech", "🇮🇳"],
    ["Tech in India", "🇮🇳"],
    ["UK", "🇬🇧"],
    ["Scotland", "🇬🇧"],
    ["United Kingdom economy", "🇬🇧"],
    ["USA", "🇺🇸"],
    ["American football", "🇺🇸"],
    ["South Korea", "🇰🇷"],
    ["North Korea", "🇰🇵"],
    ["South Africa", "🇿🇦"],
    ["Japan", "🇯🇵"],
    ["Europe", "🌍"],
    ["Latin America", "🌎"],
    ["Southeast Asia", "🌏"],
    ["EU regulation", "🇪🇺"],
    ["Indiana Jones", "no place"],
    ["Indie games", "🎮"],
    ["Tell us what you think", "no place"],
    ["Motorsport", "🏎️"],
    ["Venture capital", "💰"],
    ["Startups", "🦄"],
    ["Crypto", "🪙"],
    ["Mental health", "🧘"],
    ["Health", "🩺"],
    ["Typography", "🔤"],
    ["Quantum computing", "⚛️"],
    ["Real estate", "🏢"],
    ["AR and VR", "🥽"],
  ])("gives %s the emoji %s", (name, expected) => {
    if (expected === "no place") expect(placeEmoji(name)).toBeUndefined();
    else expect(fallbackEmoji(name)).toBe(expected);
  });
});
