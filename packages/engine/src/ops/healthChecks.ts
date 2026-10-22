import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  episodeRelPath,
  loadModelRouting,
  p75,
  parseEpisodeFile,
  parseSourceCatalog,
  PriceTable,
  ScheduleFile,
  SourcesUserFile,
  TopicsFile,
  VITAL_GOOD,
  VITAL_METRICS,
  type VitalMetric,
  type VitalSample,
  VitalsDay,
  vitalsPath,
} from "@dispatch/core";
import { type EpisodeVoiceEnv, planEpisodeNarration, segmentMarksPath } from "../audio/segmentStore.js";
import { listEpisodeIds } from "../publish/publishEpisodes.js";
import { configChecks } from "./doctorOffline.js";
import { firstIssue, readFileIfPresent } from "./doctorTypes.js";

/**
 * The checks hardening round 3 added to `dispatch health` (docs/engineering/hardening.md): the
 * config files and episodes parse, a run that died before it recorded anything, and real-user Web
 * Vitals. Each one reports through the sink with a stable code, as health.ts's own checks do.
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

/** One run of run.yml, as `gh run list --json databaseId,status,conclusion,createdAt,event` lists it. */
export interface WorkflowRun {
  databaseId: number;
  status: string;
  conclusion: string | null;
  createdAt: string;
  event?: string;
}

/** A run older than this that died is left to `run_overdue`: the next run has had its chance. */
export const RUN_DIED_WINDOW_MS = 3 * DAY_MS;
const DIED = new Set(["failure", "cancelled", "timed_out", "startup_failure"]);

/**
 * `run_died`: a run.yml run that ended badly with no run record written after it started. A run
 * that fails inside the engine records `failed` (and reads as `run_failed`); one that dies before
 * (install, a timeout, a cancel, a crash past the engine's own catch) wrote nothing, so the last
 * record still reads as the run before. Nothing is said while a run is under way.
 */
export function checkRunsDied(
  records: ReadonlyArray<{ at: string } | null>,
  runs: readonly WorkflowRun[],
  now: Date,
  sink: Sink,
): void {
  if (runs.some((run) => run.status !== "completed")) return;
  const recorded = Math.max(
    Number.NEGATIVE_INFINITY,
    ...records.flatMap((record) => (record ? [Date.parse(record.at)] : [])),
  );
  const died = runs
    .filter(
      (run) =>
        DIED.has(run.conclusion ?? "") &&
        now.getTime() - Date.parse(run.createdAt) < RUN_DIED_WINDOW_MS &&
        Date.parse(run.createdAt) > recorded,
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  if (died) {
    sink.fault(
      "run_died",
      "reliability",
      `Run ${died.databaseId} (${died.event ?? "run"}, ${died.createdAt}) ended ${died.conclusion} before it recorded an outcome.`,
    );
  } else if (runs.length > 0) {
    sink.passed.push("every recent run recorded its outcome");
  }
}

/** Fewer samples than this in a window say nothing about it. */
export const VITALS_MIN_SAMPLES = 5;
/** A p75 this much above the week before is a regression even inside "good"... */
export const VITALS_REGRESSION_RATIO = 1.25;
/** ...when it also moved by more than this, so a fast page jittering by a few ms says nothing. */
const VITALS_MIN_STEP: Record<VitalMetric, number> = { lcp: 300, inp: 50, cls: 0.02 };

const show = (metric: VitalMetric, value: number): string =>
  metric === "cls" ? value.toFixed(3) : `${Math.round(value)} ms`;

/**
 * `perf_regression` (a warning): the p75 of the last 24 hours of real-user LCP, INP or CLS is past
 * web.dev's "good", or 25% past the six days before it. The samples are /api/report's day files in
 * the public Blob store (vitalsStore.ts): eight reads a day, cache hits after the first.
 */
export async function checkVitals(
  base: string,
  get: HealthFetch,
  now: Date,
  sink: Sink,
): Promise<void> {
  const samples: VitalSample[] = [];
  for (let back = 0; back < 8; back++) {
    const day = new Date(now.getTime() - back * DAY_MS).toISOString().slice(0, 10);
    try {
      const answer = await get(`${base}/${vitalsPath(day)}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (answer.status !== 200) continue;
      const file = VitalsDay.safeParse(JSON.parse(await answer.text()));
      if (file.success) samples.push(...file.data.samples);
    } catch {
      // A day the store cannot answer for is a day without samples.
    }
  }
  const dayAgo = now.getTime() - DAY_MS;
  const last = samples.filter((sample) => sample.at > dayAgo && sample.at <= now.getTime());
  const before = samples.filter((sample) => sample.at <= dayAgo && sample.at > dayAgo - 7 * DAY_MS);
  if (last.length < VITALS_MIN_SAMPLES) {
    sink.passed.push(`Web Vitals: ${last.length} page loads in the last day, too few to judge`);
    return;
  }
  const shown: string[] = [];
  for (const metric of VITAL_METRICS) {
    const now75 = p75(last, metric);
    if (now75 === null) continue;
    shown.push(`${metric.toUpperCase()} ${show(metric, now75)}`);
    const was = before.length >= VITALS_MIN_SAMPLES ? p75(before, metric) : null;
    if (now75 > VITAL_GOOD[metric]) {
      sink.warn(
        "perf_regression",
        "performance",
        `${metric.toUpperCase()} p75 is ${show(metric, now75)} over the last day, past the good ${show(metric, VITAL_GOOD[metric])} (${last.length} page loads).`,
      );
    } else if (
      was !== null &&
      now75 > was * VITALS_REGRESSION_RATIO &&
      now75 - was > VITALS_MIN_STEP[metric]
    ) {
      sink.warn(
        "perf_regression",
        "performance",
        `${metric.toUpperCase()} p75 rose to ${show(metric, now75)} from ${show(metric, was)} the week before (${last.length} page loads).`,
      );
    }
  }
  sink.passed.push(`Web Vitals p75 over ${last.length} page loads: ${shown.join(", ")}`);
}
