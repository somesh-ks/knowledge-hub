import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { promisify } from "node:util";
import {
  episodeRelPath,
  loadModelRouting,
  Preferences,
  PriceTable,
  parseEpisodeFile,
  parseSourceCatalog,
  rateVital,
  ScheduleFile,
  SourcesUserFile,
  StructureFile,
  TopicsFile,
  VITAL_DEVICES,
  VITAL_METRICS,
  VITAL_THRESHOLDS,
  type VitalMetric,
} from "@singularity/core";
import {
  type EpisodeVoiceEnv,
  planEpisodeNarration,
  segmentMarksPath,
} from "../audio/segmentStore.js";
import { redact } from "../context.js";
import { parseQueries } from "../fetch/queries.js";
import { listEpisodeIds } from "../publish/publishEpisodes.js";
import { readConfigDocuments } from "../store/configDocs.js";
import {
  CONFIG_DOCUMENT_PATHS,
  type ConfigDocument,
  connectConfigStore,
  databaseSecrets,
  type SqlClient,
} from "../store/configPaths.js";
import {
  type ClientFaultGroup,
  OPAQUE_SCRIPT_ERROR,
  pruneClientFaults,
  readClientFaults,
} from "../store/faultsStore.js";
import {
  pruneVitals,
  readVitals,
  VITALS_WINDOW_DAYS,
  type VitalSummary,
} from "../store/vitalsStore.js";
import { configChecks } from "./doctorOffline.js";
import { firstIssue, readFileIfPresent } from "./doctorTypes.js";

/**
 * The checks hardening round 3 added to `singularity health` (docs/engineering/hardening.md): the
 * config files and episodes parse, and a run that died before it recorded anything. Each one reports
 * through the sink with a stable code, as health.ts's own checks do.
 */

export type HealthAspect =
  | "reliability"
  | "quality"
  | "cost"
  | "security"
  | "integrity"
  | "performance";

export interface Sink {
  fault: (code: string, aspect: HealthAspect, message: string) => void;
  warn: (code: string, aspect: HealthAspect, message: string) => void;
  passed: string[];
}

export type HealthFetch = (
  url: string,
  init?: { method?: string; redirect?: "manual" | "follow"; signal?: AbortSignal },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

const DAY_MS = 86_400_000;
const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 20_000;

function message(error: unknown): string {
  return error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
}

/** Config files with a core schema that `doctor` does not read; each may be absent. */
const CONFIG_SCHEMAS: Array<[string, (json: unknown) => unknown]> = [
  ["config/topics.json", (json) => TopicsFile.parse(json)],
  ["config/schedule.json", (json) => ScheduleFile.parse(json)],
  ["config/structure.json", (json) => StructureFile.parse(json)],
  ["config/prices.json", (json) => PriceTable.parse(json)],
  ["config/source-catalog.json", (json) => parseSourceCatalog(json)],
  ["config/sources.user.json", (json) => SourcesUserFile.parse(json)],
];

/** The newest main commit Vercel would deploy, and whether a given build contains it. */
export interface WatchedHead {
  sha: string;
  /** Its commit time, epoch ms. */
  at: number;
  /**
   * Whether the build named `build` (a commit, maybe shortened) has this commit in its history;
   * null when the checkout cannot tell (it does not know that commit: the site is newer).
   */
  includes: (build: string) => Promise<boolean | null>;
  /**
   * The commit time (epoch ms) of the oldest watched commit up to this one that the build lacks,
   * so a newer push does not restart the clock on a deploy that keeps failing; null when the
   * checkout cannot tell.
   */
  missingSince: (build: string) => Promise<number | null>;
}

/**
 * Reads the newest commit on main (origin/main, else a local main; never HEAD, so a run on another
 * branch cannot fault) that touches a path apps/web/vercel.json's ignoreCommand watches (read from
 * that file, so the two never drift). Needs history: health.yml fetches some. Undefined when git or
 * the file does not answer.
 */
export async function readWatchedHead(root: string): Promise<WatchedHead | undefined> {
  const git = async (...args: string[]) =>
    (await execFileAsync("git", args, { cwd: root, encoding: "utf8" })).stdout.trim();
  try {
    const vercel = JSON.parse(await readFile(join(root, "apps/web/vercel.json"), "utf8")) as {
      ignoreCommand?: string;
    };
    const watched = (vercel.ignoreCommand?.split(" -- ")[1] ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((path) => posix.normalize(posix.join("apps/web", path)));
    if (watched.length === 0) return undefined;
    const main = await git("rev-parse", "--verify", "--quiet", "origin/main").catch(() =>
      git("rev-parse", "--verify", "--quiet", "main"),
    );
    // A bot's commit (Dependabot's squash merges) is never deployed on Vercel Hobby, by design.
    const human = (await git("log", "-50", "--format=%H %ct %an <%ae>", main, "--", ...watched))
      .split("\n")
      .find((line) => line !== "" && !line.includes("[bot]"));
    const [sha, seconds] = (human ?? "").split(" ");
    if (!sha || !seconds) return undefined;
    return {
      sha,
      at: Number(seconds) * 1000,
      // Main's own line only (--first-parent): a squash merge's time is when it landed, never when
      // its branch was written. A build off main's line (a rewritten main) cannot tell.
      missingSince: async (build) => {
        try {
          await git("merge-base", "--is-ancestor", build, sha);
          const out = await git(
            "log",
            "--first-parent",
            "--format=%ct %an <%ae>",
            `${build}..${sha}`,
            "--",
            ...watched,
          );
          const times = out
            .split("\n")
            .filter((line) => line !== "" && !line.includes("[bot]"))
            .map((line) => Number(line.split(" ")[0]) * 1000);
          return times.length > 0 ? Math.min(...times) : null;
        } catch {
          return null;
        }
      },
      // Exit 1 is "not an ancestor"; 128 (an unknown commit) and the rest cannot tell.
      includes: (build) =>
        git("merge-base", "--is-ancestor", sha, build).then(
          () => true,
          (error: unknown) => ((error as { code?: unknown }).code === 1 ? false : null),
        ),
    };
  } catch {
    return undefined;
  }
}

/** `config_invalid`: doctor's offline config checks, the model routing and the other schemas. */
export async function checkConfig(root: string, sink: Sink): Promise<void> {
  let failed = false;
  const fault = (text: string): void => {
    failed = true;
    sink.fault("config_invalid", "integrity", text);
  };
  for (const check of await configChecks(root)) {
    if (check.status === "fail") fault(`${check.id}: ${check.summary}`);
  }
  try {
    loadModelRouting(root);
  } catch (error) {
    fault(`config/models.json: ${message(error)}`);
  }
  for (const [rel, parse] of CONFIG_SCHEMAS) {
    const text = await readFileIfPresent(join(root, rel));
    if (text === null) continue;
    try {
      parse(JSON.parse(text));
    } catch (error) {
      fault(`${rel}: ${firstIssue(error)}`);
    }
  }
  if (!failed) sink.passed.push("the config files parse");
}

/** The stored documents with a schema; the others (writer, profile, candidates) are checked as JSON. */
const DOCUMENT_SCHEMAS = new Map<string, (json: unknown) => unknown>([
  ...CONFIG_SCHEMAS,
  ["config/preferences.json", (json) => Preferences.parse(json)],
  ["config/queries.json", (json) => parseQueries(json)],
]);

/**
 * `config_store_drift` (D149's store on): a stored document the next run would skip (not JSON) or
 * fail on (its schema) is a fault. One that differs from its committed file though a committed run
 * was recorded after it was written is a warning only: no record holds when a run copied the store
 * (`at` is the commit, after the copy), so an edit made during a run reads the same. Only
 * CONFIG_DOCUMENT_PATHS are checked, as hydrateConfig copies only those. Nothing heals it.
 */
export async function checkConfigStore(
  root: string,
  documents: readonly ConfigDocument[],
  lastRunAt: string | null,
  sink: Sink,
): Promise<void> {
  const ranAt = lastRunAt === null ? Number.NaN : Date.parse(lastRunAt);
  const paths: readonly string[] = CONFIG_DOCUMENT_PATHS;
  const known = documents.filter((document) => paths.includes(document.path));
  let drifted = false;
  const fault = (text: string): void => {
    drifted = true;
    sink.fault("config_store_drift", "integrity", text);
  };
  for (const document of known) {
    let json: unknown;
    try {
      json = JSON.parse(document.content);
    } catch {
      fault(`The stored ${document.path} is not JSON: a run keeps the committed file.`);
      continue;
    }
    const parse = DOCUMENT_SCHEMAS.get(document.path);
    if (parse) {
      try {
        parse(json);
      } catch (error) {
        fault(`The stored ${document.path} fails its schema: ${firstIssue(error)}`);
        continue;
      }
    }
    const committed = await readFileIfPresent(join(root, document.path)).catch(() => null);
    if (
      committed !== document.content &&
      document.updatedAt !== undefined &&
      document.updatedAt < ranAt
    ) {
      drifted = true;
      sink.warn(
        "config_store_drift",
        "integrity",
        `The stored ${document.path} (written ${new Date(document.updatedAt).toISOString()}) differs from the committed file, and a run committed at ${lastRunAt} after it: it was edited during that run, or the run did not copy it.`,
      );
    }
  }
  if (!drifted) {
    sink.passed.push(
      `the ${known.length} stored config documents parse, and none written before the last committed run differs from git`,
    );
  }
}

/**
 * `episode_broken`: every episode under Podcasts/ parses, and the site's reader narrates each of
 * its turns (a turn the reader drops plays as silence). Online, the newest episode older than a day
 * has its first segment's word marks readable once its audio is stored.
 */
export async function checkEpisodes(
  root: string,
  env: EpisodeVoiceEnv,
  now: Date,
  sink: Sink,
  blob: { base: string; get: HealthFetch } | null,
): Promise<void> {
  const ids = await listEpisodeIds(root);
  const valid: Array<{ id: string; at: string; first: string }> = [];
  for (const id of ids) {
    const rel = episodeRelPath(id);
    try {
      const text = await readFile(join(root, rel), "utf8");
      const episode = parseEpisodeFile(text);
      const plan = planEpisodeNarration(text, env);
      if (plan.segments.length !== episode.turns.length) {
        throw new Error(
          `${episode.turns.length - plan.segments.length} of its ${episode.turns.length} turns would not be narrated`,
        );
      }
      const first = plan.segments[0];
      if (first) valid.push({ id, at: episode.generated_at, first: first.path });
    } catch (error) {
      sink.fault("episode_broken", "quality", `${rel}: ${message(error)}`);
    }
  }
  if (valid.length === ids.length) sink.passed.push(`${ids.length} episodes parse`);
  const settled = valid
    .filter((each) => now.getTime() - Date.parse(each.at) > DAY_MS)
    .sort((a, b) => (a.at < b.at ? 1 : -1))[0];
  if (!blob || !settled) return;
  try {
    const audio = await blob.get(`${blob.base}/${settled.first}`, {
      method: "HEAD",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Not narrated ahead of time (the allowance, a failed run): the site narrates it on Play.
    if (audio.status === 404) {
      sink.warn("episode_unnarrated", "quality", `${settled.id} has no stored narration yet.`);
      return;
    }
    const marks = await blob.get(`${blob.base}/${segmentMarksPath(settled.first)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const words =
      marks.status === 200 ? (JSON.parse(await marks.text()) as { words?: unknown }).words : null;
    if (!Array.isArray(words)) throw new Error(`its word marks answered ${marks.status}`);
    sink.passed.push(`${settled.id}'s narration and word marks are readable`);
  } catch (error) {
    sink.fault("episode_broken", "quality", `${settled.id}: ${message(error)}`);
  }
}

/**
 * One run of run.yml, as `gh run list --json databaseId,status,conclusion,createdAt,event,displayTitle`
 * lists it (health.yml). run.yml names a briefing run "run", a dry run "dry run" and a delete
 * "delete <id>".
 */
export interface WorkflowRun {
  databaseId: number;
  status: string;
  conclusion: string | null;
  createdAt: string;
  event?: string;
  displayTitle?: string;
}

/** A run older than this that died is left to `run_overdue`: the next run has had its chance. */
export const RUN_DIED_WINDOW_MS = 3 * DAY_MS;
const DIED = new Set(["failure", "timed_out", "startup_failure"]);

const isBriefing = (run: WorkflowRun): boolean => (run.displayTitle ?? "run") === "run";

/**
 * `run_died`: a briefing run of run.yml that failed or timed out with no run record written after
 * it started. A failed scheduled or weekly job records `failed` in run.yml's Record failure step
 * (`run --record-failed`), newer than the run, so it reads as `run_failed` and not here. One that
 * step could not record (an on-demand run, a checkout or an install that fails twice, a push that
 * failed) wrote nothing, so the last record still reads as the run before. It only alerts: health.yml heals `run_failed` and `run_overdue`,
 * never this, so no paid run rides on it. A `cancelled` briefing run with no record after it is
 * `run_cancelled`, a warning: GitHub reports a job killed at its timeout the same as one the owner
 * stopped, and a missed briefing reads as `run_overdue` anyway. A dry run or a delete never writes
 * a record, so neither counts. A briefing run under way that is newer may still record, so nothing
 * is said until it ends.
 */
export function checkRunsDied(
  records: ReadonlyArray<{ at: string } | null>,
  runs: readonly WorkflowRun[],
  now: Date,
  sink: Sink,
): void {
  const recorded = Math.max(
    Number.NEGATIVE_INFINITY,
    ...records.flatMap((record) => (record ? [Date.parse(record.at)] : [])),
  );
  // The newest briefing run that ended this way with no record after it, unless a newer one is under way.
  const unrecorded = (ended: (conclusion: string) => boolean): WorkflowRun | undefined => {
    const last = runs
      .filter(
        (run) =>
          run.status === "completed" &&
          ended(run.conclusion ?? "") &&
          isBriefing(run) &&
          now.getTime() - Date.parse(run.createdAt) < RUN_DIED_WINDOW_MS &&
          Date.parse(run.createdAt) > recorded,
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
    if (!last) return undefined;
    const after = Date.parse(last.createdAt);
    const underWay = runs.some(
      (run) => run.status !== "completed" && isBriefing(run) && Date.parse(run.createdAt) > after,
    );
    return underWay ? undefined : last;
  };
  const text = (run: WorkflowRun) =>
    `Run ${run.databaseId} (${run.event ?? "run"}, ${run.createdAt}) ended ${run.conclusion} before it recorded an outcome.`;
  const died = unrecorded((conclusion) => DIED.has(conclusion));
  const cancelled = unrecorded((conclusion) => conclusion === "cancelled");
  if (died) sink.fault("run_died", "reliability", text(died));
  if (cancelled) sink.warn("run_cancelled", "reliability", text(cancelled));
  if (!died && !cancelled && runs.length > 0) {
    sink.passed.push("every recent run recorded its outcome");
  }
}

/** One page as scripts/perfProbe.ts measured it: the median of its cold loads. */
export interface PerfPage {
  page: string;
  lcp_ms: number;
  cls: number;
  tbt_ms: number;
}

/**
 * The lab budgets, under the probe's throttling (a phone viewport, 4x CPU, Fast 4G; scripts/perfProbe.ts).
 * LCP and CLS are web.dev's "good" thresholds (2.5 s, 0.1); TBT, the lab stand-in for INP, has no
 * web.dev line, so 300 ms leaves the shared runner some headroom over Lighthouse's 200 ms "good".
 */
export const PERF_BUDGET = { lcp_ms: 2500, cls: 0.1, tbt_ms: 300 } as const;

/**
 * The daily lab probe's pages (D147): a page over a budget is `perf_budget`, a warning that never
 * heals. No readable measurement (the probe failed, so health.yml passed a file it never wrote) is
 * `perf_unmeasured`, so a probe that stopped working never reads as a pass.
 */
export function checkPerf(perf: unknown, sink: Sink): void {
  const pages = (perf as { pages?: unknown } | null)?.pages;
  const valid =
    Array.isArray(pages) &&
    pages.length > 0 &&
    pages.every(
      (each: Partial<PerfPage> | null) =>
        typeof each?.page === "string" &&
        [each.lcp_ms, each.cls, each.tbt_ms].every((value) => Number.isFinite(value)),
    );
  if (!valid) {
    sink.warn("perf_unmeasured", "performance", "The lab probe wrote no readable measurement.");
    return;
  }
  for (const { page, lcp_ms, cls, tbt_ms } of pages as PerfPage[]) {
    const reading = `LCP ${Math.round(lcp_ms)} ms, CLS ${cls.toFixed(4)}, TBT ${Math.round(tbt_ms)} ms`;
    const over = [
      lcp_ms > PERF_BUDGET.lcp_ms && `LCP over ${PERF_BUDGET.lcp_ms} ms`,
      cls > PERF_BUDGET.cls && `CLS over ${PERF_BUDGET.cls}`,
      tbt_ms > PERF_BUDGET.tbt_ms && `TBT over ${PERF_BUDGET.tbt_ms} ms`,
    ].filter((each): each is string => typeof each === "string");
    if (over.length > 0) {
      sink.warn("perf_budget", "performance", `${page}: ${reading} (${over.join(", ")}).`);
    } else {
      sink.passed.push(`${page} within the lab budget: ${reading}`);
    }
  }
}

/** What health read from the field store (D156): each metric's p75 per device class, or why not. */
export type FieldReading = { summaries: readonly VitalSummary[] } | { error: string };

/** A p75 of fewer samples than this says more about one visit than about the site. */
export const FIELD_MIN_SAMPLES = 20;
/** Neon may be waking from idle; past this the store reads as unmeasured. */
const FIELD_TIMEOUT_MS = 15_000;

/** A read that answered, or why it did not. */
type Read<T> = T | { error: string };

/**
 * What health read from the Neon store, each part on its own so one failure keeps the others: the
 * field vitals, whether the site's shared rate counter has its table, and the stored config
 * documents when the config store is on. A top-level error means no connection; `configured` is
 * false when DATABASE_URL is not set.
 */
export type StoreReading =
  | { error: string; configured: boolean }
  | {
      field: FieldReading;
      rate_table: Read<boolean>;
      /** The week's client faults (D158), grouped. */
      faults?: Read<readonly ClientFaultGroup[] | null>;
      documents?: Read<readonly ConfigDocument[]>;
    };

/**
 * Reads the store the site writes (packages/engine/src/store/vitalsStore.ts, rateCounter.ts) and,
 * with `configStore`, the config documents (D149). Never throws: no URL, an error or no answer in
 * time is a reading that says why, with the URL taken out of it.
 */
export async function readStore(
  databaseUrl: string | undefined,
  now: Date,
  options: { configStore: boolean },
  connect: (url: string) => Promise<SqlClient> = connectConfigStore,
): Promise<StoreReading> {
  if (!databaseUrl) return { error: "DATABASE_URL is not set", configured: false };
  const why = (error: unknown) => ({
    error: redact(message(error), databaseSecrets(databaseUrl)),
  });
  // Neon may be waking from idle; past FIELD_TIMEOUT_MS a read is an error of its own.
  const within = async <T>(read: () => Promise<T>): Promise<Read<T>> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, fail) => {
      timer = setTimeout(
        () => fail(new Error(`no answer in ${FIELD_TIMEOUT_MS} ms`)),
        FIELD_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([read(), late]);
    } catch (error) {
      return why(error);
    } finally {
      clearTimeout(timer);
    }
  };
  const sql = await within(() => connect(databaseUrl));
  if ("error" in sql) return { ...sql, configured: true };
  const [summaries, rateTable, faults, documents] = await Promise.all([
    within(async () => {
      // The week's retention without traffic; a role that may only read still gets its reading.
      await pruneVitals(sql, now.getTime()).catch(() => undefined);
      return readVitals(sql, now.getTime());
    }),
    within(async () => {
      const [row] = await sql.query(
        "select to_regclass('rate_limit_counters') is not null as present",
      );
      return row?.present === true;
    }),
    // The week's client faults (D158), pruned like the vitals.
    within(async () => {
      await pruneClientFaults(sql, now.getTime()).catch(() => undefined);
      return readClientFaults(sql, now.getTime());
    }),
    options.configStore ? within(() => readConfigDocuments(sql)) : undefined,
  ]);
  return {
    field: Array.isArray(summaries) ? { summaries } : (summaries as { error: string }),
    rate_table: rateTable,
    faults,
    ...(documents ? { documents } : {}),
  };
}

/** Script blocks in 24 hours from this many reports on are a warning: an extension's one is not. */
export const SCRIPT_BLOCKS_PER_DAY = 3;
/** Client errors on one route in 24 hours from this many on are a warning (opaque ones not counted). */
export const CLIENT_ERRORS_PER_DAY = 20;
/** Server errors (a 5xx a site function answered) on one route in 24 hours from this many on warn. */
export const SERVER_FAULTS_PER_DAY = 3;
/** Functions Vercel killed (a timeout, a crash) on one route in 24 hours from this many on warn. */
export const PLATFORM_FAULTS_PER_DAY = 3;
/** CSP directives whose violation means a script did not run: a feature broken, or an injection. */
const SCRIPT_DIRECTIVES = new Set(["script-src", "script-src-elem"]);

/** Stored text as inline code in a GitHub issue, so an `@name` or a link in it does nothing. */
const code = (text: string): string => `\`${text.replace(/`/g, "") || "none"}\``;

/**
 * `client_faults` (D158), warnings only: the endpoint is open (D160), so anyone can forge a report,
 * extensions inject scripts the CSP blocks, and a deploy or an upstream blip (Speechify, Anthropic)
 * raises a burst of server errors. Judged over the last 24 hours across builds (content commits
 * redeploy several times a day), naming the builds: SCRIPT_BLOCKS_PER_DAY blocked scripts,
 * CLIENT_ERRORS_PER_DAY page errors on one route (the opaque "Script error." aside), or
 * SERVER_FAULTS_PER_DAY server faults (a 5xx a site function answered) or PLATFORM_FAULTS_PER_DAY
 * platform faults (a function Vercel killed, as the page saw it) on one route, naming the
 * route and its commonest message or step. No table yet is nothing measured: no finding, no pass.
 */
export function checkClientFaults(groups: readonly ClientFaultGroup[] | null, sink: Sink): void {
  if (groups === null) return;
  const day = groups.filter((group) => group.day > 0);
  const builds = (list: readonly ClientFaultGroup[]) =>
    [...new Set(list.map((group) => group.build || "unknown"))].map(code).join(", ");
  const blocks = day.filter(
    (group) => group.kind === "csp" && SCRIPT_DIRECTIVES.has(group.directive),
  );
  const blocked = blocks.reduce((sum, group) => sum + group.day, 0);
  if (blocked >= SCRIPT_BLOCKS_PER_DAY) {
    const top = [...blocks].sort((a, b) => b.day - a.day)[0];
    sink.warn(
      "client_faults",
      "security",
      `${blocked} blocked scripts in 24 hours, most on ${code(top?.page ?? "")} from ${code(top?.blocked ?? "")} (builds ${builds(blocks)}): a feature broken, or something injecting.`,
    );
  }
  /** Warns for each route whose faults in `list` reach `least` in 24 hours; whether any did. */
  const perRoute = (list: readonly ClientFaultGroup[], least: number, what: string): boolean => {
    const routes = new Map<string, ClientFaultGroup[]>();
    for (const group of list) routes.set(group.page, [...(routes.get(group.page) ?? []), group]);
    let any = false;
    for (const [route, alike] of routes) {
      const count = alike.reduce((sum, group) => sum + group.day, 0);
      if (count < least) continue;
      any = true;
      const top = [...alike].sort((a, b) => b.day - a.day)[0];
      sink.warn(
        "client_faults",
        "reliability",
        `${code(route)}: ${count} ${what} in 24 hours (builds ${builds(alike)}), most often ${code(top?.message ?? "")}.`,
      );
    }
    return any;
  };
  const pageErrors = day.filter(
    (group) =>
      (group.kind === "error" || group.kind === "rejection") &&
      group.message !== OPAQUE_SCRIPT_ERROR,
  );
  const clientWarned = perRoute(pageErrors, CLIENT_ERRORS_PER_DAY, "client errors");
  const serverWarned = perRoute(
    day.filter((group) => group.kind === "server"),
    SERVER_FAULTS_PER_DAY,
    "server errors",
  );
  // A function Vercel killed (a timeout, a crash), as the page that asked saw it.
  const platformWarned = perRoute(
    day.filter((group) => group.kind === "platform"),
    PLATFORM_FAULTS_PER_DAY,
    "functions Vercel ended",
  );
  if (blocked < SCRIPT_BLOCKS_PER_DAY && !clientWarned && !serverWarned && !platformWarned) {
    sink.passed.push("no run of blocked scripts, client, server or platform errors in 24 hours");
  }
}

/**
 * `store_degraded` (warning): with DATABASE_URL set, no connection, or the rate counter's check
 * failed. The site then counts its paid routes' caps per instance and drops field vitals, and says
 * nothing (apps/web rateLimit.ts, database.ts). A warning: Neon may be waking, and nothing breaks
 * for a reader. A missing counter table is no finding: the first capped request creates it.
 * Without DATABASE_URL there is no store: the field vitals are `field_unmeasured`, a warning, as is
 * a vitals read that failed on its own. The config documents are health.ts's to judge.
 */
export function checkStore(reading: StoreReading, sink: Sink): void {
  if ("error" in reading) {
    if (reading.configured) {
      sink.warn(
        "store_degraded",
        "reliability",
        `The Neon store did not connect: ${reading.error}. The site's rate caps fall back to per instance and field vitals are dropped.`,
      );
    } else {
      checkFieldVitals(reading, sink);
    }
    return;
  }
  if (typeof reading.rate_table === "boolean") {
    sink.passed.push(
      reading.rate_table
        ? "the store answers and holds the shared rate counter"
        : "the store answers; the first capped request creates the rate counter",
    );
  } else {
    sink.warn(
      "store_degraded",
      "reliability",
      `The rate counter's table could not be checked: ${reading.rate_table.error}. The site's rate caps may be counting per instance.`,
    );
  }
  checkFieldVitals(reading.field, sink);
  if (reading.faults && "error" in reading.faults) {
    sink.warn(
      "client_faults",
      "reliability",
      `The client faults store could not be read: ${reading.faults.error}. Page errors and blocked scripts went unjudged today.`,
    );
  } else if (reading.faults !== undefined) {
    checkClientFaults(reading.faults, sink);
  }
}

const FIELD_LABEL: Record<VitalMetric, string> = { lcp: "LCP", inp: "INP", cls: "CLS" };
const fieldValue = (metric: VitalMetric, value: number): string =>
  metric === "cls" ? value.toFixed(2) : `${Math.round(value)} ms`;

/**
 * Field Web Vitals (D156): each metric's 7-day p75 from real visits, per device class, against
 * Google's lines. Needs improvement is the warning `field_vitals`, poor the fault `field_vitals`,
 * which opens the health issue (nothing heals it). Phones are the site's readers, so too few phone
 * samples for a metric is `field_unmeasured`, never a pass; desktops are judged once they have
 * enough. No DATABASE_URL is `field_unmeasured` too (a store that would not answer is checkStore's fault). Daily: one query.
 */
export function checkFieldVitals(reading: FieldReading, sink: Sink): void {
  if ("error" in reading) {
    sink.warn(
      "field_unmeasured",
      "performance",
      `The field vitals store could not be read: ${reading.error}.`,
    );
    return;
  }
  const thin: string[] = [];
  for (const metric of VITAL_METRICS) {
    for (const device of VITAL_DEVICES) {
      const summary = reading.summaries.find(
        (each) => each.metric === metric && each.device === device,
      );
      if (!summary || summary.samples < FIELD_MIN_SAMPLES) {
        if (device === "mobile") thin.push(`${FIELD_LABEL[metric]} ${summary?.samples ?? 0}`);
        continue;
      }
      const [good, poor] = VITAL_THRESHOLDS[metric];
      const line = `field ${FIELD_LABEL[metric]} on ${device === "mobile" ? "phones" : "desktops"}: p75 ${fieldValue(metric, summary.p75)} over ${summary.samples} samples in ${VITALS_WINDOW_DAYS} days`;
      const rating = rateVital(metric, summary.p75);
      if (rating === "poor") {
        sink.fault(
          "field_vitals",
          "performance",
          `${line}, poor (over ${fieldValue(metric, poor)}).`,
        );
      } else if (rating === "needs-improvement") {
        sink.warn(
          "field_vitals",
          "performance",
          `${line}, needs improvement (over ${fieldValue(metric, good)}).`,
        );
      } else {
        sink.passed.push(`${line}, good`);
      }
    }
  }
  if (thin.length > 0) {
    sink.warn(
      "field_unmeasured",
      "performance",
      `Too few phone samples in ${VITALS_WINDOW_DAYS} days for a p75 (${FIELD_MIN_SAMPLES} needed): ${thin.join(", ")}.`,
    );
  }
}
