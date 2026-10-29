import { parseArgs } from "node:util";
import { type CommandContext, type CommandRun, redact, secretsFromEnv } from "../context.js";
import { emit } from "../curate/output.js";
import { createHttpClient } from "../http.js";
import {
  DEFAULT_MAX_EXTRACTIONS,
  INGEST_WINDOW_DAYS,
  type IngestInput,
  runIngest,
} from "../ingest/ingest.js";
import { type BlobClient, createVercelBlobClient } from "../publish/blob.js";
import { loadSources } from "../sources/registry.js";
import { connectConfigStore, databaseSecrets, type SqlClient } from "../store/configPaths.js";

const USAGE = `Usage: singularity ingest [--since <iso>] [--max <n>] [--dry-run]

Reads the free sources (rss, github, hn, arxiv, crossref, lobsters, producthunt) over the last ${INGEST_WINDOW_DAYS} days,
extracts each story the store does not hold, archives its text in Blob and records it in Neon
(D233). Needs DATABASE_URL and BLOB_READ_WRITE_TOKEN; --dry-run needs neither and writes nothing.
It reads nothing a briefing uses and spends no Firecrawl, Exa or model call.`;

const DAY_MS = 86_400_000;

export interface IngestDeps {
  sql?: SqlClient;
  blob?: BlobClient;
  /** Replace the source fetchers and the extraction, for tests. */
  run?: Pick<IngestInput, "fetchers" | "extract" | "randomId">;
}

/** `singularity ingest`: the ingest layer in shadow beside the daily fetch (D233). */
export function makeIngestCommand(deps: IngestDeps = {}): CommandRun {
  return async (argv: string[], ctx: CommandContext): Promise<number> => {
    let values: { since?: string; max?: string; "dry-run"?: boolean; help?: boolean };
    try {
      values = parseArgs({
        args: argv,
        allowPositionals: false,
        strict: true,
        options: {
          since: { type: "string" },
          max: { type: "string" },
          "dry-run": { type: "boolean" },
          help: { type: "boolean", short: "h" },
        },
      }).values;
    } catch (error) {
      ctx.log.error(`${error instanceof Error ? error.message : "invalid arguments"}. ${USAGE}`);
      return 2;
    }
    if (values.help) {
      process.stdout.write(`${USAGE}\n`);
      return 0;
    }
    const now = ctx.now();
    const from = values.since
      ? new Date(values.since)
      : new Date(now.getTime() - INGEST_WINDOW_DAYS * DAY_MS);
    const max = values.max === undefined ? DEFAULT_MAX_EXTRACTIONS : Number(values.max);
    if (Number.isNaN(from.getTime()) || from > now || !Number.isInteger(max) || max < 1) {
      ctx.log.error(`--since must be an ISO date in the past and --max a whole number. ${USAGE}`);
      return 2;
    }
    const dryRun = values["dry-run"] === true;
    const databaseUrl = ctx.env.DATABASE_URL;
    const token = ctx.env.BLOB_READ_WRITE_TOKEN;
    if (!dryRun && (!databaseUrl || (!token && !deps.blob))) {
      ctx.log.error(
        "DATABASE_URL and BLOB_READ_WRITE_TOKEN are needed to ingest; --dry-run needs neither.",
      );
      return 1;
    }
    const secrets = [
      ...secretsFromEnv(ctx.env),
      ...(databaseUrl ? databaseSecrets(databaseUrl) : []),
    ];
    try {
      const sql = deps.sql ?? (databaseUrl ? await connectConfigStore(databaseUrl) : null);
      const blob = deps.blob ?? (token ? createVercelBlobClient(token) : null);
      const sources = await loadSources(ctx.root);
      const { run, results } = await runIngest({
        sources: sources.sources,
        window: { from, to: now },
        sql,
        blob,
        fetchDeps: { http: createHttpClient({ retries: 2 }), now: ctx.now },
        now: ctx.now,
        maxExtractions: max,
        githubRunId: process.env.GITHUB_RUN_ID ?? null,
        dryRun,
        ...deps.run,
      });
      emit(
        ctx,
        [
          `ingest ${dryRun ? "(dry run) " : ""}${run.run_id}: window ${run.window_from} to ${run.window_to}`,
          `sources: ${run.sources_ok} ok, ${run.sources_failed} failed`,
          `stories: ${run.fetched} read, ${run.known} already held, ${run.archived} archived, ${run.unreadable} unreadable, ${run.errors} not stored, ${run.deferred} deferred`,
          `text: ${run.chars} characters in ${run.ms} ms`,
        ],
        { ...run },
      );
      for (const result of results.filter((r) => !r.ok)) {
        ctx.log.warn(`source ${result.source_id} failed`, {
          error: redact(result.error ?? "", secrets),
        });
      }
      // Every source failing means the network or the registry is broken; Blob refusing every story
      // means the store is. Both are worth a red run.
      const attempted = results.filter((r) => !(r.ok && r.note !== undefined));
      const noSource = attempted.length > 0 && attempted.every((r) => !r.ok);
      const noStore = run.errors > 0 && run.archived === 0 && run.unreadable === 0;
      return noSource || noStore ? 1 : 0;
    } catch (error) {
      ctx.log.error(redact(error instanceof Error ? error.message : String(error), secrets));
      return 1;
    }
  };
}

export const run: CommandRun = makeIngestCommand();
