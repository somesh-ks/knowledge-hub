import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { JudgmentsFile, parseDigestFile } from "@dispatch/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeCurateCommand } from "../src/commands/curate.js";
import { makeRenderCommand } from "../src/commands/render.js";
import { run as validate } from "../src/commands/validate.js";
import type { ApiRuntimeFactory } from "../src/curate/apiRuntime.js";
import { Selection, WrittenFile } from "../src/curate/selectionFile.js";
import { computeWindow } from "../src/curate/window.js";
import { validateDigest } from "../src/validate/validateDigest.js";
import {
  captureStdout,
  FIXED_NOW,
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
import { buildFixtureDigest, COVER, makeFixture } from "./render-factories.js";
import { testLinter } from "./write-fakes.js";

const RUN = "2026-10-07-regular";
const SECRET = "nb-secret-0123456789abcdef";
const ENV = { NEBIUS_API_KEY: SECRET, DISPATCH_MODEL: "Qwen/Qwen3-32B" };

let tr: TestRoot;
beforeEach(async () => {
  tr = await makeRoot();
});
afterEach(async () => {
  await tr.cleanup();
});

const readJson = async (...parts: string[]): Promise<unknown> =>
  JSON.parse(await readFile(join(...parts), "utf8"));
const runPath = (...parts: string[]): string => join(tr.root, ".cache", "run", RUN, ...parts);

function factoryFor(
  table: Map<string, never> | ReturnType<typeof makePool>["table"],
  options: { grounded?: boolean } = {},
): {
  factory: ApiRuntimeFactory;
  judge: TableJudge;
} {
  const judge = new TableJudge(table as ReturnType<typeof makePool>["table"]);
  return {
    judge,
    factory: () => ({
      judge,
      writer: fakeWriter(),
      grounder: options.grounded === false ? null : keywordGrounder,
      extract: async (item) => longText(item),
      judgeFailures: [],
      usage: () => ({ nebiusTokens: 1234, nebiusTokenLimit: 400_000 }),
    }),
  };
}

async function seedPool(count: number): Promise<ReturnType<typeof makePool>> {
  const pool = makePool(goodSpecs(count));
  await writeRunFile(tr.root, RUN, "pool.json", pool.items);
  return pool;
}

describe("dispatch curate: api mode", () => {
  it("writes selection, written items, judgments and a report, and prints JSON", async () => {
    const pool = await seedPool(6);
    const { factory } = factoryFor(pool.table);
    const { ctx } = makeContext(tr.root, { env: ENV });
    const { result, stdout } = await captureStdout(() =>
      makeCurateCommand(factory)(["--mode", "api"], ctx),
    );
    expect(result).toBe(0);
    const summary = JSON.parse(stdout) as Record<string, unknown>;
    expect(summary).toMatchObject({
      outcome: "selected",
      mode: "api",
      run_id: RUN,
      items: 6,
      verified: true,
    });

    const selection = Selection.parse(await readJson(runPath("selection.json")));
    expect(selection.items).toHaveLength(6);
    expect(selection.window.to).toBe(FIXED_NOW.toISOString());
    expect(WrittenFile.parse(await readJson(runPath("written.json"))).items).toHaveLength(6);
    expect(
      Object.keys(JudgmentsFile.parse(await readJson(runPath("judgments.json"))).entries),
    ).toHaveLength(6);
    const report = (await readJson(runPath("curate-report.json"))) as {
      counts: { final: number };
      usage: { nebiusTokens: number };
    };
    expect(report.counts.final).toBe(6);
    expect(report.usage.nebiusTokens).toBe(1234);
  });

  it("never writes a key or fetched text to any output file", async () => {
    const pool = await seedPool(5);
    const { factory } = factoryFor(pool.table);
    const { ctx, logs } = makeContext(tr.root, {
      env: { ...ENV, TYPESAFE_API_KEY: "tsk-secret-9876543210" },
    });
    await captureStdout(() => makeCurateCommand(factory)([], ctx));
    for (const name of await readdir(runPath())) {
      if (name === "pool.json") continue;
      const text = await readFile(runPath(name), "utf8");
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain("tsk-secret-9876543210");
      expect(text).not.toContain("Source text for");
    }
    expect(JSON.stringify(logs)).not.toContain(SECRET);
  });

  it("prints human lines when not in JSON mode", async () => {
    const pool = await seedPool(5);
    const { ctx } = makeContext(tr.root, { env: ENV, json: false });
    const { stdout } = await captureStdout(() =>
      makeCurateCommand(factoryFor(pool.table).factory)([], ctx),
    );
    expect(stdout).toContain("Selected 5 items (verified).");
  });

  it("marks the selection not verified when no grounder is wired", async () => {
    const pool = await seedPool(5);
    const { ctx } = makeContext(tr.root, { env: ENV });
    const { stdout } = await captureStdout(() =>
      makeCurateCommand(factoryFor(pool.table, { grounded: false }).factory)([], ctx),
    );
    expect(JSON.parse(stdout)).toMatchObject({ verified: false });
  });

  it("honours --run, --pool and --out", async () => {
    const pool = makePool(goodSpecs(5));
    const poolPath = await writeRunFile(tr.root, "elsewhere", "my-pool.json", {
      items: pool.items,
    });
    const { ctx } = makeContext(tr.root, { env: ENV });
    const out = join(tr.root, "custom-out");
    const { result: code } = await captureStdout(() =>
      makeCurateCommand(factoryFor(pool.table).factory)(
        ["--run", "elsewhere", "--pool", poolPath, "--out", out, "--kind", "weekly"],
        ctx,
      ),
    );
    expect(code).toBe(0);
    expect(Selection.parse(await readJson(out, "selection.json")).kind).toBe("weekly");
  });

  it("reports nothing when too few items clear the bar", async () => {
    const pool = await seedPool(2);
    const { ctx } = makeContext(tr.root, { env: ENV });
    const { result, stdout } = await captureStdout(() =>
      makeCurateCommand(factoryFor(pool.table).factory)([], ctx),
    );
    expect(result).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ outcome: "nothing", items: 0 });
    expect(Selection.parse(await readJson(runPath("selection.json"))).outcome).toBe("nothing");
  });

  it("reuses judgments from state/judgments.json", async () => {
    const pool = await seedPool(5);
    const first = factoryFor(pool.table);
    const { ctx } = makeContext(tr.root, { env: ENV });
    await captureStdout(() => makeCurateCommand(first.factory)([], ctx));
    await mkdir(join(tr.root, "state"), { recursive: true });
    await writeFile(
      join(tr.root, "state", "judgments.json"),
      await readFile(runPath("judgments.json"), "utf8"),
    );
    const second = factoryFor(pool.table);
    await captureStdout(() => makeCurateCommand(second.factory)([], ctx));
    expect(second.judge.asked).toEqual([]);
  });

  it("continues a run in the same directory without judging again", async () => {
    const pool = await seedPool(5);
    const { ctx } = makeContext(tr.root, { env: ENV });
    await captureStdout(() => makeCurateCommand(factoryFor(pool.table).factory)([], ctx));
    // No committed state/judgments.json exists, so only the run directory can supply the cache.
    const rerun = factoryFor(pool.table);
    const { result } = await captureStdout(() => makeCurateCommand(rerun.factory)([], ctx));
    expect(result).toBe(0);
    expect(rerun.judge.asked).toEqual([]);
  });

  it("ignores a corrupt judgments file in the run directory", async () => {
    const pool = await seedPool(5);
    await writeRunFile(tr.root, RUN, "judgments.json", "{ not json");
    const { ctx } = makeContext(tr.root, { env: ENV });
    const fresh = factoryFor(pool.table);
    const { result } = await captureStdout(() => makeCurateCommand(fresh.factory)([], ctx));
    expect(result).toBe(0);
    expect(fresh.judge.asked).toHaveLength(1);
  });

  it("skips malformed pool entries and still curates the rest", async () => {
    const pool = makePool(goodSpecs(5));
    await writeRunFile(tr.root, RUN, "pool.json", { items: [...pool.items, { nope: true }] });
    const { ctx, logs } = makeContext(tr.root, { env: ENV });
    const { result } = await captureStdout(() =>
      makeCurateCommand(factoryFor(pool.table).factory)([], ctx),
    );
    expect(result).toBe(0);
    expect(logs.some((l) => l.level === "warn" && l.message.includes("Skipped pool entries"))).toBe(
      true,
    );
  });
});

describe("dispatch curate: errors", () => {
  const cmd = makeCurateCommand(factoryFor(new Map()).factory);

  it.each([
    [["--bogus"]],
    [["--mode", "nope"]],
    [["--kind", "daily"]],
    [["--threshold", "5"]],
    [["--threshold", "abc"]],
    [["--since", "not-a-date"]],
    [["stray"]],
  ])("exits 2 for bad arguments %j", async (argv) => {
    const { ctx, logs } = makeContext(tr.root, { env: ENV });
    expect(await cmd(argv, ctx)).toBe(2);
    expect(
      logs.some((l) => l.level === "error" && l.message.includes("Usage: dispatch curate")),
    ).toBe(true);
  });

  it("fails clearly when NEBIUS_API_KEY is missing, without printing any value", async () => {
    await seedPool(5);
    const { ctx, logs } = makeContext(tr.root, {
      env: { TYPESAFE_API_KEY: "tsk-secret-9876543210" },
    });
    expect(await cmd([], ctx)).toBe(1);
    const text = JSON.stringify(logs);
    expect(text).toContain("NEBIUS_API_KEY is not set");
    expect(text).not.toContain("tsk-secret-9876543210");
  });

  it("fails clearly when DISPATCH_MODEL is missing, using the real runtime", async () => {
    await seedPool(5);
    const real = makeCurateCommand();
    const { ctx, logs } = makeContext(tr.root, { env: { NEBIUS_API_KEY: SECRET } });
    expect(await real([], ctx)).toBe(1);
    const text = JSON.stringify(logs);
    expect(text).toContain("DISPATCH_MODEL is not set");
    expect(text).not.toContain(SECRET);
  });

  it("fails when there is no pool anywhere", async () => {
    const { ctx, logs } = makeContext(tr.root, { env: ENV });
    expect(await cmd([], ctx)).toBe(1);
    expect(logs.some((l) => l.message.includes("No pool found under .cache/run"))).toBe(true);
  });

  it("fails when the named run has no pool file", async () => {
    const { ctx, logs } = makeContext(tr.root, { env: ENV });
    expect(await cmd(["--run", "2026-10-01"], ctx)).toBe(1);
    expect(logs.some((l) => l.message.includes("pool file does not exist"))).toBe(true);
  });

  it("fails when the pool has no valid items", async () => {
    await writeRunFile(tr.root, RUN, "pool.json", [{ nope: 1 }]);
    const { ctx, logs } = makeContext(tr.root, { env: ENV });
    expect(await cmd([], ctx)).toBe(1);
    expect(logs.some((l) => l.message.includes("no valid items"))).toBe(true);
  });

  it("refuses a run id that could escape the cache", async () => {
    const { ctx, logs } = makeContext(tr.root, { env: ENV });
    expect(await cmd(["--run", "../escape"], ctx)).toBe(1);
    expect(logs.some((l) => l.message.includes("Invalid run id"))).toBe(true);
  });
});

/** A summary in the four-beat voice: three sentences, 34 words. */
const AGENT_SUMMARY =
  "Springlet swaps the rest target without resetting velocity. Interrupted drawers keep their speed, and the change is about 120 lines of plain JavaScript. A fixed timestep keeps the motion the same on slow phones.";
const AGENT_WHY = "Copy the retargeting pattern for drawers and toasts";

describe("dispatch curate: agent mode", () => {
  const agent = makeCurateCommand();

  it("writes the JSON Schema and waits for a selection", async () => {
    await seedPool(5);
    const { ctx } = makeContext(tr.root);
    const { result, stdout } = await captureStdout(() => agent(["--mode", "agent"], ctx));
    expect(result).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ status: "awaiting_selection", mode: "agent" });
    const schema = (await readJson(runPath("selection-schema.json"))) as {
      properties: {
        items: {
          minItems: number;
          maxItems: number;
          items: { required: string[]; properties: Record<string, unknown> };
        };
      };
      required: string[];
    };
    expect(schema.required).toContain("items");
    expect(schema.properties.items.minItems).toBe(3);
    // The weekly cap of 18 plus the tech allowance of 5; the command checks each pool for the kind.
    expect(schema.properties.items.maxItems).toBe(48);
    // The four beats live in the summary, so a session may leave the why line out.
    expect(schema.properties.items.items.required).toEqual([
      "id",
      "category",
      "score",
      "headline",
      "summary",
    ]);
    expect(Object.keys(schema.properties.items.items.properties)).toContain("why");
  });

  const agentItems = (pool: ReturnType<typeof makePool>, count = 4) =>
    pool.items.slice(0, count).map((item, i) => ({
      id: item.id,
      category: i % 2 === 0 ? "design_engineering_craft" : "frontier_model_releases",
      score: 0.9 - i * 0.05,
      headline: `Springlet ${i} retargets springs mid-flight`,
      summary: AGENT_SUMMARY,
      // The why line is optional in agent mode: every other item carries one.
      ...(i % 2 === 0 ? { why: AGENT_WHY } : {}),
    }));

  it("validates a session's selection, normalizes it and marks it unverified", async () => {
    const pool = await seedPool(5);
    await writeRunFile(tr.root, RUN, "selection.json", { version: 1, items: agentItems(pool) });
    const { ctx } = makeContext(tr.root);
    const { result, stdout } = await captureStdout(() => agent(["--mode", "agent"], ctx));
    expect(result).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ status: "validated", verified: false, items: 4 });
    const selection = Selection.parse(await readJson(runPath("selection.json")));
    expect(selection).toMatchObject({
      mode: "agent",
      verified: false,
      outcome: "selected",
      kind: "regular",
    });
    expect(selection.items.map((i) => i.score)).toEqual(
      [...selection.items.map((i) => i.score)].sort((a, b) => b - a),
    );
    expect(
      WrittenFile.parse(await readJson(runPath("written.json"))).items.every((i) => !i.verified),
    ).toBe(true);
  });

  it("keeps a why line the session supplied and adds none where it did not", async () => {
    const pool = await seedPool(5);
    const sent = agentItems(pool);
    await writeRunFile(tr.root, RUN, "selection.json", { version: 1, items: sent });
    const { ctx } = makeContext(tr.root);
    expect((await captureStdout(() => agent(["--mode", "agent"], ctx))).result).toBe(0);
    for (const file of ["selection.json", "written.json"]) {
      const { items } = (await readJson(runPath(file))) as {
        items: Array<{ id: string; why?: string }>;
      };
      const byId = new Map(items.map((item) => [item.id, item]));
      expect(byId.get(sent[0]?.id as string)?.why, file).toBe(AGENT_WHY);
      expect(byId.get(sent[1]?.id as string), file).not.toHaveProperty("why");
      expect(byId.get(sent[2]?.id as string)?.why, file).toBe(AGENT_WHY);
      expect(byId.get(sent[3]?.id as string), file).not.toHaveProperty("why");
    }
  });

  it("holds a session's summary to the four-beat limits, why line or not", async () => {
    const pool = await seedPool(5);
    const items = agentItems(pool);
    const short = "Springlet swaps the rest target without resetting velocity.";
    items[0] = { ...items[0], summary: short } as (typeof items)[number];
    items[1] = { ...items[1], summary: short } as (typeof items)[number];
    await writeRunFile(tr.root, RUN, "selection.json", { version: 1, items });
    const { ctx } = makeContext(tr.root);
    const { result, stdout } = await captureStdout(() => agent(["--mode", "agent"], ctx));
    expect(result).toBe(1);
    const body = JSON.parse(stdout) as { issues: Array<{ id?: string; message: string }> };
    for (const item of items.slice(0, 2)) {
      expect(body.issues.filter((i) => i.id === item?.id).map((i) => i.message)).toEqual([
        "summary: The summary has 8 words; it needs at least 25.",
        "summary: The summary has 1 sentence; it needs at least 2.",
      ]);
    }
  });

  it("rejects ids outside the pool, banned vocabulary and never-publish categories, and leaves the file alone", async () => {
    const pool = await seedPool(5);
    const items = agentItems(pool);
    items[0] = { ...items[0], id: "ffffffffffff" } as (typeof items)[number];
    items[1] = { ...items[1], headline: "An incredible release!" } as (typeof items)[number];
    items[2] = { ...items[2], category: "venture_capital_and_gossip" } as (typeof items)[number];
    const path = await writeRunFile(tr.root, RUN, "selection.json", { version: 1, items });
    const before = await readFile(path, "utf8");
    const { ctx } = makeContext(tr.root);
    const { result, stdout } = await captureStdout(() => agent(["--mode", "agent"], ctx));
    expect(result).toBe(1);
    const body = JSON.parse(stdout) as { status: string; issues: Array<{ message: string }> };
    expect(body.status).toBe("invalid");
    const messages = body.issues.map((i) => i.message).join("\n");
    expect(messages).toContain("not in the pool");
    expect(messages).toContain("incredible");
    expect(messages).toContain("never publishes");
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("accepts tech stories on top of the cap and keeps them out of the Top picks", async () => {
    const pool = await seedPool(15);
    const items = agentItems(pool, 15).map((item, i) =>
      // Twelve craft items, then three tech stories that outscore all of them.
      i < 12
        ? { ...item, category: "design_engineering_craft", score: 0.8 - i * 0.01 }
        : { ...item, category: "consumer_tech_releases", score: 0.99 - (i - 12) * 0.01 },
    );
    await writeRunFile(tr.root, RUN, "selection.json", { version: 1, items });
    const { ctx } = makeContext(tr.root);
    const { result, stdout } = await captureStdout(() => agent(["--mode", "agent"], ctx));
    expect(result).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ status: "validated", items: 15 });
    const selection = Selection.parse(await readJson(runPath("selection.json")));
    // Digest order: the three picks, the nine other craft items, then tech.
    expect(selection.items.map((i) => i.category)).toEqual([
      ...Array.from({ length: 12 }, () => "design_engineering_craft"),
      ...Array.from({ length: 3 }, () => "consumer_tech_releases"),
    ]);
    expect(selection.items.slice(0, 3).map((i) => i.score)).toEqual([0.8, 0.79, 0.78]);
  });

  it("holds a session to five tech stories and to the cap for everything else", async () => {
    const pool = await seedPool(19);
    const all = agentItems(pool, 19);
    const sixTech = all
      .slice(0, 9)
      .map((item, i) => (i < 3 ? item : { ...item, category: "consumer_tech_releases" }));
    await writeRunFile(tr.root, RUN, "selection.json", { version: 1, items: sixTech });
    const { ctx } = makeContext(tr.root);
    const tooMuchTech = await captureStdout(() => agent(["--mode", "agent"], ctx));
    expect(tooMuchTech.result).toBe(1);
    expect(
      (JSON.parse(tooMuchTech.stdout) as { issues: Array<{ message: string }> }).issues.map(
        (i) => i.message,
      ),
    ).toEqual(["6 Tech releases items; the limit is 5."]);

    // Thirteen items outside tech do not fit a regular digest, whatever the tech allowance.
    const thirteen = all
      .slice(0, 15)
      .map((item, i) => (i < 13 ? item : { ...item, category: "consumer_tech_releases" }));
    await writeRunFile(tr.root, RUN, "selection.json", { version: 1, items: thirteen });
    const overCap = await captureStdout(() => agent(["--mode", "agent"], ctx));
    expect(overCap.result).toBe(1);
    expect(
      (JSON.parse(overCap.stdout) as { issues: Array<{ message: string }> }).issues.map(
        (i) => i.message,
      ),
    ).toEqual(["13 items outside Tech releases; the limit for a regular digest is 12."]);
  });

  it("rejects duplicates and wrong-shaped files", async () => {
    const pool = await seedPool(5);
    const items = agentItems(pool);
    items[1] = { ...items[0] } as (typeof items)[number];
    await writeRunFile(tr.root, RUN, "selection.json", { version: 1, items });
    const { ctx } = makeContext(tr.root);
    const first = await captureStdout(() => agent(["--mode", "agent"], ctx));
    expect(first.result).toBe(1);
    expect(first.stdout).toContain("appears twice");

    await writeRunFile(tr.root, RUN, "selection.json", { version: 2, items: [] });
    const second = await captureStdout(() => agent(["--mode", "agent"], ctx));
    expect(second.result).toBe(1);
    expect(second.stdout).toContain("version");
  });
});

describe("computeWindow", () => {
  const now = new Date("2026-10-07T05:13:00Z");

  it("takes 3 days on a first run", () => {
    expect(computeWindow({ now })).toEqual({
      from: "2026-10-04T05:13:00.000Z",
      to: "2026-10-07T05:13:00.000Z",
    });
  });

  it("continues from the last fetch", () => {
    expect(computeWindow({ now, lastFetchAt: "2026-10-05T05:13:00Z" }).from).toBe(
      "2026-10-05T05:13:00.000Z",
    );
  });

  it("prefers --since over the last fetch", () => {
    expect(
      computeWindow({ now, since: "2026-10-06T00:00:00Z", lastFetchAt: "2026-10-05T05:13:00Z" })
        .from,
    ).toBe("2026-10-06T00:00:00.000Z");
  });

  it("never reaches back more than 7 days or forward past now", () => {
    expect(computeWindow({ now, lastFetchAt: "2026-09-01T00:00:00Z" }).from).toBe(
      "2026-09-30T05:13:00.000Z",
    );
    expect(computeWindow({ now, since: "2026-12-01T00:00:00Z" }).from).toBe(now.toISOString());
  });

  it("falls back to 3 days for an unreadable date", () => {
    expect(computeWindow({ now, lastFetchAt: "garbage" }).from).toBe("2026-10-04T05:13:00.000Z");
  });
});

/** selection.json and pool.json for a fixture that renders cleanly. */
async function seedRender(count = 6): Promise<ReturnType<typeof makeFixture>> {
  const fixture = makeFixture(count);
  await writeRunFile(tr.root, RUN, "pool.json", fixture.items);
  const items = fixture.selected.map((sel) => {
    const text = fixture.written.find((w) => w.id === sel.item.id);
    return {
      id: sel.item.id,
      category: sel.category,
      score: sel.score,
      headline: text?.headline,
      summary: text?.summary,
      why: text?.why,
    };
  });
  await writeRunFile(tr.root, RUN, "selection.json", {
    version: 1,
    kind: "regular",
    mode: "api",
    outcome: "selected",
    verified: true,
    window: { from: "2026-10-05T05:13:00Z", to: "2026-10-07T05:13:00Z" },
    items,
  });
  return fixture;
}

describe("dispatch render", () => {
  const render = makeRenderCommand({ coverPicker: () => COVER });

  it("writes a valid digest file from a selection", async () => {
    await seedRender(6);
    const { ctx } = makeContext(tr.root);
    const { result, stdout } = await captureStdout(() => render([], ctx));
    expect(result).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      outcome: "rendered",
      digest_id: "2026-10-07",
      path: "Digests/2026/10/2026-10-07.md",
      items: 6,
      verified: true,
    });
    const digest = parseDigestFile(
      await readFile(join(tr.root, "Digests", "2026", "10", "2026-10-07.md"), "utf8"),
    );
    expect(digest.cover).toEqual(COVER);
    expect(digest.items.filter((i) => i.section === "top")).toHaveLength(3);
    expect(digest.audio).toBeNull();
    expect(validateDigest(digest, { linter: testLinter() }).ok).toBe(true);
  });

  it("never overwrites: a second render takes the next free id", async () => {
    await seedRender(5);
    const { ctx } = makeContext(tr.root);
    await captureStdout(() => render([], ctx));
    const { stdout } = await captureStdout(() => render([], ctx));
    expect(JSON.parse(stdout)).toMatchObject({ digest_id: "2026-10-07-2" });
    expect((await readdir(join(tr.root, "Digests", "2026", "10"))).sort()).toEqual([
      "2026-10-07-2.md",
      "2026-10-07.md",
    ]);
  });

  it("writes nothing on --dry-run", async () => {
    await seedRender(5);
    const { ctx } = makeContext(tr.root);
    const { result, stdout } = await captureStdout(() => render(["--dry-run"], ctx));
    expect(result).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ outcome: "dry-run" });
    await expect(stat(join(tr.root, "Digests"))).rejects.toThrow();
  });

  it("renders nothing for a nothing outcome", async () => {
    await writeRunFile(tr.root, RUN, "selection.json", {
      version: 1,
      kind: "regular",
      mode: "api",
      outcome: "nothing",
      verified: false,
      window: { from: "2026-10-05T05:13:00Z", to: "2026-10-07T05:13:00Z" },
      items: [],
    });
    const { ctx } = makeContext(tr.root);
    const { result, stdout } = await captureStdout(() => render([], ctx));
    expect(result).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ outcome: "nothing" });
    await expect(stat(join(tr.root, "Digests"))).rejects.toThrow();
  });

  it("fails clearly when there is no selection or the pool lacks an id", async () => {
    const { ctx, logs } = makeContext(tr.root);
    expect(await render([], ctx)).toBe(1);
    expect(logs.some((l) => l.message.includes("No selection found under .cache/run"))).toBe(true);
    expect(await render(["--run", "2026-10-01"], ctx)).toBe(1);
    expect(logs.some((l) => l.message.includes("selection.json not found"))).toBe(true);

    const fixture = await seedRender(5);
    await writeRunFile(tr.root, RUN, "pool.json", fixture.items.slice(1));
    expect(await render([], ctx)).toBe(1);
    expect(logs.some((l) => l.message.includes("not in the pool"))).toBe(true);
  });

  it("refuses to write a digest that fails validation", async () => {
    await seedRender(5);
    const path = runPath("selection.json");
    const selection = JSON.parse(await readFile(path, "utf8")) as {
      items: Array<{ headline: string }>;
    };
    (selection.items[0] as { headline: string }).headline = "An incredible release!";
    await writeFile(path, JSON.stringify(selection));
    const { ctx } = makeContext(tr.root);
    const { result, stdout } = await captureStdout(() => render([], ctx));
    expect(result).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({ outcome: "invalid" });
    await expect(stat(join(tr.root, "Digests"))).rejects.toThrow();
  });

  it("exits 2 for bad arguments", async () => {
    const { ctx } = makeContext(tr.root);
    expect(await render(["--bogus"], ctx)).toBe(2);
    expect(await render(["stray"], ctx)).toBe(2);
  });

  it("uses the fallback cover picker when none is injected", async () => {
    await seedRender(5);
    const { ctx } = makeContext(tr.root);
    await captureStdout(() => makeRenderCommand()([], ctx));
    const digest = parseDigestFile(
      await readFile(join(tr.root, "Digests", "2026", "10", "2026-10-07.md"), "utf8"),
    );
    expect(digest.cover.palette).toBe("dusk");
  });
});

describe("dispatch validate", () => {
  const writeDigest = async (name: string, mutate?: (text: string) => string): Promise<string> => {
    const { digest } = buildFixtureDigest(6);
    const { serializeDigestFile } = await import("@dispatch/core");
    const path = join(tr.root, name);
    const text = serializeDigestFile(digest);
    await writeFile(path, mutate ? mutate(text) : text);
    return name;
  };

  it("accepts a valid digest file", async () => {
    const file = await writeDigest("good.md");
    const { ctx } = makeContext(tr.root);
    const { result, stdout } = await captureStdout(() => validate([file], ctx));
    expect(result).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, errors: 0 });
  });

  it("lists every problem and exits 1 for a digest that breaks the voice", async () => {
    const file = await writeDigest("bad.md", (text) =>
      text.replace("retargets springs mid-flight", "is an incredible release!"),
    );
    const { ctx } = makeContext(tr.root);
    const { result, stdout } = await captureStdout(() => validate([file], ctx));
    expect(result).toBe(1);
    const report = JSON.parse(stdout) as { ok: boolean; issues: Array<{ code: string }> };
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.code === "voice")).toBe(true);
  });

  it("checks URLs against a pool when given one", async () => {
    const { fixture } = buildFixtureDigest(6);
    const file = await writeDigest("pooled.md");
    const { ctx } = makeContext(tr.root);
    await writeFile(join(tr.root, "pool.json"), JSON.stringify(fixture.items));
    expect((await captureStdout(() => validate([file, "--pool", "pool.json"], ctx))).result).toBe(
      0,
    );
    await writeFile(join(tr.root, "pool.json"), JSON.stringify(fixture.items.slice(2)));
    const missing = await captureStdout(() => validate([file, "--pool", "pool.json"], ctx));
    expect(missing.result).toBe(1);
    expect(missing.stdout).toContain("url_not_in_pool");
  });

  it("fails clearly for a missing file or one that is not a digest", async () => {
    const { ctx, logs } = makeContext(tr.root);
    expect(await validate(["nope.md"], ctx)).toBe(1);
    expect(logs.some((l) => l.message.includes("Could not read the digest file"))).toBe(true);
    await writeFile(join(tr.root, "plain.md"), "# Just a note\n");
    expect(await validate(["plain.md"], ctx)).toBe(1);
    expect(logs.some((l) => l.message.includes("not a valid digest file"))).toBe(true);
  });

  it("exits 2 without exactly one path", async () => {
    const { ctx } = makeContext(tr.root);
    expect(await validate([], ctx)).toBe(2);
    expect(await validate(["a.md", "b.md"], ctx)).toBe(2);
    expect(await validate(["a.md", "--wat"], ctx)).toBe(2);
  });
});
