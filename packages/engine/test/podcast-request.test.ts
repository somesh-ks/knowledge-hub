import { PodcastRequest } from "@dispatch/core";
import { describe, expect, it } from "vitest";
import { FRAME_CHARS, parseRequest, planPodcast, STORY_CHARS } from "../src/podcast/plan.js";
import { InvalidRequestError } from "../src/podcast/types.js";
import { REQUEST } from "./podcast-fixtures.js";

describe("PodcastRequest", () => {
  it("accepts the documented shape", () => {
    expect(PodcastRequest.parse({ ...REQUEST, title: "Morning" }).title).toBe("Morning");
  });

  it.each([
    ["no topics", { ...REQUEST, topic_ids: [] }],
    ["seven topics", { ...REQUEST, topic_ids: ["a", "b", "c", "d", "e", "f", "g"] }],
    ["length 4", { ...REQUEST, length_minutes: 4 }],
    ["window 14", { ...REQUEST, window_days: 14 }],
    ["format chat", { ...REQUEST, format: "chat" }],
    ["tone loud", { ...REQUEST, tone: "loud" }],
    ["title over 80", { ...REQUEST, title: "x".repeat(81) }],
  ])("rejects %s", (_name, value) => {
    expect(PodcastRequest.safeParse(value).success).toBe(false);
  });
});

describe("parseRequest", () => {
  it("returns the request for valid JSON", () => {
    expect(parseRequest(JSON.stringify(REQUEST))).toEqual(REQUEST);
  });

  it("refuses text that is not JSON", () => {
    expect(() => parseRequest("{nope")).toThrow(InvalidRequestError);
    expect(() => parseRequest("{nope")).toThrow(/not valid JSON/);
  });

  it("names the field that is wrong", () => {
    expect(() => parseRequest(JSON.stringify({ ...REQUEST, length_minutes: 4 }))).toThrow(
      /length_minutes/,
    );
    expect(() => parseRequest(JSON.stringify({ ...REQUEST, topic_ids: [] }))).toThrow(/topic_ids/);
  });
});

describe("planPodcast", () => {
  it.each([
    [3, 2904],
    [5, 4840],
    [10, 9680],
    [15, 14520],
  ] as const)("budgets %i minutes at 968 characters a minute", (minutes, chars) => {
    expect(planPodcast({ ...REQUEST, length_minutes: minutes }).budget_chars).toBe(chars);
  });

  it("never plans above the hard cap", () => {
    const plan = planPodcast({ ...REQUEST, length_minutes: 15 });
    expect(plan.budget_chars).toBeLessThanOrEqual(15_000);
  });

  it.each(["readout", "discussion", "headlines"] as const)(
    "fits whole %s stories into every length",
    (format) => {
      for (const minutes of [3, 5, 10, 15] as const) {
        const plan = planPodcast({ ...REQUEST, format, length_minutes: minutes });
        const per = STORY_CHARS[format];
        expect(plan.max_stories * per + FRAME_CHARS).toBeLessThanOrEqual(plan.budget_chars);
        expect((plan.max_stories + 1) * per + FRAME_CHARS).toBeGreaterThan(plan.budget_chars);
      }
    },
  );
});
