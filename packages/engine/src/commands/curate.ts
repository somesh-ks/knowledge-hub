import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { DigestKind, JudgmentsFile, requireKey } from "@dispatch/core";
import { type CommandContext, type CommandRun, secretsFromEnv } from "../context.js";
import { validateAgentSelection } from "../curate/agentMode.js";
import { type ApiRuntimeFactory, createApiRuntime } from "../curate/apiRuntime.js";
import {
  loadJudgments,
  loadLastRun,
  loadPool,
  loadPreferences,
  loadSources,
  readJsonIfExists,
  sourceNameMap,
} from "../curate/inputs.js";
import { emit, writeJson } from "../curate/output.js";
import { curatePool } from "../curate/pipeline.js";
import { fromRoot, resolveRunLocation } from "../curate/runDir.js";
import { agentSelectionJsonSchema, type WrittenFile } from "../curate/selectionFile.js";
import { resolveWindow } from "../curate/window.js";
import { mergeJudgments, pruneJudgments } from "../judge/cache.js";
import { describeError } from "../llm/errors.js";
import { loadTopicsFile } from "../topics/store.js";
import { createLinter } from "../voice/lint.js";
import { loadVoice } from "../voice/voice.js";
import { writtenText } from "../write/text.js";

export const CURATE_USAGE =
  "Usage: dispatch curate [--mode api|agent] [--kind regular|weekly|on-demand] [--pool <path>] [--out <dir>] [--run <id>] [--since <iso>] [--threshold <0-1>]";

interface Flags {
  mode: "api" | "agent" | undefined;
  /** Undefined means: use the pool's kind, else regular. */
  kind: DigestKind | undefined;
  pool: string | undefined;
  out: string | undefined;
  run: string | undefined;
  since: string | undefined;
  threshold: number | undefined;
}

class UsageError extends Error {}

function parseFlags(argv: string[]): Flags {
  let values: Record<string, string | undefined>;
  try {
    values = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        mode: { type: "string" },
        kind: { type: "string" },
        pool: { type: "string" },
        out: { type: "string" },
        run: { type: "string" },
        since: { type: "string" },
        threshold: { type: "string" },
      },
    }).values;
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : "Invalid arguments.");
  }
  if (values.mode !== undefined && values.mode !== "api" && values.mode !== "agent") {
    throw new UsageError(`--mode must be api or agent, not "${values.mode}".`);
  }
  const kind = values.kind === undefined ? undefined : DigestKind.safeParse(values.kind);
  if (kind && !kind.success) throw new UsageError("--kind must be regular, weekly or on-demand.");
  let threshold: number | undefined;
  if (values.threshold !== undefined) {
    threshold = Number(values.threshold);
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
      throw new UsageError("--threshold must be a number above 0 and at most 1.");
    }
  }
  if (values.since !== undefined && Number.isNaN(Date.parse(values.since))) {
    throw new UsageError("--since must be an ISO date or date-time.");
  }
  return {
    mode: values.mode as "api" | "agent" | undefined,
    kind: kind?.success ? kind.data : undefined,
    pool: values.pool,
    out: values.out,
    run: values.run,
    since: values.since,
    threshold,
  };
}

/**
 * `dispatch curate`. API mode judges, scores, selects, extracts, writes and validates through the
 * model clients and writes `selection.json`, `written.json`, `judgments.json` and
 * `curate-report.json` under `.cache/run/<id>/`. Agent mode writes `selection-schema.json`, then
 * validates the `selection.json` a Claude Code session provides and marks it unverified.
 * Exit codes: 0 done (including "nothing cleared the bar"), 1 failure, 2 usage error.
 */
export function makeCurateCommand(createRuntime: ApiRuntimeFactory = createApiRuntime): CommandRun {
  return async (argv, ctx) => {
    let flags: Flags;
    try {
      flags = parseFlags(argv);
    } catch (error) {
      ctx.log.error(`${(error as Error).message} ${CURATE_USAGE}`);
      return 2;
    }
    try {
      const mode = flags.mode ?? "api";
      return mode === "agent"
        ? await runAgent(ctx, flags)
        : await runApi(ctx, flags, createRuntime);
    } catch (error) {
      ctx.log.error(`curate failed: ${describeError(error, secretsFromEnv(ctx.env))}`);
      return 1;
    }
  };
}

interface Paths {
  runDir: string;
  outDir: string;
  poolPath: string;
}

/**
 * Where the run lives: `--pool` names the pool and its folder is the run directory, `--run`
 * names `.cache/run/<id>`, and with neither the newest run that has a pool is used. Outputs go
 * to `--out` when given, otherwise next to the pool.
 */
async function resolvePaths(ctx: CommandContext, flags: Flags): Promise<Paths> {
  const location = await resolveRunLocation(ctx.root, { run: flags.run, pool: flags.pool });
  return {
    runDir: location.runDir,
    outDir: flags.out ? fromRoot(ctx.root, flags.out) : location.runDir,
    poolPath: location.poolPath,
  };
}

/**
 * A re-run in the same run directory continues instead of judging again: judgments saved by the
 * earlier attempt are merged over the committed cache. An unreadable file is ignored.
 */
async function withRunJudgments(state: JudgmentsFile, path: string): Promise<JudgmentsFile> {
  try {
    const parsed = JudgmentsFile.safeParse(await readJsonIfExists(path, "judgments.json"));
    return parsed.success ? mergeJudgments(state, Object.values(parsed.data.entries)) : state;
  } catch {
    return state;
  }
}

async function runApi(
  ctx: CommandContext,
  flags: Flags,
  createRuntime: ApiRuntimeFactory,
): Promise<number> {
  const { root, log } = ctx;
  // Fail before any work when a required key is missing.
  requireKey(ctx.env, "NEBIUS_API_KEY");
  const paths = await resolvePaths(ctx, flags);
  const voice = await loadVoice(root);
  const linter = createLinter(voice);
  const pool = await loadPool(paths.poolPath);
  const kind = flags.kind ?? pool.meta.kind ?? "regular";
  const runId = pool.meta.id ?? basename(paths.runDir);
  if (pool.invalid > 0)
    log.warn("Skipped pool entries that did not match the item schema", { skipped: pool.invalid });
  // An empty pool is a quiet day. A pool whose entries were all malformed is a broken fetch.
  if (pool.items.length === 0 && pool.invalid > 0) throw new Error("The pool has no valid items.");

  const [preferences, sources, stateJudgments, lastRun] = await Promise.all([
    loadPreferences(root),
    loadSources(root),
    loadJudgments(root),
    loadLastRun(root),
  ]);
  const judgments = await withRunJudgments(stateJudgments, join(paths.outDir, "judgments.json"));
  const now = ctx.now();
  const window = resolveWindow({
    now,
    since: flags.since,
    poolWindow: pool.meta.window,
    lastFetchAt: lastRun.last_fetch_at,
  });
  const runtime = createRuntime(ctx, voice);

  const result = await curatePool(
    {
      judge: runtime.judge,
      writer: runtime.writer,
      grounder: runtime.grounder,
      linter,
      extract: runtime.extract,
      log,
      now: ctx.now,
    },
    {
      pool: pool.items,
      preferences,
      judgments,
      kind,
      window,
      sourceNames: sourceNameMap(sources),
      threshold: flags.threshold,
    },
  );

  // A failed run writes no selection: a stale or empty one could be rendered as a quiet day.
  if (result.selection !== null) {
    await writeJson(join(paths.outDir, "selection.json"), result.selection);
  }
  await writeJson(join(paths.outDir, "written.json"), result.written);
  await writeJson(join(paths.outDir, "judgments.json"), pruneJudgments(result.judgments, now));
  const usage = runtime.usage();
  await writeJson(join(paths.outDir, "curate-report.json"), {
    version: 1,
    run_id: runId,
    mode: "api",
    kind,
    outcome: result.outcome,
    ...(result.failure ? { failure: result.failure } : {}),
    at: now.toISOString(),
    counts: result.counts,
    judge: {
      name: runtime.judge.name,
      model: runtime.judge.model,
      questions_hash: runtime.judge.questionsHash,
    },
    judge_failures: runtime.judgeFailures,
    usage,
    top_scores: result.scoredTop,
  });

  if (result.outcome === "failed" || result.selection === null) {
    const reason = result.failure ?? "Curation failed.";
    ctx.log.error(`curate failed: ${reason}`);
    emit(ctx, [`Failed: ${reason}`], {
      outcome: "failed",
      mode: "api",
      run_id: runId,
      reason,
      out: paths.outDir,
      counts: result.counts,
      usage,
    });
    return 1;
  }

  const summary = {
    outcome: result.outcome,
    mode: "api",
    run_id: runId,
    items: result.selection.items.length,
    verified: result.selection.verified,
    out: paths.outDir,
    counts: result.counts,
    usage,
  };
  emit(
    ctx,
    result.outcome === "nothing"
      ? ["Nothing cleared the bar.", `Wrote ${join(paths.outDir, "selection.json")}`]
      : [
          `Selected ${summary.items} items${summary.verified ? " (verified)" : " (not verified)"}.`,
          `Wrote ${join(paths.outDir, "selection.json")}`,
        ],
    summary,
  );
  return 0;
}

async function runAgent(ctx: CommandContext, flags: Flags): Promise<number> {
  const { root } = ctx;
  const paths = await resolvePaths(ctx, flags);
  const voice = await loadVoice(root);
  const pool = await loadPool(paths.poolPath);
  const kind = flags.kind ?? pool.meta.kind ?? "regular";
  const schemaPath = join(paths.outDir, "selection-schema.json");
  await writeJson(schemaPath, agentSelectionJsonSchema());

  // The session writes agent-selection.json, so selection.json is only ever written by this
  // engine, after validation. A selection.json left by an older run is still accepted as input.
  const selectionPath = join(paths.outDir, "selection.json");
  const agentPath = join(paths.outDir, "agent-selection.json");
  const raw =
    (await readJsonIfExists(agentPath, "agent-selection.json")) ??
    (await readJsonIfExists(selectionPath, "selection.json"));
  if (raw === null) {
    emit(
      ctx,
      [
        `Wrote ${schemaPath}.`,
        `Write ${agentPath} to match it, using only items from ${paths.poolPath}, then run this command again. The engine writes ${selectionPath} after it validates the file.`,
      ],
      {
        status: "awaiting_selection",
        mode: "agent",
        schema: schemaPath,
        input: agentPath,
        selection: selectionPath,
        pool: paths.poolPath,
      },
    );
    return 0;
  }

  const lastRun = await loadLastRun(root);
  const window = resolveWindow({
    now: ctx.now(),
    since: flags.since,
    poolWindow: pool.meta.window,
    lastFetchAt: lastRun.last_fetch_at,
  });
  const checked = validateAgentSelection(raw, {
    pool: pool.items,
    linter: createLinter(voice),
    kind,
    window,
    topics: await loadTopicsFile(root),
  });
  if (!checked.ok) {
    ctx.log.error(`selection.json has ${checked.issues.length} problems`);
    emit(
      ctx,
      checked.issues.map((issue) => `- ${issue.id ? `${issue.id}: ` : ""}${issue.message}`),
      { status: "invalid", mode: "agent", issues: checked.issues },
    );
    return 1;
  }

  const written: WrittenFile = {
    version: 1,
    items: checked.selection.items.map((item) => ({
      id: item.id,
      ...writtenText(item),
      rewritten_fields: [],
      verified: false,
      grounding: [],
    })),
    dropped: [],
  };
  await writeJson(selectionPath, checked.selection);
  await writeJson(join(paths.outDir, "written.json"), written);
  emit(
    ctx,
    [
      `Validated ${checked.selection.items.length} items. Marked unverified: no grounding check ran in agent mode.`,
    ],
    {
      status: "validated",
      mode: "agent",
      outcome: "selected",
      items: checked.selection.items.length,
      verified: false,
      out: paths.outDir,
    },
  );
  return 0;
}

export const run: CommandRun = makeCurateCommand();
