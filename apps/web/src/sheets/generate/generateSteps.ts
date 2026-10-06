import { GENERATE_STEPS, type GenerateStep } from "../../types/contracts";

export const STEP_LABELS: Record<GenerateStep, string> = {
  waiting: "Waiting for a slot",
  reading: "Reading sources",
  judging: "Judging",
  writing: "Writing",
  checking: "Checking",
  publishing: "Publishing",
};

/** For "The run failed while writing". */
const STEP_ACTIVITY: Record<GenerateStep, string> = {
  waiting: "waiting for a slot",
  reading: "reading sources",
  judging: "judging",
  writing: "writing",
  checking: "checking",
  publishing: "publishing",
};

export type StepState = "pending" | "active" | "done" | "failed";
export type RunPhase = "running" | "published" | "nothing" | "gated" | "failed";

export interface StepView {
  step: GenerateStep;
  label: string;
  state: StepState;
  /** The state is always written out, so the list reads without color. */
  stateWord: "" | "In progress" | "Done" | "Failed";
}

const STATE_WORD: Record<StepState, StepView["stateWord"]> = {
  pending: "",
  active: "In progress",
  done: "Done",
  failed: "Failed",
};

/**
 * The progress list, drawn in the rail's grammar. A run that is queued has no step yet, which
 * reads as "Waiting for a slot" in progress. A finished run that did not fail shows every step
 * done, including "Nothing cleared the bar.", because the pipeline did complete.
 */
export function buildStepViews(
  phase: RunPhase,
  current: GenerateStep | null,
  failedAt: GenerateStep | null,
): StepView[] {
  const currentIndex = current ? GENERATE_STEPS.indexOf(current) : 0;
  const failedIndex = failedAt ? GENERATE_STEPS.indexOf(failedAt) : currentIndex;
  return GENERATE_STEPS.map((step, index) => {
    let state: StepState = "pending";
    if (phase === "published" || phase === "nothing" || phase === "gated") state = "done";
    else if (phase === "failed") {
      if (index < failedIndex) state = "done";
      else if (index === failedIndex) state = "failed";
    } else if (index < currentIndex) state = "done";
    else if (index === currentIndex) state = "active";
    return { step, label: STEP_LABELS[step], state, stateWord: STATE_WORD[state] };
  });
}

export function failureTitle(failedAt: GenerateStep | null): string {
  return failedAt ? `The run failed while ${STEP_ACTIVITY[failedAt]}` : "The run failed";
}

/** What a screen reader hears when the active step changes. */
export function stepAnnouncement(step: GenerateStep, isFirst: boolean): string {
  return isFirst ? `Generating. ${STEP_LABELS[step]}.` : `${STEP_LABELS[step]}.`;
}
