import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  episodeRelPath,
  loadModelRouting,
  PriceTable,
  parseEpisodeFile,
  parseSourceCatalog,
  ScheduleFile,
  SourcesUserFile,
  TopicsFile,
} from "@dispatch/core";
import {
  type EpisodeVoiceEnv,
  planEpisodeNarration,
  segmentMarksPath,
} from "../audio/segmentStore.js";
import { listEpisodeIds } from "../publish/publishEpisodes.js";
import { configChecks } from "./doctorOffline.js";
import { firstIssue, readFileIfPresent } from "./doctorTypes.js";

/**
 * The checks hardening round 3 added to `dispatch health` (docs/engineering/hardening.md): the
 * config files and episodes parse, and a run that died before it recorded anything. Each one reports
 * through the sink with a stable code, as health.ts's own checks do.
 */

export type HealthAspect =
  | "reliability"
  | "quality"
  | "cost"
  | "security"
  | "integrity";

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
const TIMEOUT_MS = 20_000;

function message(error: unknown): string {
  return error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error);
}

/** Config files with a core schema that `doctor` does not read; each may be absent. */
const CONFIG_SCHEMAS: Array<[string, (json: unknown) => unknown]> = [
  ["config/topics.json", (json) => TopicsFile.parse(json)],
  ["config/schedule.json", (json) => ScheduleFile.parse(json)],
  ["config/prices.json", (json) => PriceTable.parse(json)],
  ["config/source-catalog.json", (json) => parseSourceCatalog(json)],
  ["config/sources.user.json", (json) => SourcesUserFile.parse(json)],
];

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
 * One run of run.yml, as `gh run list --json
 * databaseId,status,conclusion,createdAt,startedAt,updatedAt,event,displayTitle` lists it (health.yml).
 * run.yml names a briefing run "run", a dry run "dry run" and a delete "delete <id>".
 */
export interface WorkflowRun {
  databaseId: number;
  status: string;
  conclusion: string | null;
  createdAt: string;
  /** When this attempt started; a completed run's `updatedAt` is when it ended. */
  startedAt?: string;
  updatedAt?: string;
  event?: string;
  displayTitle?: string;
}

/** A run older than this that died is left to `run_overdue`: the next run has had its chance. */
export const RUN_DIED_WINDOW_MS = 3 * DAY_MS;
/** run.yml's `run` job `timeout-minutes` (25); keep the two equal. */
export const RUN_TIMEOUT_MS = 25 * 60_000;
const DIED = new Set(["failure", "timed_out", "startup_failure"]);

const isBriefing = (run: WorkflowRun): boolean => (run.displayTitle ?? "run") === "run";

/**
 * GitHub reports a job killed at its `timeout-minutes` as `cancelled`, the same as a press that
 * collapsed into the pending run or one the owner stopped. Only a cancel that ran to the timeout
 * died; a shorter one was the owner's.
 */
function ranToTimeout(run: WorkflowRun): boolean {
  const ended = Date.parse(run.updatedAt ?? "");
  const started = Date.parse(run.startedAt ?? run.createdAt);
  return ended - started >= RUN_TIMEOUT_MS;
}

/**
 * `run_died`: a run.yml run that ended badly with no run record written after it started. A run
 * that fails inside the engine records `failed` (and reads as `run_failed`); one that dies before
 * (install, a timeout, a crash past the engine's own catch) wrote nothing, so the last record still
 * reads as the run before. Only a briefing run counts: a dry run or a delete never writes a record,
 * and healing starts a paid run. A briefing run under way that is newer than the one that died may
 * still record, so nothing is said until it ends.
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
  const died = runs
    .filter(
      (run) =>
        run.status === "completed" &&
        (DIED.has(run.conclusion ?? "") || (run.conclusion === "cancelled" && ranToTimeout(run))) &&
        isBriefing(run) &&
        now.getTime() - Date.parse(run.createdAt) < RUN_DIED_WINDOW_MS &&
        Date.parse(run.createdAt) > recorded,
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  if (died) {
    const after = Date.parse(died.createdAt);
    const healing = runs.some(
      (run) => run.status !== "completed" && isBriefing(run) && Date.parse(run.createdAt) > after,
    );
    if (healing) return;
    sink.fault(
      "run_died",
      "reliability",
      `Run ${died.databaseId} (${died.event ?? "run"}, ${died.createdAt}) ended ${died.conclusion} before it recorded an outcome.`,
    );
  } else if (runs.length > 0) {
    sink.passed.push("every recent run recorded its outcome");
  }
}
