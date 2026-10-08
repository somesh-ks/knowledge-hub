import type { Item, JudgmentEntry } from "@dispatch/core";

/** Why one item received no judgment. The run continues without it. */
export interface JudgeFailure {
  itemId: string;
  reason: string;
}

/**
 * Turns candidate items into judgments (category probabilities, craft depth, launch scale and
 * flags). Scoring and
 * thresholds live in code, never here. An item the judge cannot answer yields no entry; the
 * failure is reported through the implementation's `onFailure` hook, and `judge` never throws
 * for a single item.
 */
export interface Judge {
  /** Short name for logs: "jev", "nebius", "fallback". */
  readonly name: string;
  /** Model id used in cache keys and stored in each entry. */
  readonly model: string;
  /** Hash of the question definitions. Changes when the questions change. */
  readonly questionsHash: string;
  judge(items: Item[]): Promise<JudgmentEntry[]>;
}
