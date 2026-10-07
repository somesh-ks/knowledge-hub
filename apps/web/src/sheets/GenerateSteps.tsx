import type { GenerateStep } from "../types/contracts";
import { buildStepViews, type RunPhase } from "./generate/generateSteps";

interface GenerateStepsProps {
  phase: RunPhase;
  current: GenerateStep | null;
  failedAt: GenerateStep | null;
}

/**
 * The progress list: one row per step, with a mark the stylesheet draws from data-state. Waiting is
 * a hollow ring, in progress a turning ring, done is filled green, failed is filled in danger. The
 * state word is always written, so the list reads without color.
 */
export default function GenerateSteps({ phase, current, failedAt }: GenerateStepsProps) {
  const views = buildStepViews(phase, current, failedAt);
  return (
    // biome-ignore lint/a11y/noRedundantRoles: Safari drops list semantics under list-style: none
    <ol className="run-steps" role="list" aria-label="Progress">
      {views.map((view) => (
        <li key={view.step} className="run-step" data-state={view.state}>
          <span>{view.label}</span>
          <span className="run-step-state">{view.stateWord}</span>
        </li>
      ))}
    </ol>
  );
}
