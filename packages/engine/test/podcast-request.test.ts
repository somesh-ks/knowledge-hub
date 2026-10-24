import { PodcastCommand, PodcastRequest, StoredPodcastRequest } from "@singularity/core";
import { describe, expect, it } from "vitest";
import { aimedChars, planPodcast, structureFor } from "../src/podcast/plan.js";
import { REQUEST } from "./podcast-fixtures.js";

describe("PodcastRequest", () => {
  it("accepts the documented shape", () => {
    expect(PodcastRequest.parse({ ...REQUEST, title: "Morning" }).title).toBe("Morning");
  });

  it.each([
    ["no topics", { ...REQUEST, topic_ids: [] }],
    ["fifty-one topics", { ...REQUEST, topic_ids: Array.from({ length: 51 }, (_, i) => `t${i}`) }],
    ["length 4", { ...REQUEST, length_minutes: 4 }],
    ["window 14", { ...REQUEST, window_days: 14 }],
    ["format chat", { ...REQUEST, format: "chat" }],
    ["format headlines", { ...REQUEST, format: "headlines" }],
    ["a voice id with a space", { ...REQUEST, voice_id: "not a voice" }],
    ["a numeric second voice", { ...REQUEST, voice_id_b: 4 }],
    ["tone loud", { ...REQUEST, tone: "loud" }],
    ["title over 80", { ...REQUEST, title: "x".repeat(81) }],
  ])("rejects %s", (_name, value) => {
    expect(PodcastRequest.safeParse(value).success).toBe(false);
  });
});

describe("voices and stored requests", () => {
  it("accepts a voice id, a second voice and null", () => {
    const parsed = PodcastRequest.parse({ ...REQUEST, voice_id: "ada_1", voice_id_b: null });
    expect(parsed).toMatchObject({ voice_id: "ada_1", voice_id_b: null });
  });

  it("still parses a stored request that says headlines", () => {
    expect(StoredPodcastRequest.parse({ ...REQUEST, format: "headlines" }).format).toBe(
      "headlines",
    );
  });
});

describe("host names", () => {
  const discussion = { ...REQUEST, format: "discussion" as const };

  it("accepts a pair of names, trimmed, with letters from any language", () => {
    const parsed = PodcastRequest.parse({
      ...discussion,
      host_names: { a: " Nora ", b: "Mary-Jane" },
    });
    expect(parsed.host_names).toEqual({ a: "Nora", b: "Mary-Jane" });
    expect(
      PodcastRequest.parse({ ...discussion, host_names: { a: "Zoë", b: "O’Neil" } }).host_names,
    ).toEqual({ a: "Zoë", b: "O’Neil" });
  });

  it.each([
    ["a missing second name", { a: "Nora" }],
    ["two words", { a: "Nora Jones", b: "Owen" }],
    ["digits", { a: "R2D2", b: "Owen" }],
    ["a leading hyphen", { a: "-Nora", b: "Owen" }],
    ["25 letters", { a: "N".repeat(25), b: "Owen" }],
    ["an empty name", { a: " ", b: "Owen" }],
    ["a number", { a: 4, b: "Owen" }],
    ["markup", { a: "<b>", b: "Owen" }],
    ["a list", ["Nora", "Owen"]],
  ])("rejects %s", (_name, hostNames) => {
    expect(PodcastRequest.safeParse({ ...discussion, host_names: hostNames }).success).toBe(false);
  });

  it("still parses a request without names, and a create command keeps them", () => {
    expect(StoredPodcastRequest.parse(discussion)).not.toHaveProperty("host_names");
    const request = { ...discussion, host_names: { a: "Nora", b: "Owen" } };
    expect(PodcastCommand.parse(request)).toEqual({ action: "create", request });
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
        const fits = (n: number): number => aimedChars(structureFor(minutes, n, format), format);
        expect(fits(plan.max_stories)).toBeLessThanOrEqual(plan.budget_chars);
        expect(fits(plan.max_stories + 1)).toBeGreaterThan(plan.budget_chars);
      }
    },
  );
});
