import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import { CONFIG_FILES, type DigestKind, Preferences, stockholmDate } from "@dispatch/core";
import { type CommandContext, type CommandRun, redact, secretsFromEnv } from "../context.js";
import { dedupe } from "../dedupe/dedupe.js";
import { fetchAll } from "../fetch/fetchAll.js";
import { type PoolFile, poolRelPath, writePool } from "../fetch/pool.js";
import { loadQueries } from "../fetch/queries.js";
import { allocateDigestId } from "../gate/allocateDigestId.js";
import { fetchWindow } from "../gate/fetchWindow.js";
import { createHttpClient } from "../http.js";
import { prefilter } from "../prefilter/prefilter.js";
import { loadSources, saveSources } from "../sources/registry.js";
import { listDigestIds } from "../state/digestIds.js";
import { applySourceResults } from "../state/sourceHealth.js";
import { readLastRun, readSeen } from "../state/store.js";

const USAGE = `Usage: dispatch fetch [--since <iso>] [--weekly] [--out <path>] [--id <digest-id>] [--update-health]

Gathers candidates since the last successful fetch, normalizes, dedupes and prefilters them, and
writes the pool to .cache/run/<id>/pool.json. Uses the network; sources with missing API keys skip.`;

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function loadPreferences(root: string): Promise<Preferences> {
  const text = await readFile(join(root, CONFIG_FILES.preferences), "utf8");
  return Preferences.parse(JSON.parse(text) as unknown);
}

/** `dispatch fetch`: sources in, one ranked pool out. */
export const run: CommandRun = async (argv: string[], ctx: CommandContext): Promise<number> => {
  let values: {
    since?: string | undefined;
    weekly?: boolean | undefined;
    out?: string | undefined;
    id?: string | undefined;
    "update-health"?: boolean | undefined;
    help?: boolean | undefined;
  };
  try {
    values = parseArgs({
      args: argv,
      options: {
        since: { type: "string" },
        weekly: { type: "boolean" },
        out: { type: "string" },
        id: { type: "string" },
        "update-health": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
    }).values;
  } catch (error) {
    ctx.log.error(error instanceof Error ? error.message : "invalid arguments");
    print(USAGE);
    return 2;
  }
  if (values.help) {
    print(USAGE);
    return 0;
  }

  const now = ctx.now();
  const kind: DigestKind = values.weekly ? "weekly" : "regular";
  const secrets = secretsFromEnv(ctx.env);

  try {
    const [sourcesFile, preferences, seen, lastRun, queries] = await Promise.all([
      loadSources(ctx.root),
      loadPreferences(ctx.root),
      readSeen(ctx.root),
      readLastRun(ctx.root),
      loadQueries(ctx.root),
    ]);

    let window = fetchWindow({
      lastFetchAt: lastRun.last_fetch_at ? new Date(lastRun.last_fetch_at) : undefined,
      now,
      kind,
    });
    if (values.since !== undefined) {
      const from = new Date(values.since);
      if (Number.isNaN(from.getTime()) || from > now) {
        ctx.log.error("--since must be an ISO date or time in the past");
        return 2;
      }
      window = { from, to: now };
    }

    const { items, results } = await fetchAll(
      sourcesFile.sources,
      window,
      {
        http: createHttpClient({ retries: 2 }),
        now: ctx.now,
        exa: { apiKey: ctx.env.EXA_API_KEY, queries: queries.queries },
        firecrawl: { apiKey: ctx.env.FIRECRAWL_API_KEY },
      },
      { mode: kind === "weekly" ? "weekly" : "regular" },
    );

    const deduped = dedupe({ items, sources: sourcesFile.sources, seen });
    const filtered = prefilter({
      items: deduped.items,
      preferences,
      sources: sourcesFile.sources,
      now,
    });

    const id =
      values.id ?? allocateDigestId(stockholmDate(now), kind, await listDigestIds(ctx.root));
    const outPath = values.out
      ? isAbsolute(values.out)
        ? values.out
        : join(ctx.root, values.out)
      : join(ctx.root, poolRelPath(id));

    const pool: PoolFile = {
      version: 1,
      id,
      kind,
      generated_at: now.toISOString(),
      window: { from: window.from.toISOString(), to: window.to.toISOString() },
      sources: results,
      report: { fetched: items.length, dedupe: deduped.report, prefilter: filtered.report },
      items: filtered.items,
    };
    await writePool(outPath, pool);

    if (values["update-health"]) {
      await saveSources(ctx.root, applySourceResults(sourcesFile, results, now));
    }

    const failed = results.filter((r) => !r.ok);
    const skipped = results.filter((r) => r.ok && r.note !== undefined);
    const summary = {
      id,
      kind,
      window: pool.window,
      sources: {
        run: results.length,
        ok: results.length - failed.length,
        failed: failed.length,
        skipped: skipped.length,
      },
      fetched: items.length,
      after_dedupe: deduped.report.output,
      kept: filtered.report.kept,
      dropped: filtered.report.dropped,
      pool: outPath,
    };
    if (ctx.json) {
      print(
        JSON.stringify({
          ...summary,
          failed_sources: failed.map((r) => ({
            source_id: r.source_id,
            error: redact(r.error ?? "", secrets),
          })),
        }),
      );
    } else {
      print(`pool ${id} (${kind}): window ${pool.window.from} to ${pool.window.to}`);
      print(
        `sources: ${summary.sources.ok} ok, ${summary.sources.failed} failed, ${summary.sources.skipped} skipped of ${summary.sources.run}`,
      );
      print(
        `items: ${items.length} fetched, ${deduped.report.output} after dedupe, ${filtered.report.kept} kept`,
      );
      print(`dropped: ${JSON.stringify(filtered.report.dropped)}`);
      print(`wrote ${outPath}`);
      for (const result of failed)
        ctx.log.warn(`source ${result.source_id} failed`, {
          error: redact(result.error ?? "", secrets),
        });
    }
    // Every source that could run failing means the network or the registry is broken, which a
    // run must not hide. Skipped sources (no key) neither succeeded nor failed.
    const attempted = results.filter((r) => !(r.ok && r.note !== undefined));
    return attempted.length > 0 && attempted.every((r) => !r.ok) ? 1 : 0;
  } catch (error) {
    ctx.log.error(redact(error instanceof Error ? error.message : String(error), secrets));
    return 1;
  }
};
