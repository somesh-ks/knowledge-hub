import { describe, expect, it } from "vitest";
import { handleTopicSuggestions, resetTopicSuggestionsCache } from "./topicSuggestions";

describe("handleTopicSuggestions", () => {
  it("rejects an empty topic id with 400", async () => {
    const res = await handleTopicSuggestions({ topicId: null, clientKey: "127.0.0.1" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Missing topic id in ?id=" });
  });

  it("answers 200 with 5 suggested sources for a known topic", async () => {
    resetTopicSuggestionsCache();
    const res = await handleTopicSuggestions({ topicId: "design", clientKey: "127.0.0.1" });
    expect(res.status).toBe(200);
    if ("suggestions" in res.body) {
      expect(res.body.topicId).toBe("design");
      expect(res.body.suggestions).toHaveLength(5);
      const first = res.body.suggestions[0];
      expect(first).toBeDefined();
      expect(first?.score).toBeGreaterThanOrEqual(2.5);
      expect(first?.feed_url).toBeTruthy();
      expect(first?.host).toBeTruthy();
    } else {
      expect.unreachable("expected suggestions in body");
    }
  });

  it("serves repeated requests from cache within TTL", async () => {
    resetTopicSuggestionsCache();
    let now = 1000;
    const res1 = await handleTopicSuggestions(
      { topicId: "ai", clientKey: "127.0.0.1" },
      { now: () => now },
    );
    expect(res1.status).toBe(200);

    now += 5000; // 5 seconds later
    const res2 = await handleTopicSuggestions(
      { topicId: "ai", clientKey: "127.0.0.1" },
      { now: () => now },
    );
    expect(res2.status).toBe(200);
    expect(res2.body).toEqual(res1.body);
  });
});
