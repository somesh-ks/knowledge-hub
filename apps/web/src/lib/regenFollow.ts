import { autoStories } from "@singularity/core/storyCount";
import { type Hints, hintsFor } from "./regenHints";
import { REGEN_LENGTHS } from "./regenLength";
import { stepStories } from "./storyOptions";

/**
 * What the Regenerate controls do as the comment changes (D371). The comment is the input, the
 * controls follow it both ways: a control appears when the words call for it and goes when they no
 * longer do, and the values a model proposes are set on controls the listener has not touched.
 * Client-safe, pure.
 */
export interface Values {
  length: "shorter" | "longer" | null;
  /** The story count, a step from what aired (D377). */
  stories: "more" | "fewer" | null;
  add: string[];
}

/** What the models said about the current words; empty until they answer. */
export interface Answer {
  hints: Hints;
  values: Values;
}

export const NO_ANSWER: Answer = {
  hints: { length: false, topics: false, stories: false },
  values: { length: null, stories: null, add: [] },
};

/** The controls the comment calls for: its words, Jev, or a value Haiku proposed. */
export function wantedControls(
  text: string,
  labels: readonly string[],
  answer: Answer,
  /** The length asked and the stories aired, when the sheet knows them: a full length shows Length. */
  asked = Number.NaN,
  aired = Number.NaN,
): Hints {
  const words = hintsFor(text, labels);
  return {
    // The words that move the length show its control, so a value it sends is never hidden.
    length:
      words.length ||
      (Number.isFinite(asked) && desiredLength(asked, answer.values, text, aired) !== asked) ||
      wordLength(text) !== null ||
      answer.hints.length ||
      answer.values.length !== null,
    topics: words.topics || answer.hints.topics || answer.values.add.length > 0,
    stories: words.stories || wordStories(text) !== null || answer.values.stories !== null,
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

// "More stories about AI" or "in Sports" asks for a topic, "no more stories" and "no longer news" for
// nothing, and "shorter intro" for one part: none of them moves the story count or the length. "More
// stories in it" moves the count (D377): the length no longer sets it.
const TOPIC = String.raw`(?!\s+(?:about|on|from|around|regarding|covering)\b|\s+in\s+(?!(?:it|this|each|the\s+(?:episode|podcast|briefing|show))\b))`;
const PART = String.raw`(?!\s+(?:intro|introduction|opening|outro|ending|sign-off|summaries|sentences|turns|bridges)\b)`;
const WANTS_LONGER = new RegExp(
  String.raw`\b(?:(?<!\b(?:no|any)\s)longer${PART}|too short|more (?:time|depth|detail))\b`,
  "i",
);
const WANTS_SHORTER = new RegExp(
  String.raw`\b(?:shorter${PART}|briefer${PART}|too long|dragged)\b`,
  "i",
);
const WANTS_MORE = new RegExp(
  String.raw`\b(?:(?<!\bno\s)(?:more|extra|additional)\s+(?:stories|story|items|news|coverage)${TOPIC}|not enough (?:stories|news|coverage)|too few (?:stories|items))\b`,
  "i",
);
const WANTS_FEWER = new RegExp(
  String.raw`\b(?:(?:fewer|less)\s+(?:stories|story|items|news)${TOPIC}|too many (?:stories|items))\b`,
  "i",
);

/** One of two directions the words alone ask for: null when they ask for both or neither. */
function wayOf<T>(text: string, up: RegExp, down: RegExp, ways: readonly [T, T]): T | null {
  const a = up.test(text);
  const b = down.test(text);
  return a === b ? null : a ? ways[0] : ways[1];
}

/**
 * What the words alone ask of the length. This answers at once and without a model, so the length
 * follows the comment even when Haiku is slow, rate-limited or wrong.
 */
export function wordLength(text: string): "shorter" | "longer" | null {
  return wayOf(text, WANTS_LONGER, WANTS_SHORTER, ["longer", "shorter"] as const);
}

/**
 * What the words alone ask of the story count (D377). It used to step the length, since the length
 * set the count; 2026-11-06 "More stories" was sent at the length it was made at and aired 12 again.
 */
export function wordStories(text: string): "more" | "fewer" | null {
  return wayOf(text, WANTS_MORE, WANTS_FEWER, ["more", "fewer"] as const);
}

/**
 * The length an untouched control shows: the asked one, a step along when the comment asks. What
 * Haiku proposed wins; the words decide when it has not answered. More stories than `aired` that
 * the asked length cannot hold take a longer one too, so the ask is never sent unchanged (D377).
 */
export function desiredLength(
  asked: number,
  values: Values,
  text = "",
  aired = Number.NaN,
): number {
  const direction = values.length ?? wordLength(text);
  if (direction) return stepLength(asked, direction);
  const full =
    (values.stories ?? wordStories(text)) === "more" && stepStories(aired, "more", asked) <= aired;
  return full ? stepLength(asked, "longer") : asked;
}

/**
 * The count an untouched Stories control shows: a step from what aired when the comment asks for
 * more or fewer, else "" (Auto, which sends nothing), as it is when the step lands on Auto's count.
 * What Haiku proposed wins.
 */
export function desiredStories(aired: number, minutes: number, values: Values, text = ""): string {
  const way = values.stories ?? wordStories(text);
  if (!way || !Number.isFinite(aired)) return "";
  // A step that lands on Auto's count is Auto: the list offers that count only as Auto.
  const count = stepStories(aired, way, minutes);
  return count === autoStories(minutes) ? "" : String(count);
}

/** Whether an untouched category is ticked: as it was made, or ticked because the comment wants it. */
export function desiredChip(label: string, madeOn: boolean, values: Values): boolean {
  return madeOn || values.add.includes(label);
}
