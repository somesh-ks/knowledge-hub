import { describe, expect, it } from "vitest";
import { holdUntilPublishTime, MAX_HOLD_MS } from "../src/run/commitStage.js";
import type { Plan } from "../src/run/plan.js";
import type { RunDeps } from "../src/run/types.js";

// A run that generated ahead publishes at the scheduled time, not when generation finished (D193).
const NOW = new Date("2026-10-25T05:20:00Z");
const plan = (publishAt?: string) => ({ publish_at: publishAt }) as Plan;
const deps = (waits: number[]) =>
  ({
    now: () => NOW,
    log: { info: () => {} },
    wait: async (ms: number) => {
      waits.push(ms);
    },
  }) as unknown as RunDeps;

describe("holdUntilPublishTime", () => {
  it("waits for the scheduled time when generation finished ahead of it", async () => {
    const waits: number[] = [];
    await holdUntilPublishTime(deps(waits), plan("2026-10-25T06:00:00Z"));
    expect(waits).toEqual([40 * 60_000]);
  });

  it("publishes at once when the run started late, has no time, or the time is too far off", async () => {
    const waits: number[] = [];
    await holdUntilPublishTime(deps(waits), plan("2026-10-25T04:00:00Z"));
    await holdUntilPublishTime(deps(waits), plan());
    await holdUntilPublishTime(
      deps(waits),
      plan(new Date(NOW.getTime() + MAX_HOLD_MS + 60_000).toISOString()),
    );
    expect(waits).toEqual([]);
  });
});
