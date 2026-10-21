import { describe, expect, it } from "vitest";
import { fallbackEmoji, TOPIC_EMOJIS, topicEmoji } from "./topicEmoji.js";

describe("topic emoji", () => {
  // Without Jev a new topic must still get one emoji from the list, and the same one on every
  // reload: a hash of the name, never a random pick that changes the page between builds.
  it("falls back to the same listed emoji for the same name", () => {
    for (const name of ["Quantum gardening", "Zebra finches", "Cheese", "Motorsport"]) {
      expect(Object.keys(TOPIC_EMOJIS)).toContain(fallbackEmoji(name));
      expect(fallbackEmoji(name)).toBe(fallbackEmoji(name));
    }
  });

  it("shows the stored emoji first, then the shipped one, then the fallback", () => {
    expect(topicEmoji({ id: "x", name: "Music", emoji: "🍳" })).toBe("🍳");
    expect(topicEmoji({ id: "world", name: "World" })).toBe("🌍");
    expect(topicEmoji({ id: "x", name: "Music" })).toBe("🎵");
  });
});
