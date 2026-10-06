#!/usr/bin/env tsx
/**
 * Golden-set evaluation for the curation half of the engine. It runs on demand only: it calls
 * TypeSafe Jev and Nebius Token Factory with your keys, so it never runs in CI or in the unit
 * tests (the pure comparison logic in compare.ts is what the tests cover).
 *
 *   npx tsx packages/engine/eval/run.ts [--only judges,grounding,bakeoff] [--models a,b]
 *                                       [--thinking <spec>] [--json]
 *
 * Needs, in the environment or in .env:
 *   judges     TYPESAFE_API_KEY for Jev, NEBIUS_API_KEY and DISPATCH_MODEL for the fallback judge.
 *              With both, the two are compared. With one, that judge is scored alone.
 *   grounding  TYPESAFE_API_KEY. Sweeps the grounding threshold over eval/golden/grounding.json.
 *   bakeoff    NEBIUS_API_KEY and models from --models (default DISPATCH_MODEL and
 *              DISPATCH_FALLBACK_MODEL). Scores voice-lint pass rate on eval/golden/pool.json.
 *
 * Spend is small (a few cents), and the Nebius token guard (MAX_TOKENS_PER_RUN) applies per model.
 * Use the output to set DEFAULT_SCORE_THRESHOLD, DEFAULT_GROUNDING_THRESHOLD and DISPATCH_MODEL.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { type Env, type JudgmentEntry, loadEnv, repoRoot } from "@dispatch/core";
import { type Logger, secretsFromEnv } from "../src/context.js";
import { loadPreferences } from "../src/curate/inputs.js";
import { JevJudge } from "../src/judge/jev.js";
import { createJevClient } from "../src/judge/jevClient.js";
import { NebiusJudge } from "../src/judge/nebiusJudge.js";
import type { Judge, JudgeFailure } from "../src/judge/types.js";
import { describeError } from "../src/llm/errors.js";
import { createNebiusLlm } from "../src/llm/nebiusClient.js";
import { createOpenAiChatApi } from "../src/llm/openAiChatApi.js";
import { parseThinkingOff } from "../src/llm/thinking.js";
import { TokenBudget } from "../src/llm/tokenBudget.js";
import { scoreItem } from "../src/score/scoreItem.js";
import { DEFAULT_SCORE_THRESHOLD } from "../src/score/selectItems.js";
import type { ScoredItem } from "../src/score/types.js";
import { JevGrounder } from "../src/validate/grounding.js";
import { createLinter, VOICE_FIELDS } from "../src/voice/lint.js";
import { loadVoice } from "../src/voice/voice.js";
import { enforceVoice } from "../src/write/enforceVoice.js";
import { NebiusWriter } from "../src/write/nebiusWriter.js";
import type { SourceMaterial, WrittenItem } from "../src/write/types.js";
import {
  bestGroundingRow,
  bestSweepRow,
  categoryAccuracy,
  confusionOf,
  type GoldenEntry,
  type GroundingResult,
  groundingSweep,
  judgeAgreement,
  keepDecisions,
  keepMistakes,
  parseGolden,
  parseGroundingCases,
  ratesOf,
  thresholdSweep,
  type VoiceSample,
  voiceReport,
} from "./compare.js";
import {
  type BakeoffRow,
  bakeoffTable,
  groundingTable,
  percent,
  sweepTable,
  topRules,
} from "./report.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Known key values, redacted from any error message. Set once the environment is loaded. */
let secrets: string[] = [];

const quiet: Logger = {
  debug() {},
  info() {},
  warn: (m) => console.error(`warn: ${m}`),
  error: (m) => console.error(`error: ${m}`),
};

async function readGolden<T>(name: string, parse: (raw: unknown) => T): Promise<T> {
  return parse(JSON.parse(await readFile(join(here, "golden", name), "utf8")));
}

interface Section {
  name: string;
  text: string[];
  data: unknown;
}

async function runJudges(env: Env, golden: GoldenEntry[], root: string): Promise<Section | null> {
  const preferences = await loadPreferences(root);
  const items = golden.map((g) => g);
  const judges: Array<{ label: string; judge: Judge; failures: JudgeFailure[] }> = [];
  const onFailure = (list: JudgeFailure[]) => (f: JudgeFailure) => list.push(f);

  if (env.TYPESAFE_API_KEY) {
    const failures: JudgeFailure[] = [];
    judges.push({
      label: "jev",
      judge: new JevJudge({
        client: createJevClient(env),
        onFailure: onFailure(failures),
        log: quiet,
        secrets,
      }),
      failures,
    });
  }
  if (env.NEBIUS_API_KEY && env.DISPATCH_MODEL) {
    const failures: JudgeFailure[] = [];
    const llm = createNebiusLlm({
      api: createOpenAiChatApi(env),
      model: env.DISPATCH_MODEL,
      budget: new TokenBudget(env.MAX_TOKENS_PER_RUN),
      log: quiet,
    });
    judges.push({
      label: "nebius",
      judge: new NebiusJudge({ llm, onFailure: onFailure(failures), log: quiet, secrets }),
      failures,
    });
  }
  if (judges.length === 0) return null;

  const text: string[] = [];
  const data: Record<string, unknown> = {};
  const scoredBy = new Map<string, ScoredItem[]>();
  for (const { label, judge, failures } of judges) {
    const entries: JudgmentEntry[] = await judge.judge(items);
    const byId = new Map(items.map((i) => [i.id, i]));
    const scored = entries.flatMap((entry) => {
      const item = byId.get(entry.item_id);
      return item ? [scoreItem(entry, preferences, item)] : [];
    });
    scoredBy.set(label, scored);
    const sweep = thresholdSweep(scored, golden);
    const best = bestSweepRow(sweep);
    const atDefault = ratesOf(confusionOf(keepDecisions(scored, DEFAULT_SCORE_THRESHOLD), golden));
    const category = categoryAccuracy(scored, golden);
    text.push(
      `## Judge: ${label} (${judge.model})`,
      `answered ${entries.length} of ${items.length}, failed ${failures.length}`,
      `keep or drop at ${DEFAULT_SCORE_THRESHOLD}: accuracy ${percent(atDefault.accuracy)}, precision ${percent(atDefault.precision)}, recall ${percent(atDefault.recall)}`,
      `category accuracy: ${percent(category.accuracy)} (${category.correct} of ${category.total})`,
      "",
      sweepTable(sweep, best),
      best ? `best threshold by F1: ${best.threshold.toFixed(2)}` : "",
      "",
    );
    for (const m of keepMistakes(scored, golden, DEFAULT_SCORE_THRESHOLD)) {
      text.push(
        `  keep/drop miss: expected ${m.expected ? "keep" : "drop"}, got ${m.actual ? "keep" : "drop"} (${m.score}) ${m.title}`,
      );
    }
    for (const w of category.wrong)
      text.push(`  category miss: expected ${w.expected}, got ${w.actual}: ${w.title}`);
    text.push("");
    data[label] = { answered: entries.length, failures, atDefault, category, sweep, best };
  }
  const jev = scoredBy.get("jev");
  const nebius = scoredBy.get("nebius");
  if (jev && nebius) {
    const agreement = judgeAgreement(jev, nebius);
    text.push(
      `## Agreement, Jev against the Nebius fallback`,
      `compared ${agreement.compared}: same category ${percent(agreement.category)}, same keep or drop ${percent(agreement.keep)}`,
      "",
    );
    data.agreement = agreement;
  }
  return { name: "judges", text, data };
}

async function runGrounding(env: Env, golden: GoldenEntry[]): Promise<Section | null> {
  if (!env.TYPESAFE_API_KEY) return null;
  const cases = await readGolden("grounding.json", parseGroundingCases);
  const byId = new Map(golden.map((g) => [g.id, g]));
  const grounder = new JevGrounder({ client: createJevClient(env), log: quiet, secrets });
  const results: GroundingResult[] = [];
  for (const c of cases) {
    const sourceText = byId.get(c.item_id)?.source_text ?? "";
    const verdict = await grounder.ground({
      id: c.item_id,
      summary: c.sentence,
      why: "",
      sourceText,
    });
    results.push({ id: c.id, supported: c.supported, score: verdict.sentences[0]?.score ?? null });
  }
  const sweep = groundingSweep(results);
  const best = bestGroundingRow(sweep);
  return {
    name: "grounding",
    text: [
      `## Grounding threshold sweep (${cases.length} sentences, ${cases.filter((c) => c.supported).length} supported)`,
      groundingTable(sweep, best),
      best
        ? `lowest cost threshold (a false accept costs twice a false reject): ${best.threshold.toFixed(2)}`
        : "",
      "",
    ],
    data: { results, sweep, best },
  };
}

async function runBakeoff(
  env: Env,
  golden: GoldenEntry[],
  models: string[],
  thinkingSpec: string | undefined,
  root: string,
): Promise<Section | null> {
  if (!env.NEBIUS_API_KEY || models.length === 0) return null;
  const voice = await loadVoice(root);
  const linter = createLinter(voice);
  const withText = golden.filter((g) => g.expected.keep && g.source_text);
  const materials: SourceMaterial[] = withText.map((g) => ({
    id: g.id,
    title: g.title,
    source: g.source_id,
    ...(g.author ? { author: g.author } : {}),
    category: g.expected.category as SourceMaterial["category"],
    text: g.source_text as string,
  }));
  const byId = new Map(materials.map((m) => [m.id, m]));
  const grounder = env.TYPESAFE_API_KEY
    ? new JevGrounder({ client: createJevClient(env), log: quiet, secrets })
    : null;
  const rows: BakeoffRow[] = [];
  const notes: string[] = [];

  const sampleOf = (item: WrittenItem): VoiceSample => {
    const rules = VOICE_FIELDS.flatMap((field) =>
      linter.lint(field, item[field]).map((v) => v.rule),
    );
    const failingFields = VOICE_FIELDS.filter(
      (field) => linter.lint(field, item[field]).length > 0,
    ).length;
    return { id: item.id, rules, fields: VOICE_FIELDS.length, failingFields };
  };

  for (const model of models) {
    const budget = new TokenBudget(env.MAX_TOKENS_PER_RUN);
    const llm = createNebiusLlm({
      api: createOpenAiChatApi(env),
      model,
      budget,
      thinkingOff: parseThinkingOff(thinkingSpec),
      log: quiet,
    });
    const writer = new NebiusWriter({ llm, voice, log: quiet, secrets });
    const result = await writer.write(materials);
    const firstPass = voiceReport(result.written.map(sampleOf));
    const outcome = await enforceVoice({
      written: result.written,
      materials: byId,
      writer,
      linter,
    });
    const afterRewrite = voiceReport([
      ...outcome.passed.map((p) => sampleOf(p.item)),
      ...outcome.dropped.map((d) => ({
        id: d.id,
        rules: d.violations.map((v) => v.rule),
        fields: VOICE_FIELDS.length,
        failingFields: 1,
      })),
    ]);
    let grounded: number | null = null;
    if (grounder) {
      let supported = 0;
      let total = 0;
      for (const item of result.written) {
        const verdict = await grounder.ground({
          id: item.id,
          summary: item.summary,
          why: item.why,
          sourceText: byId.get(item.id)?.text ?? "",
        });
        for (const s of verdict.sentences) {
          total += 1;
          if (s.status === "supported") supported += 1;
        }
      }
      grounded = total === 0 ? 0 : supported / total;
    }
    rows.push({
      model,
      jsonFailures: result.failed.length,
      written: result.written.length,
      firstPass,
      afterRewrite,
      grounded,
      tokens: budget.used,
    });
    notes.push(`${model}: most common lint breaks on the first pass: ${topRules(firstPass)}`);
  }
  return {
    name: "bakeoff",
    text: [
      `## Writer bake-off (${materials.length} golden items, one with an injected instruction in its source)`,
      bakeoffTable(rows),
      ...notes,
      "",
    ],
    data: { rows },
  };
}

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      only: { type: "string" },
      models: { type: "string" },
      thinking: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Usage: npx tsx packages/engine/eval/run.ts [--only judges,grounding,bakeoff] [--models a,b] [--thinking <spec>] [--json]\nRuns on demand with real keys; see the header of this file.",
    );
    return 0;
  }
  const root = repoRoot();
  try {
    process.loadEnvFile(join(root, ".env"));
  } catch {
    // No .env file: the environment alone supplies the keys.
  }
  const env = loadEnv();
  secrets = secretsFromEnv(env);
  const golden = await readGolden("pool.json", parseGolden);
  const only = new Set((values.only ?? "judges,grounding,bakeoff").split(",").map((s) => s.trim()));
  const models = (
    values.models ?? [env.DISPATCH_MODEL, env.DISPATCH_FALLBACK_MODEL].filter(Boolean).join(",")
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const sections: Section[] = [];
  const attempts: Array<[string, () => Promise<Section | null>]> = [
    ["judges", () => runJudges(env, golden, root)],
    ["grounding", () => runGrounding(env, golden)],
    ["bakeoff", () => runBakeoff(env, golden, models, values.thinking, root)],
  ];
  for (const [name, attempt] of attempts) {
    if (!only.has(name)) continue;
    const section = await attempt();
    if (section) sections.push(section);
    else console.error(`skipped ${name}: the required keys or models are not set`);
  }
  if (sections.length === 0) {
    console.error(
      "Nothing ran. Set TYPESAFE_API_KEY and/or NEBIUS_API_KEY and DISPATCH_MODEL (see .env.example).",
    );
    return 1;
  }
  if (values.json)
    console.log(JSON.stringify(Object.fromEntries(sections.map((s) => [s.name, s.data])), null, 2));
  else console.log(sections.flatMap((s) => s.text).join("\n"));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`eval failed: ${describeError(error, secrets)}`);
      process.exit(1);
    },
  );
}
