import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { CONFIG_FILES, requireKey, type Source } from "@singularity/core";
import { type CommandContext, type CommandRun, redact, secretsFromEnv } from "../context.js";
import { createLimiter } from "../fetch/limiter.js";
import { QUERIES_PATH } from "../fetch/queries.js";
import { createHttpClient, HttpError } from "../http.js";
import { createJevClient } from "../judge/jevClient.js";
import { TopicJudge } from "../judge/topicJudge.js";
import { discoverAll } from "../sources/discoverAll.js";
import { buildRegistry } from "../sources/import.js";
import { loadSources, loadSourcesRaw, saveSources } from "../sources/registry.js";
import {
  createExaSearch,
  type SuggestDeps,
  suggestForTopic,
  withCandidates,
} from "../sources/suggest.js";
import { writeFileAtomic } from "../state/atomicWrite.js";
import { stableStringify } from "../state/stableJson.js";
import { readSourceCandidates, writeSourceCandidates } from "../state/store.js";
import { loadTopics } from "../topics/store.js";

const SOURCES_MD = "config/sources.md";

const USAGE = `Usage: singularity sources <command>

  import [--fresh] [--dry-run]       Build config/sources.json from config/sources.md and the code seed.
                                     Offline. Keeps discovered feeds and counters unless --fresh.
  discover [--all] [--only a,b] [--dry-run]
                                     Find and verify feeds for page sources, resolve YouTube channel ids.
                                     Uses the network (a few hundred polite requests at most).
  check [--only a,b] [--strict]      Reachability pass over every enabled source. Uses the network.
                                     Never run in tests. --strict exits 1 when any source fails.
  suggest --topic <id> [--dry-run]   Find feeds for a custom topic: three Exa searches, feed discovery,
                                     validation and a quality score. Records the candidates in
                                     state/source-candidates.json and adds nothing: the owner adds
                                     the ones they want. Needs EXA_API_KEY and TYPESAFE_API_KEY.`;

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function summarize(sources: readonly Source[]): Record<string, number> {
  const counts: Record<string, number> = {
    total: sources.length,
    enabled: 0,
    feeds: 0,
    scrape: 0,
    api: 0,
    disabled: 0,
  };
  for (const source of sources) {
    if (!source.enabled) {
      counts.disabled = (counts.disabled ?? 0) + 1;
      continue;
    }
    counts.enabled = (counts.enabled ?? 0) + 1;
    const key = source.type === "firecrawl" ? "scrape" : source.type === "rss" ? "feeds" : "api";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function parseOnly(value: string | undefined): string[] | undefined {
  return value
    ? value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    : undefined;
}

async function runImport(argv: string[], ctx: CommandContext): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { fresh: { type: "boolean" }, "dry-run": { type: "boolean" } },
    strict: true,
  });
  const markdown = await readFile(join(ctx.root, SOURCES_MD), "utf8");
  const existing =
    values.fresh || !(await exists(join(ctx.root, CONFIG_FILES.sources)))
      ? undefined
      : await loadSourcesRaw(ctx.root);
  const { file, queries, warnings } = buildRegistry(markdown, existing);
  for (const warning of warnings) ctx.log.warn(warning);

  if (!values["dry-run"]) {
    await saveSources(ctx.root, file);
    const queriesPath = join(ctx.root, QUERIES_PATH);
    // Queries are edited by hand over time, so an existing file is never overwritten.
    if (!(await exists(queriesPath))) await writeFileAtomic(queriesPath, stableStringify(queries));
  }
  const counts = summarize(file.sources);
  print(
    ctx.json
      ? JSON.stringify({ ...counts, queries: queries.queries.length, warnings: warnings.length })
      : `${CONFIG_FILES.sources}: ${JSON.stringify(counts)}, ${queries.queries.length} queries`,
  );
  return 0;
}

async function runDiscover(argv: string[], ctx: CommandContext): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { all: { type: "boolean" }, only: { type: "string" }, "dry-run": { type: "boolean" } },
    strict: true,
  });
  // The seed file only: discovery results are saved back to it, and the app's edits stay in
  // config/sources.user.json.
  const file = await loadSourcesRaw(ctx.root);
  const only = parseOnly(values.only);
  const { file: updated, report } = await discoverAll(
    file,
    { http: createHttpClient({ retries: 1 }) },
    { all: values.all ?? false, ...(only ? { only } : {}) },
  );
  if (!values["dry-run"]) await saveSources(ctx.root, updated);

  const tally: Record<string, number> = {};
  for (const entry of report) tally[entry.outcome] = (tally[entry.outcome] ?? 0) + 1;
  const requests = report.reduce((sum, entry) => sum + entry.requests, 0);
  if (ctx.json) {
    print(JSON.stringify({ tally, requests, report }));
  } else {
    print(`discovery: ${JSON.stringify(tally)} in ${requests} requests`);
    for (const entry of report) {
      if (entry.outcome === "kept") continue;
      print(
        `  ${entry.outcome.padEnd(10)} ${entry.id}${entry.feed_url ? ` ${entry.feed_url}` : ""}${entry.detail ? ` (${entry.detail})` : ""}`,
      );
    }
  }
  return 0;
}

interface CheckResult {
  id: string;
  ok: boolean;
  status?: number;
  detail?: string;
}

async function runCheck(argv: string[], ctx: CommandContext): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { only: { type: "string" }, strict: { type: "boolean" } },
    strict: true,
  });
  const file = await loadSources(ctx.root);
  const only = parseOnly(values.only);
  const targets = file.sources.filter((s) => s.enabled && (!only || only.includes(s.id)));
  const http = createHttpClient({ retries: 0, timeoutMs: 10_000 });
  const limiter = createLimiter(6);
  const secrets = secretsFromEnv(ctx.env);

  const results = await Promise.all(
    targets.map((source) =>
      limiter.run(async (): Promise<CheckResult> => {
        // Exa is a paid API and Firecrawl pages are fetched by a third party; neither is probed here.
        if (source.type === "exa")
          return { id: source.id, ok: true, detail: "not probed (needs key)" };
        try {
          const response = await http.fetchText(source.feed_url ?? source.url);
          return { id: source.id, ok: true, status: response.status };
        } catch (error) {
          const status = error instanceof HttpError ? error.status : undefined;
          return {
            id: source.id,
            ok: false,
            ...(status === undefined ? {} : { status }),
            detail: redact(error instanceof Error ? error.message : String(error), secrets),
          };
        }
      }),
    ),
  );
  const failed = results.filter((r) => !r.ok);
  if (ctx.json) {
    print(JSON.stringify({ checked: results.length, failed: failed.length, failures: failed }));
  } else {
    print(
      `checked ${results.length} sources: ${results.length - failed.length} reachable, ${failed.length} failing`,
    );
    for (const result of failed)
      print(`  ${result.id}: ${result.status ?? ""} ${result.detail ?? ""}`.trimEnd());
  }
  return values.strict && failed.length > 0 ? 1 : 0;
}

/** Build the clients `suggest` needs. Tests replace this whole function with fakes. */
export type SuggestDepsFactory = (ctx: CommandContext) => SuggestDeps;

function realSuggestDeps(ctx: CommandContext): SuggestDeps {
  const http = createHttpClient({ retries: 1 });
  const secrets = secretsFromEnv(ctx.env);
  return {
    http,
    search: createExaSearch(http, requireKey(ctx.env, "EXA_API_KEY")),
    judge: new TopicJudge({ client: createJevClient(ctx.env), log: ctx.log, secrets }),
    now: ctx.now,
    log: ctx.log,
  };
}

async function runSuggest(
  argv: string[],
  ctx: CommandContext,
  makeDeps: SuggestDepsFactory,
): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { topic: { type: "string" }, "dry-run": { type: "boolean" } },
    strict: true,
  });
  if (!values.topic) {
    print(USAGE);
    return 2;
  }
  const topics = await loadTopics(ctx.root);
  const topic = topics.topics.find((candidate) => candidate.id === values.topic);
  if (!topic) {
    ctx.log.error(`There is no topic ${values.topic}.`);
    return 1;
  }
  if (topic.origin !== "custom") {
    ctx.log.error("Sources are suggested for custom topics only.");
    return 1;
  }

  const registry = await loadSources(ctx.root);
  const result = await suggestForTopic({ topic, existing: registry.sources }, makeDeps(ctx));

  if (!values["dry-run"]) {
    const candidates = withCandidates(
      await readSourceCandidates(ctx.root),
      topic.id,
      result,
      ctx.now(),
    );
    await writeSourceCandidates(ctx.root, candidates);
  }
  if (ctx.json) {
    print(
      JSON.stringify({
        topic: topic.id,
        candidates: result.candidates.length,
        suggested: result.candidates
          .filter((candidate) => candidate.status === "suggested")
          .map((candidate) => candidate.id),
        dry_run: values["dry-run"] === true,
      }),
    );
  } else {
    const suggested = result.candidates.filter((c) => c.status === "suggested").length;
    print(`suggest ${topic.id}: ${result.candidates.length} candidates, ${suggested} suggested`);
    for (const candidate of result.candidates) {
      const score = candidate.q === null ? "  - " : candidate.q.toFixed(2);
      print(
        `  ${candidate.status.padEnd(9)} ${score} ${candidate.id}${candidate.reason ? ` (${candidate.reason})` : ""}`,
      );
    }
  }
  return 0;
}

async function runSources(
  argv: string[],
  ctx: CommandContext,
  makeSuggestDeps: SuggestDepsFactory,
): Promise<number> {
  const [subcommand, ...rest] = argv;
  try {
    switch (subcommand) {
      case "import":
        return await runImport(rest, ctx);
      case "discover":
        return await runDiscover(rest, ctx);
      case "check":
        return await runCheck(rest, ctx);
      case "suggest":
        return await runSuggest(rest, ctx, makeSuggestDeps);
      case undefined:
      case "help":
      case "--help":
      case "-h":
        print(USAGE);
        return subcommand === undefined ? 2 : 0;
      default:
        ctx.log.error(`unknown subcommand "${subcommand}"`);
        print(USAGE);
        return 2;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.log.error(redact(message, secretsFromEnv(ctx.env)));
    const code = (error as NodeJS.ErrnoException).code;
    return typeof code === "string" && code.startsWith("ERR_PARSE_ARGS") ? 2 : 1;
  }
}

/** `singularity sources import|discover|check|suggest`. */
export function makeSourcesCommand(
  makeSuggestDeps: SuggestDepsFactory = realSuggestDeps,
): CommandRun {
  return (argv, ctx) => runSources(argv, ctx, makeSuggestDeps);
}

export const run: CommandRun = makeSourcesCommand();
