import { describe, expect, it } from "vitest";
import { handleStages } from "./stagesApi";
import { groupTimings } from "./stageTimings";

const row = (workflow: string, kind: string, stage: string, p50_ms: number, p90_ms: number) => ({
  workflow,
  kind,
  stage,
  runs: 6,
  p50_ms,
  p90_ms,
});

describe("the Stage times card", () => {
  // The store sorts its rows by stage name, so a card drawn as it came read Commit, Fetch, Judge:
  // a pipeline backwards. A card is one kind of run, and an on-demand podcast is a Catch up.
  it("lists each kind of run's stages in the order the pipeline runs them", () => {
    const groups = groupTimings([
      row("podcast", "on_demand", "script", 900, 1200),
      row("run", "daily", "write", 3000, 4000),
      row("run", "daily", "commit", 500, 700),
      row("run", "daily", "fetch", 1000, 2000),
    ]);
    expect(groups.map((g) => g.title)).toEqual(["Daily", "Catch up"]);
    expect(groups[0]?.stages.map((s) => s.id)).toEqual(["fetch", "write", "commit"]);
  });

  // A page that read a failed store as "no runs" would hide a broken database behind a calm card.
  it("answers 503 with no store and 502 when the store throws, never an empty list", async () => {
    expect((await handleStages("GET", null)).status).toBe(503);
    const broken = await handleStages("GET", async () => {
      throw new Error("down");
    });
    expect(broken.status).toBe(502);
    expect((await handleStages("POST", async () => [])).status).toBe(405);
  });
});
