import type { GenerateStep } from "../types/contracts";

/**
 * The stages a run goes through, in the words the page shows. One pure module, so the status route
 * and its tests share it. The last stage of both lists is the wait for the site to redeploy after
 * the workflow has committed; the workflow cannot see it, the page does.
 */

/** A new episode's last stage: the site redeploys with it, and the Library lists it. */
export const UPDATING_LABEL = "Adding it to your Library";

/** A briefing's last stage: it lands on Today, not in the Library. */
export const BRIEFING_UPDATING_LABEL = "Updating the site";

/** A briefing (run.yml), one stage per step of the workflow. */
export const BRIEFING_STAGES = [
  "Checking the schedule",
  "Gathering stories from your sources",
  "Choosing what matters",
  "Writing the podcast",
  "Checking the facts",
  "Publishing",
  BRIEFING_UPDATING_LABEL,
] as const;

/**
 * An episode (podcast.yml) as the workflow is today: the whole episode is one step, "Podcast", so
 * gathering, writing and checking cannot be told apart and are not shown apart.
 */
export const EPISODE_STAGES = ["Getting ready", "Making the episode", UPDATING_LABEL] as const;

/** The name of the step that makes the episode in podcast.yml. */
export const EPISODE_STEP = "Podcast";

/**
 * An episode whose workflow reports named steps (2026-10-25): one stage per step, then the wait
 * for the site. The step names are the stage names and the keys of STAGE_IDS.
 */
export const NAMED_EPISODE_STEPS = [
  "Gathering stories",
  "Writing the script",
  "Cover art",
  "Publishing",
  "Recording voices",
] as const;
export const NAMED_EPISODE_STAGES = [...NAMED_EPISODE_STEPS, UPDATING_LABEL] as const;

/** The id the status route sends as `failed_stage`, and in `kept`, for each named step. */
export const STAGE_IDS: Record<string, string> = {
  "Gathering stories": "gathering",
  "Writing the script": "script",
  "Cover art": "cover",
  "Recording voices": "voices",
  Publishing: "publishing",
};

/**
 * What a failed briefing says about the step it stopped in (the status route's `step`): the
 * sentence for the card. A briefing is published only by its last step, so a failure before it
 * leaves the earlier briefing as it was; one in it may or may not have landed.
 */
const BRIEFING_FAILED: Record<GenerateStep, string> = {
  waiting: "The podcast couldn't start.",
  reading: "The stories couldn't be gathered.",
  judging: "The stories couldn't be chosen.",
  writing: "The podcast couldn't be written.",
  checking: "The facts couldn't be checked.",
  publishing: "The podcast couldn't be published.",
};

/** Look up a briefing step's failure line, returning null when the lookup finds no sentence. */
export function briefingFailureLine(step: unknown): string | null {
  const sentence =
    typeof step === "string" ? (BRIEFING_FAILED as Record<string, string>)[step] : undefined;
  if (!sentence) return null;
  // The job's recovery step pushes again after a failed publish, so that briefing may have landed.
  return step === "publishing"
    ? `${sentence} It may still have landed; check the podcast before trying again.`
    : `${sentence} Nothing was changed.`;
}

/** What each stage leaves behind when it finishes, by `kept` id, in the words of a sentence. */
const KEPT_WORDS: Record<string, string> = {
  script: "the script",
  cover: "the cover art",
  voices: "the voices",
};

const FAILED_SENTENCES: Record<string, string> = {
  gathering: "The stories couldn't be gathered.",
  script: "The script couldn't be written.",
  cover: "The cover art couldn't be made.",
  voices: "The voices couldn't be recorded.",
  publishing: "The episode couldn't be published.",
};

/**
 * What failed and what was kept, as one plain sentence ("The voices couldn't be recorded. The script
 * is saved."), or null for a stage with no sentence of its own (the page then uses its general line).
 */
export function failureLine(failedStage: unknown, kept: unknown): string | null {
  const sentence = typeof failedStage === "string" ? FAILED_SENTENCES[failedStage] : undefined;
  if (!sentence) return null;
  const saved = (Array.isArray(kept) ? kept : [])
    .map((id) => KEPT_WORDS[String(id)])
    .filter((words): words is string => Boolean(words));
  if (saved.length === 0) return sentence;
  const list = saved.length > 1 ? `${saved.slice(0, -1).join(", ")} and ${saved.at(-1)}` : saved[0];
  const text = `${list} ${saved.length > 1 ? "are" : "is"} saved.`;
  return `${sentence} ${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** What state/podcast-timings.json times for each run, in the order of NAMED_EPISODE_STAGES. */
export interface TimedRun {
  format: string;
  length_minutes: number;
  stages: { select?: number; script?: number; cover?: number; publish?: number };
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

/**
 * The usual length of each stage of NAMED_EPISODE_STAGES: the median of the last 10 runs of the same
 * format and length, or of the same format when fewer than 3 match. The voices and the wait for the
 * site are untimed (null), so the page shows their names alone. `runs` are oldest first.
 */
export function medianEstimates(
  runs: readonly TimedRun[],
  format: string,
  length: number,
): (number | null)[] | null {
  const same = runs.filter((run) => run.format === format);
  const exact = same.filter((run) => run.length_minutes === length);
  const chosen = (exact.length >= 3 ? exact : same).slice(-10);
  if (chosen.length === 0) return null;
  const of = (key: keyof TimedRun["stages"]) => {
    const values = chosen
      .map((run) => run.stages[key])
      .filter((value): value is number => typeof value === "number" && value > 0);
    return values.length ? median(values) : null;
  };
  return [of("select"), of("script"), of("cover"), of("publish"), null, null];
}

/** The current stage is "slow" once it has run this many times its usual length. */
export const SLOW_FACTOR = 1.5;

export type TimeLeft = { kind: "none" } | { kind: "slow" } | { kind: "left"; minutes: number };

/**
 * How long is left, from the usual length of each stage (`stage_estimates_ms`, matching the stages)
 * less the time already spent in the current one, plus the stages after it. Past 1.5 times the
 * current stage's estimate the run is slow. No estimate for the current stage: nothing to say.
 */
export function timeLeft(
  stage: number,
  estimates: readonly unknown[] | undefined,
  elapsedInStageMs: number,
): TimeLeft {
  const usual = (index: number) => {
    const value = estimates?.[index];
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
  };
  const current = usual(stage);
  if (!current) return { kind: "none" };
  const spent = Math.max(0, elapsedInStageMs);
  if (spent > current * SLOW_FACTOR) return { kind: "slow" };
  let left = Math.max(0, current - spent);
  for (let index = stage + 1; index < (estimates?.length ?? 0); index += 1) left += usual(index);
  return { kind: "left", minutes: Math.max(1, Math.ceil(left / 60_000)) };
}

export interface StageInfo {
  /** Zero-based index of the current stage. */
  stage: number;
  /** How many stages the run has, the redeploy included. */
  stages: number;
  label: string;
}

const BRIEFING_INDEX: Record<GenerateStep, number> = {
  waiting: 0,
  reading: 1,
  judging: 2,
  writing: 3,
  checking: 4,
  publishing: 5,
};

export function briefingStage(step: GenerateStep | null): StageInfo {
  const stage = step ? BRIEFING_INDEX[step] : 0;
  return { stage, stages: BRIEFING_STAGES.length, label: BRIEFING_STAGES[stage] ?? "" };
}

interface StepLike {
  name: string;
  status: string;
}

/** Before the Podcast step has started the run is getting ready; from then on it is making the episode. */
export function episodeStage(steps: readonly StepLike[]): StageInfo {
  // A workflow with named steps has a stage for each: the latest one that has started.
  if (steps.some((step) => step.name in STAGE_IDS)) {
    const started = steps
      .filter((step) => step.status !== "queued")
      .map((step) =>
        NAMED_EPISODE_STEPS.indexOf(step.name as (typeof NAMED_EPISODE_STEPS)[number]),
      );
    const stage = Math.max(0, ...started);
    return {
      stage,
      stages: NAMED_EPISODE_STAGES.length,
      label: NAMED_EPISODE_STAGES[stage] ?? "",
    };
  }
  const making = steps.some((step) => step.name === EPISODE_STEP && step.status !== "queued");
  const stage = making ? 1 : 0;
  return { stage, stages: EPISODE_STAGES.length, label: EPISODE_STAGES[stage] ?? "" };
}

/** The stage a finished, successful run leaves the page in: waiting for the new page. */
export function updatingStage(kind: "briefing" | "episode", named = false): StageInfo {
  const briefing = kind === "briefing";
  const stages = briefing
    ? BRIEFING_STAGES.length
    : named
      ? NAMED_EPISODE_STAGES.length
      : EPISODE_STAGES.length;
  return {
    stage: stages - 1,
    stages,
    label: briefing ? BRIEFING_UPDATING_LABEL : UPDATING_LABEL,
  };
}
