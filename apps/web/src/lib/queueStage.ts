import type { GenerationRow } from "../types/contracts";
import { BRIEFING_STAGES, EPISODE_STAGES, NAMED_EPISODE_STAGES } from "./runStages";

/**
 * What a run is doing, in the few kinds the queue has a word and an icon for (Queue.astro holds both).
 * The stage lists differ by run (a briefing's seven, an episode's six named or three plain), so the
 * kind is read from the position in the list the run reports, never from its label. Pure, so the
 * queue's script carries only the DOM.
 */
export type StageKind =
  | "wait"
  | "gather"
  | "choose"
  | "write"
  | "art"
  | "check"
  | "publish"
  | "voices"
  | "finish";

const BRIEFING: readonly StageKind[] = [
  "wait",
  "gather",
  "choose",
  "write",
  "check",
  "publish",
  "finish",
];
const NAMED: readonly StageKind[] = ["gather", "write", "art", "publish", "voices", "finish"];
const PLAIN: readonly StageKind[] = ["wait", "write", "finish"];

/** The kind of stage a run is in. A run waiting for a slot is waiting; a list of an unknown shape is plain writing. */
export function stageKind(
  row: Pick<GenerationRow, "state" | "what" | "stage" | "stages">,
): StageKind {
  if (row.state !== "running") return "wait";
  const list =
    row.what === "briefing"
      ? row.stages === BRIEFING_STAGES.length
        ? BRIEFING
        : null
      : row.stages === NAMED_EPISODE_STAGES.length
        ? NAMED
        : row.stages === EPISODE_STAGES.length
          ? PLAIN
          : null;
  return list?.[row.stage] ?? "write";
}

/** The word to show at `tick`: the pool is walked in order, one step each time the queue's clock ticks. */
export function pickWord(pool: readonly string[], tick: number): string {
  return pool.length ? (pool[tick % pool.length] ?? "") : "";
}
