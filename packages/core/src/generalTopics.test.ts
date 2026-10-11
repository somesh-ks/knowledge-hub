import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GENERAL_TOPICS, loadGeneralFeeds, parseGeneralFeeds } from "./generalTopics.js";
import { PodcastRequest } from "./podcast.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const base = {
  length_minutes: 5,
  format: "readout",
  window_days: 2,
  tone: "neutral",
} as const;

describe("GENERAL_TOPICS", () => {
  it("is the contract with the Create form", () => {
    expect(GENERAL_TOPICS).toEqual([
      { id: "world", title: "World" },
      { id: "business", title: "Business" },
      { id: "technology", title: "Technology" },
      { id: "science", title: "Science" },
      { id: "culture", title: "Culture" },
      { id: "sports", title: "Sports" },
    ]);
  });
});

describe("config/general-feeds.json", () => {
  it("gives every topic at least two feeds and never repeats a URL", async () => {
    const feeds = await loadGeneralFeeds(ROOT);
    const urls: string[] = [];
    for (const topic of GENERAL_TOPICS) {
      const list = feeds.topics[topic.id];
      expect(list.length, topic.id).toBeGreaterThanOrEqual(2);
      expect(list.length, topic.id).toBeLessThanOrEqual(4);
      expect(new Set(list.map((f) => f.id)).size, `${topic.id} outlet ids`).toBe(list.length);
      urls.push(...list.map((f) => f.feed_url));
    }
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.every((u) => u.startsWith("https://"))).toBe(true);
  });

  it("rejects a file that misses a topic or holds a bad URL", () => {
    expect(() => parseGeneralFeeds({ version: 1, topics: { world: [] } })).toThrow();
    const bad = {
      version: 1,
      topics: Object.fromEntries(
        GENERAL_TOPICS.map((t) => [t.id, [{ id: "a", name: "A", feed_url: "nope" }]]),
      ),
    };
    expect(() => parseGeneralFeeds(bad)).toThrow();
  });
});

describe("a podcast request's topics", () => {
  it("accepts one to six general topics for a general audience", () => {
    for (const topics of [["world"], GENERAL_TOPICS.map((t) => t.id)]) {
      expect(
        PodcastRequest.safeParse({ ...base, topic_ids: topics, audience: "general" }).success,
      ).toBe(true);
    }
  });

  it("accepts briefing ids mixed with general ids under either audience", () => {
    for (const audience of ["general", "custom"] as const) {
      const request = { ...base, topic_ids: ["design", "ui-craft", "tech", "world"], audience };
      expect(PodcastRequest.safeParse(request).success).toBe(true);
    }
    expect(
      PodcastRequest.safeParse({ ...base, topic_ids: ["world", "ai"], audience: "general" })
        .success,
    ).toBe(true);
  });

  it("validates a custom or untagged request as before", () => {
    for (const audience of ["custom", undefined]) {
      const request = { ...base, topic_ids: ["ai", "design", "anything"], audience };
      expect(PodcastRequest.safeParse(request).success).toBe(true);
    }
    expect(PodcastRequest.safeParse({ ...base, topic_ids: [], audience: "general" }).success).toBe(
      false,
    );
  });
});
