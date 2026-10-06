import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { CONFIG_FILES, type Source } from "@dispatch/core";
import { type CommandContext, type CommandRun, redact, secretsFromEnv } from "../context.js";
import { createLimiter } from "../fetch/limiter.js";
import { QUERIES_PATH } from "../fetch/queries.js";
import { createHttpClient, HttpError } from "../http.js";
import { discoverAll } from "../sources/discoverAll.js";
import { buildRegistry } from "../sources/import.js";
import { loadSources, saveSources } from "../sources/registry.js";
import { writeFileAtomic } from "../state/atomicWrite.js";
import { stableStringify } from "../state/stableJson.js";

const SOURCES_MD = "config/sources.md";

const USAGE = `Usage: dispatch sources <command>

  import [--fresh] [--dry-run]       Build config/sources.json from config/sources.md and the code seed.
                                     Offline. Keeps discovered feeds and counters unless --fresh.
  discover [--all] [--only a,b] [--dry-run]
                                     Find and verify feeds for page sources, resolve YouTube channel ids.
                                     Uses the network (a few hundred polite requests at most).
  check [--only a,b] [--strict]      Reachability pass over every enabled source. Uses the network.
                                     Never run in tests. --strict exits 1 when any source fails.`;

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
      : await loadSources(ctx.root);
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
  const file = await loadSources(ctx.root);
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

/** `dispatch sources import|discover|check`. */
export const run: CommandRun = async (argv: string[], ctx: CommandContext): Promise<number> => {
  const [subcommand, ...rest] = argv;
  try {
    switch (subcommand) {
      case "import":
        return await runImport(rest, ctx);
      case "discover":
        return await runDiscover(rest, ctx);
      case "check":
        return await runCheck(rest, ctx);
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
};
