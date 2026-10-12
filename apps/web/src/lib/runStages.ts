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
  "Writing the briefing",
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
  const making = steps.some((step) => step.name === EPISODE_STEP && step.status !== "queued");
  const stage = making ? 1 : 0;
  return { stage, stages: EPISODE_STAGES.length, label: EPISODE_STAGES[stage] ?? "" };
}

/** The stage a finished, successful run leaves the page in: waiting for the new page. */
export function updatingStage(kind: "briefing" | "episode"): StageInfo {
  const briefing = kind === "briefing";
  const stages = briefing ? BRIEFING_STAGES.length : EPISODE_STAGES.length;
  return {
    stage: stages - 1,
    stages,
    label: briefing ? BRIEFING_UPDATING_LABEL : UPDATING_LABEL,
  };
}
