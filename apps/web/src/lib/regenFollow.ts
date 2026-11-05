import { type Hints, hintsFor } from "./regenHints";
import { REGEN_LENGTHS } from "./regenLength";

/**
 * What the Regenerate controls do as the comment changes (D371). The comment is the input, the
 * controls follow it both ways: a control appears when the words call for it and goes when they no
 * longer do, and the values a model proposes are set on controls the listener has not touched.
 * Client-safe, pure.
 */
export interface Values {
  length: "shorter" | "longer" | null;
  add: string[];
}

/** What the models said about the current words; empty until they answer. */
export interface Answer {
  hints: Hints;
  values: Values;
}

export const NO_ANSWER: Answer = {
  hints: { length: false, topics: false },
  values: { length: null, add: [] },
};

/** The controls the comment calls for: its words, Jev, or a value Haiku proposed. */
export function wantedControls(text: string, labels: readonly string[], answer: Answer): Hints {
  const words = hintsFor(text, labels);
  return {
    length: words.length || answer.hints.length || answer.values.length !== null,
    topics: words.topics || answer.hints.topics || answer.values.add.length > 0,
  };
}

/** One step along the lengths on offer, from the one asked; the end of the list stays put. */
export function stepLength(from: number, direction: "shorter" | "longer"): number {
  const at = REGEN_LENGTHS.indexOf(from as (typeof REGEN_LENGTHS)[number]);
  if (at < 0) return from;
  return (
    REGEN_LENGTHS[
      Math.max(0, Math.min(REGEN_LENGTHS.length - 1, at + (direction === "longer" ? 1 : -1)))
    ] ?? from
  );
}

/** The length an untouched control shows: the asked one, a step along when the comment asks. */
export function desiredLength(asked: number, values: Values): number {
  return values.length ? stepLength(asked, values.length) : asked;
}

/** Whether an untouched category is ticked: as it was made, or ticked because the comment wants it. */
export function desiredChip(label: string, madeOn: boolean, values: Values): boolean {
  return madeOn || values.add.includes(label);
}
