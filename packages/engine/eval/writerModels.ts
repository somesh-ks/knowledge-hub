#!/usr/bin/env tsx
/**
 * Writer model experiment: the same frozen stories written by each model arm, then rated by Jev.
 * It runs on demand with real keys, from run.yml's `writer_experiment` input, and never in CI or unit tests.
 *
 *   npx tsx packages/engine/eval/writerModels.ts --materials <materials.json> [--limit 12]
 *       [--arms sonnet-high,sonnet-medium,sonnet-low,haiku-medium,gemini-flash] [--out <dir>]
 *
 * Needs ANTHROPIC_API_KEY, GEMINI_API_KEY and TYPESAFE_API_KEY. An arm whose key is missing is
 * skipped and named in the report.
 *
 * What it measures, per arm: the writer's first pass only (the voice rewrite loop is left out so
 * the model alone is compared).
 *   - voice: stories whose headline, summary or spoken text break the house linter.
 *   - faithful: Jev's grounding score per sentence of summary and spoken text (the same check the
 *     validate stage runs), and the share of stories where every sentence clears the threshold.
 *   - clear, tight, worth: three Jev Noul questions about the written story alone.
 *   - cost: live token prices, per story and per story that passed lint and grounding.
 * It also writes blind.md: every arm's telling of each story under a shuffled letter, so the owner
 * can read without knowing the model. The key is in results.json. The repository is public (D298):
 * the workflow prints only the score table and keeps these files on the runner.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  type ChainEntry,
  type Env,
  findPrice,
  loadEnv,
  loadModelRouting,
  type ModelRouting,
  repoRoot,
} from "@singularity/core";
import { noul } from "@typesafe-ai/sdk";
import { z } from "zod";
import { type Logger, secretsFromEnv } from "../src/context.js";
import { loadPrices } from "../src/cost/ledger.js";
import { DEFAULT_JEV_MODEL, type JevClientLike } from "../src/judge/jev.js";
import { createJevClient } from "../src/judge/jevClient.js";
import { mapConcurrent } from "../src/llm/concurrency.js";
import { describeError } from "../src/llm/errors.js";
import { resolveFamilies } from "../src/llm/modelResolver.js";
import { createModelRouter } from "../src/llm/modelRouter.js";
import { TokenBudget } from "../src/llm/tokenBudget.js";
import { MaterialsFile } from "../src/run/artifacts.js";
import { DEFAULT_GROUNDING_THRESHOLD, JevGrounder } from "../src/validate/grounding.js";
import { createLinter } from "../src/voice/lint.js";
import { loadVoice } from "../src/voice/voice.js";
import { LlmWriter } from "../src/write/llmWriter.js";
import type { SourceMaterial, WrittenItem } from "../src/write/types.js";

interface Arm {
  id: string;
  label: string;
  family: ChainEntry["family"];
  effort?: ChainEntry["effort"];
}

/** The arms the owner asked for (Sonnet, Haiku and Gemini Flash at medium), plus Sonnet's two other levels as the cost lever. */
export const ARMS: readonly Arm[] = [
  {
    id: "sonnet-high",
    label: "Sonnet 5.5, effort high (today's default)",
    family: "claude-sonnet",
    effort: "high",
  },
  {
    id: "sonnet-medium",
    label: "Sonnet 5.5, effort medium",
    family: "claude-sonnet",
    effort: "medium",
  },
  { id: "sonnet-low", label: "Sonnet 5.5, effort low", family: "claude-sonnet", effort: "low" },
  {
    id: "haiku-medium",
    label: "Haiku 5.5, effort medium",
    family: "claude-haiku",
    effort: "medium",
  },
  {
    id: "gemini-flash",
    label: "Gemini 3.8 Flash, default thinking (medium)",
    family: "gemini-flash",
  },
];

/**
 * USD per million tokens for Claude, from Anthropic's pricing page as the owner reported it on
 * 2026-11-01 (config/prices.json says Sonnet 3/15 and is wrong). Gemini is read from the price table
 * and flagged when that entry is unconfirmed.
 */
const CLAUDE_PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet": { input: 2, output: 10 },
  "claude-haiku": { input: 0.1, output: 0.5 },
};

const QUALITY_QUESTIONS = {
  clear: noul(
    "The `spoken` text is easy to follow when heard once, with no reference the listener cannot resolve.",
    {
      true: "A busy design engineer hears it once and knows what happened and who did it.",
      false: "It leaves out who or what it is about, or leans on a term it never explains.",
    },
  ),
  tight: noul("Every sentence of the `summary` adds a fact the reader did not already have.", {
    true: "No sentence repeats another, pads, or only announces that something is important.",
    false: "At least one sentence repeats, pads, or hypes without adding a fact.",
  }),
  worth: noul(
    "A design engineer would want `headline` and `summary` read to them in a short news briefing.",
    {
      true: "It reports something new and concrete that changes what a design engineer does or knows.",
      false: "It is vague, promotional, or too minor to spend a listener's time on.",
    },
  ),
};

const QualityReply = z.object({
  answers: z.object({
    clear: z.object({ noul: z.number() }),
    tight: z.object({ noul: z.number() }),
    worth: z.object({ noul: z.number() }),
  }),
});

export interface StoryScore {
  id: string;
  armId: string;
  headline: string;
  voiceViolations: number;
  /** Lowest sentence score over summary and spoken text; null when Jev did not answer. */
  grounding: number | null;
  clear: number | null;
  tight: number | null;
  worth: number | null;
}

export interface ArmReport {
  arm: Arm;
  model: string;
  stories: number;
  written: number;
  failed: number;
  /** Written stories with no voice violation and every sentence above the grounding threshold. */
  passed: number;
  voiceClean: number;
  meanGrounding: number | null;
  meanClear: number | null;
  meanTight: number | null;
  meanWorth: number | null;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  usdPerPassed: number | null;
  seconds: number;
  priceConfirmed: boolean;
}

const mean = (values: readonly (number | null)[]): number | null => {
  const real = values.filter((v): v is number => v !== null);
  return real.length === 0 ? null : real.reduce((a, b) => a + b, 0) / real.length;
};

/** `count` stories spread evenly through the pool, so one source or topic does not fill the sample. */
export function sample<T>(pool: readonly T[], count: number): T[] {
  if (pool.length <= count) return [...pool];
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(pool[Math.floor((i * pool.length) / count)] as T);
  return out;
}

/** Deterministic shuffle (mulberry32), so the blind letters are the same on a rerun of one pool. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const quiet: Logger = {
  debug() {},
  info() {},
  warn: (m) => console.error(`warn: ${m}`),
  error: (m) => console.error(`error: ${m}`),
};

function routingFor(base: ModelRouting, arm: Arm): ModelRouting {
  const entry: ChainEntry = {
    family: arm.family,
    timeout_ms: 240_000,
    ...(arm.effort ? { effort: arm.effort } : {}),
  };
  return { ...base, steps: { ...base.steps, story_writer: { chain: [entry] } } };
}

async function rateQuality(
  client: JevClientLike,
  item: WrittenItem,
  secrets: readonly string[],
): Promise<{ clear: number; tight: number; worth: number } | null> {
  try {
    const raw = await client.systemOne({
      state: {
        headline: item.headline,
        summary: item.summary,
        spoken: item.spoken ?? item.summary,
      },
      questions: QUALITY_QUESTIONS,
      model: DEFAULT_JEV_MODEL,
    });
    const a = QualityReply.parse(raw).answers;
    return { clear: a.clear.noul, tight: a.tight.noul, worth: a.worth.noul };
  } catch (error) {
    quiet.warn(`quality rating failed: ${describeError(error, secrets)}`);
    return null;
  }
}

interface ArmRun {
  report: ArmReport;
  scores: StoryScore[];
  items: Map<string, WrittenItem>;
}

async function runArm(
  arm: Arm,
  stories: readonly SourceMaterial[],
  ctx: {
    root: string;
    env: Env;
    base: ModelRouting;
    client: JevClientLike;
    secrets: readonly string[];
    gemini: { input: number; output: number; confirmed: boolean } | null;
  },
): Promise<ArmRun | null> {
  const { env } = ctx;
  const needsKey = arm.family.startsWith("claude") ? env.ANTHROPIC_API_KEY : env.GEMINI_API_KEY;
  if (!needsKey) return null;
  const routing = routingFor(ctx.base, arm);
  let inputTokens = 0;
  let outputTokens = 0;
  const router = createModelRouter({
    routing,
    resolve: () => resolveFamilies({ routing, env, log: quiet }),
    env,
    budget: new TokenBudget(env.MAX_TOKENS_PER_RUN * 4),
    log: quiet,
    onUsage: (usage) => {
      inputTokens += usage.inputTokens;
      outputTokens += usage.outputTokens;
    },
  });
  const voice = await loadVoice(ctx.root);
  const writer = new LlmWriter({
    llm: router.llmFor("story_writer"),
    voice,
    log: quiet,
    secrets: ctx.secrets,
  });
  const started = Date.now();
  const result = await writer.write(stories);
  const seconds = (Date.now() - started) / 1000;
  const model = router.lastServed().story_writer?.model ?? arm.family;

  const linter = createLinter(voice);
  const grounder = new JevGrounder({ client: ctx.client, log: quiet, secrets: ctx.secrets });
  const byId = new Map(stories.map((s) => [s.id, s]));
  const items = new Map(result.written.map((w) => [w.id, w]));
  const scores = await mapConcurrent(result.written, 4, async (item): Promise<StoryScore> => {
    const source = byId.get(item.id)?.text ?? "";
    const spoken = item.spoken ?? "";
    const violations =
      linter.lint("headline", item.headline).length +
      linter.lint("summary", item.summary).length +
      (spoken ? linter.lint("spoken", spoken).length : 0);
    const [summaryVerdict, spokenVerdict] = await Promise.all([
      grounder.ground({ id: item.id, summary: item.summary, why: "", sourceText: source }),
      spoken
        ? grounder.ground({ id: item.id, summary: spoken, why: "", sourceText: source })
        : Promise.resolve({ id: item.id, sentences: [] }),
    ]);
    const sentenceScores = [...summaryVerdict.sentences, ...spokenVerdict.sentences]
      .map((s) => s.score)
      .filter((s): s is number => s !== null);
    const quality = await rateQuality(ctx.client, item, ctx.secrets);
    return {
      id: item.id,
      armId: arm.id,
      headline: item.headline,
      voiceViolations: violations,
      grounding: sentenceScores.length === 0 ? null : Math.min(...sentenceScores),
      clear: quality?.clear ?? null,
      tight: quality?.tight ?? null,
      worth: quality?.worth ?? null,
    };
  });

  const passed = scores.filter(
    (s) =>
      s.voiceViolations === 0 && s.grounding !== null && s.grounding >= DEFAULT_GROUNDING_THRESHOLD,
  ).length;
  const price =
    arm.family === "gemini-flash"
      ? ctx.gemini
      : { ...(CLAUDE_PRICES[arm.family] ?? { input: 0, output: 0 }), confirmed: true };
  const usd = price ? (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output : 0;
  return {
    items,
    scores,
    report: {
      arm,
      model,
      stories: stories.length,
      written: result.written.length,
      failed: result.failed.length,
      passed,
      voiceClean: scores.filter((s) => s.voiceViolations === 0).length,
      meanGrounding: mean(scores.map((s) => s.grounding)),
      meanClear: mean(scores.map((s) => s.clear)),
      meanTight: mean(scores.map((s) => s.tight)),
      meanWorth: mean(scores.map((s) => s.worth)),
      inputTokens,
      outputTokens,
      usd,
      usdPerPassed: passed > 0 ? usd / passed : null,
      seconds,
      priceConfirmed: price?.confirmed ?? false,
    },
  };
}

const fmt = (n: number | null, digits = 2): string => (n === null ? "n/a" : n.toFixed(digits));
const usd = (n: number | null): string => (n === null ? "n/a" : `$${n.toFixed(n < 0.1 ? 4 : 3)}`);

export function reportMarkdown(reports: readonly ArmReport[], skipped: readonly string[]): string {
  const rows = reports.map(
    (r) =>
      `| ${r.arm.label} | ${r.written}/${r.stories} | ${r.passed} | ${r.voiceClean} | ${fmt(r.meanGrounding)} | ${fmt(r.meanClear)} | ${fmt(r.meanTight)} | ${fmt(r.meanWorth)} | ${r.inputTokens + r.outputTokens} | ${usd(r.usd)} | ${usd(r.usdPerPassed)} | ${r.seconds.toFixed(0)} s |`,
  );
  return [
    "# Writer model experiment",
    "",
    "First pass only (no voice rewrite loop), live prices (a batch would halve them). Jev scores run 0 to 1; higher is better.",
    "`passed` = no voice violation and every sentence above the grounding threshold.",
    "",
    "| Arm | written | passed | voice clean | grounding (min per story, mean) | clear | tight | worth airing | tokens | cost | cost per passed story | time |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    ...(reports.some((r) => !r.priceConfirmed)
      ? [
          "Gemini prices come from config/prices.json and are unconfirmed; treat its cost as indicative.",
          "",
        ]
      : []),
    ...(skipped.length > 0 ? [`Skipped (key not set): ${skipped.join(", ")}.`, ""] : []),
    "Jev is one judge. Read blind.md before you act on a small gap.",
    "",
  ].join("\n");
}

export function blindMarkdown(
  stories: readonly SourceMaterial[],
  runs: readonly ArmRun[],
  seed: number,
): { text: string; key: Record<string, Record<string, string>> } {
  const key: Record<string, Record<string, string>> = {};
  const out = [
    "# Blind read",
    "",
    "Each story is told by every arm under a letter. Rank them, then check results.json for the key.",
    "",
  ];
  for (const story of stories) {
    const told = runs.flatMap((run) => {
      const item = run.items.get(story.id);
      return item ? [{ armId: run.report.arm.id, item }] : [];
    });
    if (told.length === 0) continue;
    const order = shuffled(told, seed + story.id.length);
    key[story.id] = {};
    out.push(`## ${story.title}`, `_${story.source}_`, "");
    order.forEach((entry, index) => {
      const letter = String.fromCharCode(65 + index);
      (key[story.id] as Record<string, string>)[letter] = entry.armId;
      out.push(
        `**${letter}. ${entry.item.headline}**`,
        "",
        entry.item.summary,
        "",
        ...(entry.item.spoken ? [`> ${entry.item.spoken}`, ""] : []),
      );
    });
  }
  return { text: out.join("\n"), key };
}

export async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      materials: { type: "string" },
      limit: { type: "string" },
      arms: { type: "string" },
      out: { type: "string" },
    },
  });
  if (!values.materials) {
    console.error(
      "Usage: writerModels.ts --materials <materials.json> [--limit 12] [--arms a,b] [--out dir]",
    );
    return 1;
  }
  const root = repoRoot();
  try {
    process.loadEnvFile(join(root, ".env"));
  } catch {
    // No .env file: the environment supplies the keys.
  }
  const env = loadEnv();
  const secrets = secretsFromEnv(env);
  if (!env.TYPESAFE_API_KEY) {
    console.error("TYPESAFE_API_KEY is not set: Jev cannot rate the stories.");
    return 1;
  }
  const wanted = new Set(
    (values.arms ?? ARMS.map((a) => a.id).join(",")).split(",").map((s) => s.trim()),
  );
  const arms = ARMS.filter((a) => wanted.has(a.id));
  const limit = Number(values.limit ?? 12);
  const file = MaterialsFile.parse(JSON.parse(await readFile(resolve(values.materials), "utf8")));
  const stories: SourceMaterial[] = sample(file.items, limit).map((item) => ({
    id: item.id,
    title: item.title,
    source: item.source,
    ...(item.author ? { author: item.author } : {}),
    category: item.category,
    text: item.text,
    ...(item.prompt ? { prompt: item.prompt } : {}),
  }));

  const prices = await loadPrices(root);
  const geminiEntry = findPrice(prices, "gemini", "gemini-3.8-flash");
  const geminiIn = geminiEntry?.units.input_tokens;
  const geminiOut = geminiEntry?.units.output_tokens;
  const gemini =
    geminiIn && geminiOut
      ? {
          input: (geminiIn.usd / geminiIn.per) * 1e6,
          output: (geminiOut.usd / geminiOut.per) * 1e6,
          confirmed: geminiEntry.confirmed,
        }
      : null;

  const ctx = {
    root,
    env,
    base: loadModelRouting(root),
    client: createJevClient(env),
    secrets,
    gemini,
  };
  const runs: ArmRun[] = [];
  const skipped: string[] = [];
  for (const arm of arms) {
    console.error(`running ${arm.id} on ${stories.length} stories`);
    try {
      const run = await runArm(arm, stories, ctx);
      if (run) runs.push(run);
      else skipped.push(arm.id);
    } catch (error) {
      console.error(`${arm.id} failed: ${describeError(error, secrets)}`);
      skipped.push(`${arm.id} (error)`);
    }
  }
  if (runs.length === 0) {
    console.error("No arm ran: set ANTHROPIC_API_KEY and/or GEMINI_API_KEY.");
    return 1;
  }

  const out = resolve(values.out ?? join(root, ".cache", "eval", "writer-models"));
  await mkdir(dirname(join(out, "x")), { recursive: true });
  const reports = runs.map((r) => r.report);
  const blind = blindMarkdown(stories, runs, 20261101);
  const markdown = reportMarkdown(reports, skipped);
  await writeFile(join(out, "results.md"), markdown);
  await writeFile(join(out, "blind.md"), blind.text);
  await writeFile(
    join(out, "results.json"),
    JSON.stringify(
      {
        stories: stories.map((s) => ({ id: s.id, title: s.title })),
        reports,
        scores: runs.flatMap((r) => r.scores),
        written: Object.fromEntries(runs.map((r) => [r.report.arm.id, [...r.items.values()]])),
        blind_key: blind.key,
        skipped,
      },
      null,
      2,
    ),
  );
  console.log(markdown);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`experiment failed: ${describeError(error, [])}`);
      process.exit(1);
    },
  );
}
