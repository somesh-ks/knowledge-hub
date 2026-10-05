import { join } from "node:path";
import { parseArgs } from "node:util";
import { DigestKind, requireKey } from "@dispatch/core";
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
import { defaultRunId, fromRoot, runDirFor } from "../curate/runDir.js";
import { agentSelectionJsonSchema, type WrittenFile } from "../curate/selectionFile.js";
import { computeWindow } from "../curate/window.js";
import { pruneJudgments } from "../judge/cache.js";
import { describeError } from "../llm/errors.js";
import { createLinter } from "../voice/lint.js";
import { loadVoice } from "../voice/voice.js";

export const CURATE_USAGE =
  "Usage: dispatch curate [--mode api|agent] [--kind regular|weekly|on-demand] [--pool <path>] [--out <dir>] [--run <id>] [--since <iso>] [--threshold <0-1>]";

interface Flags {
  mode: "api" | "agent" | undefined;
  kind: DigestKind;
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
  const kind = DigestKind.safeParse(values.kind ?? "regular");
  if (!kind.success) throw new UsageError("--kind must be regular, weekly or on-demand.");
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
    kind: kind.data,
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
  runId: string;
  outDir: string;
  poolPath: string;
}

function resolvePaths(ctx: CommandContext, flags: Flags): Paths {
  const runId = flags.run ?? defaultRunId(ctx.now(), flags.kind);
  const runDir = runDirFor(ctx.root, runId);
  return {
    runId,
    outDir: flags.out ? fromRoot(ctx.root, flags.out) : runDir,
    poolPath: flags.pool ? fromRoot(ctx.root, flags.pool) : join(runDir, "pool.json"),
  };
}

async function runApi(
  ctx: CommandContext,
  flags: Flags,
  createRuntime: ApiRuntimeFactory,
): Promise<number> {
  const { root, log } = ctx;
  // Fail before any work when a required key is missing.
  requireKey(ctx.env, "NEBIUS_API_KEY");
  const paths = resolvePaths(ctx, flags);
  const voice = await loadVoice(root);
  const linter = createLinter(voice);
  const pool = await loadPool(paths.poolPath);
  if (pool.invalid > 0)
    log.warn("Skipped pool entries that did not match the item schema", { skipped: pool.invalid });
  if (pool.items.length === 0) throw new Error("The pool has no valid items.");

  const [preferences, sources, judgments, lastRun] = await Promise.all([
    loadPreferences(root),
    loadSources(root),
    loadJudgments(root),
    loadLastRun(root),
  ]);
  const now = ctx.now();
  const window = computeWindow({ now, since: flags.since, lastFetchAt: lastRun.last_fetch_at });
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
      kind: flags.kind,
      window,
      sourceNames: sourceNameMap(sources),
      threshold: flags.threshold,
    },
  );

  await writeJson(join(paths.outDir, "selection.json"), result.selection);
  await writeJson(join(paths.outDir, "written.json"), result.written);
  await writeJson(join(paths.outDir, "judgments.json"), pruneJudgments(result.judgments, now));
  const usage = runtime.usage();
  await writeJson(join(paths.outDir, "curate-report.json"), {
    version: 1,
    run_id: paths.runId,
    mode: "api",
    kind: flags.kind,
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

  const summary = {
    outcome: result.outcome,
    mode: "api",
    run_id: paths.runId,
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
  const paths = resolvePaths(ctx, flags);
  const voice = await loadVoice(root);
  const schemaPath = join(paths.outDir, "selection-schema.json");
  await writeJson(schemaPath, agentSelectionJsonSchema());

  const selectionPath = join(paths.outDir, "selection.json");
  const raw = await readJsonIfExists(selectionPath, "selection.json");
  if (raw === null) {
    emit(
      ctx,
      [
        `Wrote ${schemaPath}.`,
        `Write ${selectionPath} to match it, using only items from ${paths.poolPath}, then run this command again.`,
      ],
      {
        status: "awaiting_selection",
        mode: "agent",
        schema: schemaPath,
        selection: selectionPath,
        pool: paths.poolPath,
      },
    );
    return 0;
  }

  const [pool, lastRun] = await Promise.all([loadPool(paths.poolPath), loadLastRun(root)]);
  const window = computeWindow({
    now: ctx.now(),
    since: flags.since,
    lastFetchAt: lastRun.last_fetch_at,
  });
  const checked = validateAgentSelection(raw, {
    pool: pool.items,
    linter: createLinter(voice),
    kind: flags.kind,
    window,
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
      headline: item.headline,
      summary: item.summary,
      why: item.why,
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
