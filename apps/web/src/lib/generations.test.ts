import { describe, expect, it } from "vitest";
import type { GenerationRow } from "../types/contracts";
import { describeGeneration, type GenerationWords } from "./generations";

const words: GenerationWords = {
  waiting: "Waiting to start",
  left: "About {n} min left",
  slow: "Taking longer than usual",
  episode: "Catch up",
  briefing: "Podcast",
  regenerate: "Regenerate",
};

const row = (over: Partial<GenerationRow> = {}): GenerationRow => ({
  run_id: 7,
  what: "episode",
  kind: "catch_up",
  target: null,
  state: "running",
  started_at: "2026-10-28T09:00:00Z",
  stage: 1,
  stages: 3,
  label: "Making the episode",
  ...over,
});

const NOW = Date.parse("2026-10-28T09:02:00Z");

describe("a row of the generations list", () => {
  it("is named by the live title, else the request's own, else by what it makes", () => {
    const followed = { id: 7, retry: { body: { request: { title: "Design weekly" } } } };
    expect(
      describeGeneration(row(), {
        now: NOW,
        words,
        followed,
        live: { runId: 7, title: "Live one", tint: null },
      }).title,
    ).toBe("Live one");
    expect(describeGeneration(row(), { now: NOW, words, followed }).title).toBe("Design weekly");
    expect(describeGeneration(row(), { now: NOW, words }).title).toBe("Catch up");
    expect(describeGeneration(row({ what: "briefing" }), { now: NOW, words }).title).toBe(
      "Podcast",
    );
    // Another run's live copy or record says nothing of this one.
    expect(
      describeGeneration(row(), {
        now: NOW,
        words,
        followed: { id: 8 },
        live: { runId: 9, title: "Not mine", tint: null },
      }).title,
    ).toBe("Catch up");
  });

  it("names a Regenerate, and draws the briefing's own cover only for a real digest id", () => {
    const replacing = (id: string) => ({ id: 7, retry: { body: { replace: id } } });
    const mine = describeGeneration(row({ what: "briefing" }), {
      now: NOW,
      words,
      followed: replacing("2026-10-27"),
    });
    expect(mine.title).toBe("Regenerate");
    expect(mine.cover).toBe("/covers/2026-10-27-512.webp");
    const hostile = describeGeneration(row({ what: "briefing" }), {
      now: NOW,
      words,
      followed: replacing("../../etc/passwd"),
    });
    expect(hostile.cover).toBeNull();
  });

  it("says the stage and the time left, slow past one and a half times the usual, and waiting while queued", () => {
    const estimates = [10_000, 240_000, null];
    const at = (elapsedMs: number) =>
      describeGeneration(row({ stage_estimates_ms: estimates }), {
        now: NOW,
        words,
        followed: { id: 7, stageAt: NOW - elapsedMs },
      }).meta;
    expect(at(60_000)).toBe("About 3 min left · Making the episode");
    expect(at(400_000)).toBe("Taking longer than usual · Making the episode");
    expect(describeGeneration(row(), { now: NOW, words }).meta).toBe("Making the episode");
    expect(describeGeneration(row({ state: "queued", stage: 0 }), { now: NOW, words }).meta).toBe(
      "Waiting to start",
    );
  });

  it("draws a bar that is never empty, never full, and further along in a later stage", () => {
    const at = (stage: number) => describeGeneration(row({ stage }), { now: NOW, words }).progress;
    expect(at(0)).toBeGreaterThan(0.04 - 1e-9);
    expect(at(1)).toBeGreaterThan(at(0));
    expect(at(99)).toBeLessThanOrEqual(0.96);
    expect(
      describeGeneration(row({ state: "queued", stage: 0 }), { now: NOW, words }).progress,
    ).toBeLessThan(0.05);
  });

  it("offers Listen now only for an episode with a live copy, and lets through a plain hex tint only", () => {
    const live = (tint: string | null) => ({ runId: 7, title: null, tint });
    expect(describeGeneration(row(), { now: NOW, words, live: live("#a1b2c3") })).toMatchObject({
      listen: true,
      tint: "#a1b2c3",
    });
    expect(
      describeGeneration(row(), { now: NOW, words, live: live("red; background:url(x)") }).tint,
    ).toBeNull();
    expect(describeGeneration(row(), { now: NOW, words }).listen).toBe(false);
    expect(
      describeGeneration(row({ what: "briefing" }), { now: NOW, words, live: live("#a1b2c3") })
        .listen,
    ).toBe(false);
  });
});
