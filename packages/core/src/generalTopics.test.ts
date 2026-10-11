import { describe, expect, it } from "vitest";
import { feedsGeneralOnly, GENERAL_TOPICS, normalizeTopicIds } from "./generalTopics.js";
import { PodcastRequest } from "./podcast.js";

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
      { id: "science", title: "Science" },
      { id: "culture", title: "Culture" },
      { id: "sports", title: "Sports" },
    ]);
  });
});

describe("normalizeTopicIds", () => {
  it("reads a stored technology as the owner's Technology, once", () => {
    expect(normalizeTopicIds(["world", "technology", "tech", "ai"])).toEqual([
      "world",
      "tech",
      "ai",
    ]);
  });
});

describe("feedsGeneralOnly", () => {
  it("is true only when a source has topics and every one is a general topic", () => {
    expect(feedsGeneralOnly(["world"])).toBe(true);
    expect(feedsGeneralOnly(["world", "sports"])).toBe(true);
    expect(feedsGeneralOnly(["world", "trending"])).toBe(false);
    expect(feedsGeneralOnly(["consumer_tech_releases"])).toBe(false);
    expect(feedsGeneralOnly([])).toBe(false);
    expect(feedsGeneralOnly(undefined)).toBe(false);
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
