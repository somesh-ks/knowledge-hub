import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseDigestFile } from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeCurateCommand } from "../src/commands/curate.js";
import { makeRenderCommand } from "../src/commands/render.js";
import type { ApiRuntimeFactory } from "../src/curate/apiRuntime.js";
import { Selection } from "../src/curate/selectionFile.js";
import {
  captureStdout,
  fakeWriter,
  goodSpecs,
  keywordGrounder,
  longText,
  makeContext,
  makePool,
  makeRoot,
  TableJudge,
  type TestRoot,
  writeRunFile,
} from "./curate-helpers.js";
import { COVER, makeFixture } from "./render-factories.js";
import { makeItem, REPO_ROOT } from "./score-factories.js";

const RUN = "2026-10-07";
const ENV = { NEBIUS_API_KEY: "nb-secret-0123456789abcdef", DISPATCH_MODEL: "Qwen/Qwen3-32B" };

let tr: TestRoot;
beforeEach(async () => {
  tr = await makeRoot();
});
afterEach(async () => {
  await tr.cleanup();
});

const runFile = (name: string): string => join(tr.root, ".cache", "run", RUN, name);
const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

function factory(judge: TableJudge): ApiRuntimeFactory {
  return () => ({
    judge,
    writer: fakeWriter(),
    grounder: keywordGrounder,
    extract: async (item) => longText(item),
    judgeFailures: [],
    usage: () => ({ tokens: 10, tokenLimit: 400_000 }),
  });
}

describe("dispatch curate: outcomes", () => {
  it("treats an empty pool as a quiet day: exit 0, outcome nothing, a selection is written", async () => {
    await writeRunFile(tr.root, RUN, "pool.json", []);
    const { ctx } = makeContext(tr.root, { env: ENV });
    const judge = new TableJudge(new Map());
    const { result, stdout } = await captureStdout(() =>
      makeCurateCommand(factory(judge))([], ctx),
    );
    expect(result).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ outcome: "nothing", items: 0 });
    expect(
      Selection.parse(JSON.parse(await readFile(runFile("selection.json"), "utf8"))).outcome,
    ).toBe("nothing");
    expect(judge.asked).toEqual([]);
  });

  it("exits 1 for an outage and writes no selection, keeping the judgments and the report", async () => {
    const pool = makePool(goodSpecs(6));
    await writeRunFile(tr.root, RUN, "pool.json", pool.items);
    const { ctx, logs } = makeContext(tr.root, { env: ENV });
    const judge = new TableJudge(pool.table, new Set(pool.items.map((i) => i.id)));
    const { result, stdout } = await captureStdout(() =>
      makeCurateCommand(factory(judge))([], ctx),
    );
    expect(result).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({
      outcome: "failed",
      reason: expect.stringContaining("outage"),
    });
    expect(await exists(runFile("selection.json"))).toBe(false);
    const report = JSON.parse(await readFile(runFile("curate-report.json"), "utf8")) as {
      outcome: string;
      failure: string;
    };
    expect(report.outcome).toBe("failed");
    expect(report.failure).toContain("outage");
    expect(await exists(runFile("written.json"))).toBe(true);
    expect(logs.some((l) => l.level === "error" && l.message.includes("curate failed"))).toBe(true);
  });

  it("does not leave an old selection behind to be rendered after a failed rerun", async () => {
    const pool = makePool(goodSpecs(6));
    await writeRunFile(tr.root, RUN, "pool.json", pool.items);
    const { ctx } = makeContext(tr.root, { env: ENV });
    // The failing rerun must not write selection.json, and render must then refuse.
    const judge = new TableJudge(pool.table, new Set(pool.items.map((i) => i.id)));
    await captureStdout(() => makeCurateCommand(factory(judge))([], ctx));
    const { result } = await captureStdout(() =>
      makeRenderCommand({ coverPicker: () => COVER })([], ctx),
    );
    expect(result).toBe(1);
  });
});

describe("dispatch curate: agent mode keeps selection.json engine-written", () => {
  const agent = makeCurateCommand();
  const agentItems = (pool: ReturnType<typeof makePool>) =>
    pool.items.slice(0, 4).map((item, i) => ({
      id: item.id,
      category: i % 2 === 0 ? "design_engineering_craft" : "frontier_model_releases",
      score: 0.9 - i * 0.05,
      headline: `Springlet ${i} retargets springs mid-flight`,
      summary:
        "Springlet swaps the rest target without resetting velocity. Interrupted drawers keep their speed, and the change is about 120 lines of plain JavaScript. A fixed timestep keeps the motion the same on slow phones.",
      // The why line is optional in agent mode: every other item carries one.
      ...(i % 2 === 0 ? { why: "Copy the retargeting pattern for drawers and toasts" } : {}),
    }));

  it("tells the session to write agent-selection.json", async () => {
    const pool = makePool(goodSpecs(5));
    await writeRunFile(tr.root, RUN, "pool.json", pool.items);
    const { ctx } = makeContext(tr.root);
    const { stdout } = await captureStdout(() => agent(["--mode", "agent"], ctx));
    const body = JSON.parse(stdout) as { status: string; input: string };
    expect(body.status).toBe("awaiting_selection");
    expect(body.input).toBe(runFile("agent-selection.json"));
    expect(await exists(runFile("selection.json"))).toBe(false);
  });

  it("validates agent-selection.json, writes selection.json itself, and leaves the input untouched", async () => {
    const pool = makePool(goodSpecs(5));
    await writeRunFile(tr.root, RUN, "pool.json", pool.items);
    const inputPath = await writeRunFile(tr.root, RUN, "agent-selection.json", {
      version: 1,
      items: agentItems(pool),
    });
    const before = await readFile(inputPath, "utf8");
    const { ctx } = makeContext(tr.root);
    const { result } = await captureStdout(() => agent(["--mode", "agent"], ctx));
    expect(result).toBe(0);
    expect(await readFile(inputPath, "utf8")).toBe(before);
    expect(
      Selection.parse(JSON.parse(await readFile(runFile("selection.json"), "utf8"))),
    ).toMatchObject({
      mode: "agent",
      verified: false,
    });
  });

  it("prefers agent-selection.json over a leftover selection.json", async () => {
    const pool = makePool(goodSpecs(5));
    await writeRunFile(tr.root, RUN, "pool.json", pool.items);
    await writeRunFile(tr.root, RUN, "selection.json", { version: 1, items: [] });
    await writeRunFile(tr.root, RUN, "agent-selection.json", {
      version: 1,
      items: agentItems(pool),
    });
    const { ctx } = makeContext(tr.root);
    const { result } = await captureStdout(() => agent(["--mode", "agent"], ctx));
    expect(result).toBe(0);
  });

  it("writes no selection.json for an invalid agent-selection.json", async () => {
    const pool = makePool(goodSpecs(5));
    await writeRunFile(tr.root, RUN, "pool.json", pool.items);
    const items = agentItems(pool);
    items[0] = { ...(items[0] as (typeof items)[number]), headline: "An incredible release!" };
    await writeRunFile(tr.root, RUN, "agent-selection.json", { version: 1, items });
    const { ctx } = makeContext(tr.root);
    const { result } = await captureStdout(() => agent(["--mode", "agent"], ctx));
    expect(result).toBe(1);
    expect(await exists(runFile("selection.json"))).toBe(false);
  });
});

describe("the example a session copies", () => {
  const agent = makeCurateCommand();
  it("validates as an agent selection: four-beat summaries, no why line, one tech story", async () => {
    const example = JSON.parse(
      await readFile(
        join(REPO_ROOT, ".claude", "skills", "digest", "assets", "agent-selection.example.json"),
        "utf8",
      ),
    ) as { items: Array<{ id: string; category: string }> };
    const pool = example.items.map((entry) => ({
      ...makeItem({ url: `https://example.com/${entry.id}` }),
      id: entry.id,
    }));
    await writeRunFile(tr.root, RUN, "pool.json", pool);
    await writeRunFile(tr.root, RUN, "agent-selection.json", example);
    const { ctx } = makeContext(tr.root);
    const { result, stdout } = await captureStdout(() => agent(["--mode", "agent"], ctx));
    expect(stdout).toContain('"status":"validated"');
    expect(result).toBe(0);
    const selection = Selection.parse(
      JSON.parse(await readFile(runFile("selection.json"), "utf8")),
    );
    expect(selection.items).toHaveLength(5);
    for (const item of selection.items) expect(item).not.toHaveProperty("why");
    // Digest order: three Top picks, then Design (HCI research), then Tech Product Launches.
    expect(selection.items.map((item) => item.category)).toEqual([
      "css_canvas_motion_techniques",
      "css_canvas_motion_techniques",
      "ui_component_primitives",
      "hci_empirical_research",
      "consumer_tech_releases",
    ]);
  });
});

describe("dispatch render: nothing an agent wrote counts as verified", () => {
  it("forces verified false for an agent selection even if the file says otherwise", async () => {
    const fixture = makeFixture(5);
    await writeRunFile(tr.root, RUN, "pool.json", fixture.items);
    await writeRunFile(tr.root, RUN, "selection.json", {
      version: 1,
      kind: "regular",
      mode: "agent",
      outcome: "selected",
      verified: true,
      window: { from: "2026-10-05T05:13:00Z", to: "2026-10-07T05:13:00Z" },
      items: fixture.selected.map((sel) => {
        const text = fixture.written.find((w) => w.id === sel.item.id);
        return {
          id: sel.item.id,
          category: sel.category,
          score: sel.score,
          headline: text?.headline,
          summary: text?.summary,
          why: text?.why,
        };
      }),
    });
    const { ctx } = makeContext(tr.root);
    const { result } = await captureStdout(() =>
      makeRenderCommand({ coverPicker: () => COVER })([], ctx),
    );
    expect(result).toBe(0);
    const digest = parseDigestFile(
      await readFile(join(tr.root, "Digests", "2026", "10", "2026-10-07.md"), "utf8"),
    );
    expect(digest.verified).toBe(false);
  });
});
