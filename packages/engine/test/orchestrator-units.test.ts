import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Category, Digest } from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Selection } from "../src/curate/selectionFile.js";
import { BudgetExceededError } from "../src/llm/errors.js";
import { makeCoverPicker } from "../src/run/cover.js";
import { digestFromSelection } from "../src/run/digestFromSelection.js";
import { StageFailure } from "../src/run/errors.js";
import { formatReport } from "../src/run/format.js";
import { mostlyFailed } from "../src/run/judgeStage.js";
import { digestsLackingAudio } from "../src/run/pendingAudio.js";
import { runPipeline } from "../src/run/pipeline.js";
import {
  markStage,
  newPassState,
  type PlanPass,
  readPassState,
  requireStage,
  writePlan,
} from "../src/run/plan.js";
import { resolveCommitPlan } from "../src/run/resolveCommitPlan.js";
import type { CommitReport, CoverPickInput } from "../src/run/types.js";
import {
  bareDeps,
  digestFile,
  json,
  makeWorld,
  options,
  sourceItems,
  sourcesFile,
  WED,
} from "./orchestrator-fixtures.js";
import { REPO_ROOT } from "./score-factories.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "dispatch-units-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
});

async function put(rel: string, content: string): Promise<string> {
  const path = join(root, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return path;
}

const PASS: PlanPass = {
  id: "2026-10-07",
  kind: "regular",
  window: { from: "2026-10-05T05:13:00.000Z", to: WED.toISOString() },
};

describe("pass state", () => {
  it("records a stage and forgets the stages after it", async () => {
    const at = WED.toISOString();
    await markStage(root, PASS, "fetch", { at });
    await markStage(root, PASS, "judge", { at });
    await markStage(root, PASS, "write", { at, outcome: "selected" });
    const afterRerun = await markStage(root, PASS, "judge", { at: "2026-10-07T06:00:00.000Z" });
    expect(afterRerun.fetch).toEqual({ at });
    expect(afterRerun.judge).toEqual({ at: "2026-10-07T06:00:00.000Z" });
    expect(afterRerun.write).toBeUndefined();
  });

  it("starts empty when the file belongs to another id or kind", async () => {
    await markStage(root, PASS, "fetch", { at: WED.toISOString() });
    const other = await readPassState(root, { ...PASS, kind: "on-demand" });
    expect(other).toEqual(newPassState({ id: PASS.id, kind: "on-demand" }));
  });

  it("names the stage and the next step when an earlier stage is missing", async () => {
    await expect(requireStage(root, PASS, "judge", "writing")).rejects.toThrow(
      /2026-10-07: the judge stage has not run, so writing cannot start\. Run `dispatch run --stage judge` first\./,
    );
    await markStage(root, PASS, "judge", { at: WED.toISOString() });
    await expect(requireStage(root, PASS, "judge", "writing")).resolves.toBeDefined();
  });
});

describe("commit plan resolution", () => {
  const gatedPlan = {
    version: 1 as const,
    mode: "scheduled" as const,
    dry_run: false,
    created_at: "2026-10-07T05:13:00.000Z",
    date: "2026-10-07",
    reason: "last regular digest was 2026-10-06",
    passes: [],
    source: "gate" as const,
  };

  async function agentSelection(mtime: Date, id = "2026-10-07"): Promise<void> {
    const selection: Selection = {
      version: 1,
      kind: "on-demand",
      mode: "agent",
      outcome: "selected",
      verified: false,
      window: PASS.window,
      items: [],
    };
    const path = await put(`.cache/run/${id}/selection.json`, JSON.stringify(selection));
    await utimes(path, mtime, mtime);
  }

  it("keeps a gated plan when an agent selection is older than it", async () => {
    await writePlan(root, gatedPlan);
    await agentSelection(new Date("2026-10-06T10:00:00Z"));
    const resolved = await resolveCommitPlan(bareDeps(root, WED), options({ stage: "commit" }));
    expect(resolved.adopted).toBe(false);
    expect(resolved.plan.passes).toEqual([]);
  });

  it("adopts an agent selection written after a gated plan", async () => {
    await writePlan(root, gatedPlan);
    await agentSelection(new Date("2026-10-08T10:00:00Z"));
    const resolved = await resolveCommitPlan(bareDeps(root, WED), options({ stage: "commit" }));
    expect(resolved.adopted).toBe(true);
    expect(resolved.plan).toMatchObject({
      source: "adopted",
      passes: [{ id: "2026-10-07", kind: "on-demand" }],
    });
  });

  it("picks the newest of several agent selections", async () => {
    await agentSelection(new Date("2026-10-08T10:00:00Z"), "2026-10-06");
    await agentSelection(new Date("2026-10-09T10:00:00Z"), "2026-10-07");
    const resolved = await resolveCommitPlan(bareDeps(root, WED), options({ stage: "commit" }));
    expect(resolved.plan.passes[0]?.id).toBe("2026-10-07");
  });

  it("uses a gate plan with passes in preference to anything else, once", async () => {
    await writePlan(root, { ...gatedPlan, passes: [PASS] });
    await agentSelection(new Date("2026-10-09T10:00:00Z"));
    const resolved = await resolveCommitPlan(bareDeps(root, WED), options({ stage: "commit" }));
    expect(resolved.adopted).toBe(false);
    expect(resolved.plan.passes).toEqual([PASS]);

    await writePlan(root, { ...gatedPlan, passes: [PASS], committed_at: WED.toISOString() });
    await expect(
      resolveCommitPlan(bareDeps(root, WED), options({ stage: "commit" })),
    ).rejects.toThrow(/already committed/);
  });

  it("refuses --run for a directory that is not named like a digest id", async () => {
    await expect(
      resolveCommitPlan(bareDeps(root, WED), options({ stage: "commit", run: "my-run" })),
    ).rejects.toThrow(/not a digest id/);
  });

  it("refuses --run when the directory has no selection", async () => {
    await expect(
      resolveCommitPlan(bareDeps(root, WED), options({ stage: "commit", run: "2026-10-07" })),
    ).rejects.toThrow(/No selection\.json/);
  });

  it("refuses an invalid selection with a clear message", async () => {
    await put(".cache/run/2026-10-07/selection.json", '{ "version": 2 }');
    await expect(
      resolveCommitPlan(bareDeps(root, WED), options({ stage: "commit", run: "2026-10-07" })),
    ).rejects.toThrow(/selection\.json is invalid/);
  });

  it("explains what to run when there is nothing to commit", async () => {
    await expect(
      resolveCommitPlan(bareDeps(root, WED), options({ stage: "commit" })),
    ).rejects.toThrow(StageFailure);
  });
});

describe("digestFromSelection", () => {
  const items = sourceItems("blog-a", 4, "p");
  const entry = (index: number, category: Category = "design_engineering_craft") => ({
    id: items[index]?.id ?? "",
    category,
    score: 0.9 - index * 0.1,
    headline: `Springlet ${index} retargets springs mid-flight`,
    summary: `Springlet ${index} swaps the rest target without resetting velocity. Interrupted drawers keep their speed.`,
    why: "Copy the retargeting pattern for drawers and toasts",
  });
  const selection = (list: Selection["items"]): Selection => ({
    version: 1,
    kind: "weekly",
    mode: "api",
    outcome: "selected",
    verified: true,
    window: PASS.window,
    items: list,
  });
  const base = {
    pool: items,
    sourceNames: { "blog-a": "Blog A" },
    now: WED,
    coverPicker: () => ({ template: "spring" as const, palette: "dusk", seed: 7 }),
    allocateId: () => "2026-10-07-weekly",
    verified: true,
  };

  it("renders the selection with the allocated id, the kind, sections and source names", () => {
    const digest: Digest = digestFromSelection({
      ...base,
      selection: selection([entry(0), entry(1), entry(2), entry(3)]),
    });
    expect(digest).toMatchObject({
      id: "2026-10-07-weekly",
      date: "2026-10-07",
      kind: "weekly",
      verified: true,
      audio: null,
    });
    expect(digest.items.filter((item) => item.section === "top")).toHaveLength(3);
    expect(digest.items.every((item) => item.source === "Blog A")).toBe(true);
  });

  it("fails clearly for an id that is not in the pool", () => {
    expect(() =>
      digestFromSelection({
        ...base,
        selection: selection([entry(0), entry(1), { ...entry(2), id: "ffffffffffff" }]),
      }),
    ).toThrow(/ffffffffffff, which is not in the pool/);
  });

  it("fails clearly for a category that never publishes", () => {
    expect(() =>
      digestFromSelection({
        ...base,
        selection: selection([entry(0), entry(1), entry(2, "venture_capital_and_gossip")]),
      }),
    ).toThrow(/never publishes/);
  });
});

describe("makeCoverPicker", () => {
  const sample = (
    sourceType: "rss" | "youtube",
    category: Category = "css_canvas_motion_techniques",
  ) => ({
    digestId: "2026-10-07",
    date: "2026-10-07",
    kind: "regular" as const,
    items: [
      {
        id: "000000000001",
        section: "top" as const,
        category,
        source_type: sourceType,
        headline: "h",
        url: "https://example.com/a",
        source: "s",
        summary: "s",
        why: "w",
        score: 0.9,
      },
    ],
  });

  function capture(previous?: { template: string; palette: string }) {
    const seen: CoverPickInput[] = [];
    const picker = makeCoverPicker((input) => {
      seen.push(input);
      return { template: "band", palette: "dusk", seed: 1 };
    }, previous);
    return { seen, picker };
  }

  it("leads with the first item's category and passes the previous cover", () => {
    const { seen, picker } = capture({ template: "spring", palette: "mist" });
    picker(sample("rss"));
    expect(seen[0]).toEqual({
      id: "2026-10-07",
      date: "2026-10-07",
      kind: "regular",
      lead_category: "css_canvas_motion_techniques",
      previous: { template: "spring", palette: "mist" },
    });
  });

  it("reports a video lead as watch", () => {
    const { seen, picker } = capture();
    picker(sample("youtube"));
    expect(seen[0]?.lead_category).toBe("watch");
    expect(seen[0]).not.toHaveProperty("previous");
  });
});

describe("digestsLackingAudio", () => {
  const audio = { url: "https://example.public.blob.vercel-storage.com/a.mp3", duration_ms: 1000 };

  it("counts digests from the last seven days with no audio, newest first", async () => {
    await put("Digests/2026/10/2026-10-07.md", digestFile("2026-10-07"));
    await put("Digests/2026/10/2026-10-06.md", digestFile("2026-10-06", audio));
    await put("Digests/2026/10/2026-10-05.md", digestFile("2026-10-05"));
    expect(await digestsLackingAudio(root, WED, 7)).toEqual(["2026-10-07", "2026-10-05"]);
  });

  it("includes day seven and excludes day eight", async () => {
    await put("Digests/2026/09/2026-09-30.md", digestFile("2026-09-30"));
    await put("Digests/2026/09/2026-09-29.md", digestFile("2026-09-29"));
    expect(await digestsLackingAudio(root, WED, 7)).toEqual(["2026-09-30"]);
  });

  it("skips a digest it cannot read instead of asking for a deploy every day", async () => {
    await put("Digests/2026/10/2026-10-06.md", "not a digest");
    expect(await digestsLackingAudio(root, WED, 7)).toEqual([]);
  });

  it("returns nothing when there are no digests", async () => {
    expect(await digestsLackingAudio(root, WED, 7)).toEqual([]);
  });
});

describe("stage failures", () => {
  it("treats half of a stage's inputs failing as an outage", () => {
    expect(mostlyFailed(0, 0)).toBe(false);
    expect(mostlyFailed(1, 3)).toBe(false);
    expect(mostlyFailed(1, 2)).toBe(true);
    expect(mostlyFailed(3, 3)).toBe(true);
  });

  it("redacts a secret from the failure a stage reports", async () => {
    const secret = "nb-secret-0123456789abcdef";
    const world = makeWorld(root, { now: WED });
    world.deps = {
      ...world.deps,
      secrets: [secret],
      runtime: async () => {
        throw new Error(`NEBIUS rejected ${secret}`);
      },
    };
    await runPipeline(world.deps, options({ stage: "gate" }));
    await runPipeline(world.deps, options({ stage: "fetch" }));
    const result = await runPipeline(world.deps, options({ stage: "judge" }));
    expect(result.code).toBe(1);
    expect(JSON.stringify(result.report)).not.toContain(secret);
    expect(JSON.stringify(result.report)).toContain("[redacted]");
  });

  it("fails a stage when the token budget is exceeded, with its own message", async () => {
    await put("config/sources.json", json(sourcesFile()));
    await put(
      "config/preferences.json",
      await readFile(join(REPO_ROOT, "config/preferences.json"), "utf8"),
    );
    const world = makeWorld(root, { now: WED });
    const runtime = await world.deps.runtime();
    world.deps = {
      ...world.deps,
      runtime: async () => ({
        ...runtime,
        judge: {
          name: "nebius",
          model: "m",
          questionsHash: "abc123def456",
          judge: async () => {
            throw new BudgetExceededError(400_000, 399_000, 5_000);
          },
        },
      }),
    };
    await runPipeline(world.deps, options({ stage: "gate" }));
    await runPipeline(world.deps, options({ stage: "fetch" }));
    const result = await runPipeline(world.deps, options({ stage: "judge" }));
    expect(result.code).toBe(1);
    expect(JSON.stringify(result.report)).toContain("Token budget exceeded");
  });

  it("prints outcome and deploy as the string and boolean the workflow reads", async () => {
    await put(
      "state/last-run.json",
      JSON.stringify({
        version: 1,
        regular: { at: "2026-10-06T05:13:00Z", outcome: "published", items: 5 },
      }),
    );
    const world = makeWorld(root, { now: WED });
    const result = await runPipeline(world.deps, options());
    expect(result.code).toBe(0);
    const printed = JSON.parse(JSON.stringify(result.report)) as CommitReport;
    expect(printed.outcome).toBe("gated");
    expect(printed.deploy).toBe(false);
    expect(["published", "gated", "nothing", "failed"]).toContain(printed.outcome);
  });
});

describe("formatReport", () => {
  it("describes a failure with its stage", () => {
    expect(
      formatReport({
        outcome: "failed",
        stage: "judge",
        error: "the judges answered 1 of 9 items",
        dry_run: false,
        digests: [],
        deploy: false,
        items: 0,
      }),
    ).toBe("Failed at judge: the judges answered 1 of 9 items");
  });

  it("describes a due gate with its passes and a dry run", () => {
    const text = formatReport({
      due: true,
      reason: "forced run ignores the gate",
      mode: "scheduled",
      passes: [{ id: "2026-10-07", kind: "regular", window: PASS.window }],
      dry_run: true,
    });
    expect(text).toContain("Run is due (scheduled): forced run ignores the gate.");
    expect(text).toContain("2026-10-07 (regular)");
    expect(text).toContain("Dry run: nothing will be written or committed.");
  });

  it("describes a stage and a commit", () => {
    expect(
      formatReport({
        stage: "fetch",
        ok: true,
        dry_run: false,
        passes: [{ id: "2026-10-07", kind: "regular", kept: 8 }],
      }),
    ).toContain('2026-10-07 (regular) {"kept":8}');
    const text = formatReport({
      outcome: "published",
      digests: [
        {
          id: "2026-10-07",
          kind: "regular",
          outcome: "published",
          items: 8,
          verified: true,
          path: "Digests/2026/10/2026-10-07.md",
          preview: null,
        },
      ],
      deploy: true,
      items: 8,
      dry_run: false,
      commit: { status: "pushed", sha: "abcdef1234567", message: "chore(digest): 2026-10-07" },
    });
    expect(text).toContain("Outcome: published.");
    expect(text).toContain("2026-10-07 (regular): published, 8 items, verified");
    expect(text).toContain('Commit: pushed abcdef1 "chore(digest): 2026-10-07"');
    expect(text).toContain("Deploy: yes");
  });
});
