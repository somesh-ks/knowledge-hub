import type { PodcastRequest } from "@dispatch/core";
import type { Logger } from "../context.js";
import { BudgetExceededError, describeError } from "../llm/errors.js";
import { checkTurns } from "./check.js";
import { charCount, fitToBudget, mergeNeighbours } from "./fit.js";
import { ScriptReply } from "./nebiusScriptWriter.js";
import {
  partChars,
  reachableChars,
  scriptFloorChars,
  scriptTargetChars,
  wordsFor,
} from "./plan.js";
import { PodcastError, type PodcastStory, type ScriptTurn, type ScriptWriter } from "./types.js";

/** Attempts at a valid reply: the first call and two retries that name what was wrong. */
const ATTEMPTS = 3;

/** Said when the opening turn was dropped by the checks, so the show is always named. */
const FALLBACK_OPENING = "This is Singularity.";

export interface ScriptDeps {
  writer: ScriptWriter;
  request: PodcastRequest;
  stories: readonly PodcastStory[];
  budget_chars: number;
  /** The listener's changes to a previous version; reaches the writer as delimited text. */
  feedback?: string | undefined;
  log?: Logger;
}

export interface ScriptResult {
  turns: ScriptTurn[];
  rewritten: number;
  dropped_turns: number;
  /** Characters under the floor (80% of the budget) the kept script still is; 0 when it reaches it. */
  short_by_chars: number;
  dropped_stories: number;
  /** How many times the writer was asked for a script (the first call and any retries). */
  writer_calls: number;
  /** The problems found in the last reply that was sent back; empty when every reply was accepted. */
  last_problems: string[];
}

/** Spoken text has no em dashes or stray whitespace; the model sometimes sends both anyway. */
function cleanText(text: string): string {
  return text
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

type Validated = { ok: true; turns: ScriptTurn[] } | { ok: false; problems: string[] };

/**
 * Apply the format rules to a raw reply. Solo formats are coerced to speaker "a", because the
 * speaker label carries no information there. Everything else that is wrong is reported, so the
 * retry can say what to fix.
 */
export function validateReply(
  raw: unknown,
  request: PodcastRequest,
  stories: readonly PodcastStory[],
): Validated {
  const parsed = ScriptReply.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      problems: [
        `The reply is not the required JSON shape (${issue?.path.join(".") || "(root)"}: ${issue?.message ?? "invalid"}).`,
      ],
    };
  }
  const known = new Set(stories.map((story) => story.item_id));
  const problems: string[] = [];
  const turns: ScriptTurn[] = [];
  const unknownIds = new Set<string>();
  for (const row of parsed.data.turns) {
    const text = cleanText(row.text);
    if (text === "") continue;
    const given = row.item_id ? row.item_id : undefined;
    // A model that drops or swaps a character of an id has still said which story it means.
    const itemId = given === undefined || known.has(given) ? given : closestId(given, known);
    if (itemId !== undefined && !known.has(itemId)) unknownIds.add(itemId);
    turns.push({
      speaker: request.format === "discussion" ? row.speaker : "a",
      text,
      ...(itemId === undefined ? {} : { item_id: itemId }),
    });
  }
  if (unknownIds.size > 0) {
    problems.push(
      `item_id values that are not in the stories: ${[...unknownIds].slice(0, 3).join(", ")}. Copy ids exactly.`,
    );
  }
  if (turns.length < 3)
    problems.push("The script is too short: it needs an opening, stories and a sign-off.");
  if (!turns.some((turn) => turn.item_id !== undefined)) {
    problems.push('No turn carries an "item_id"; set it on every turn about a story.');
  }
  if (!/singularity/i.test(turns[0]?.text ?? "")) {
    problems.push("The opening turn must say that the show is Singularity.");
  }
  if (request.format === "discussion") {
    if (!turns.some((turn) => turn.speaker === "b")) {
      problems.push('A discussion needs both hosts; speaker "b" never speaks.');
    }
    if (turns[0]?.speaker === "b") problems.push('The first turn must be speaker "a".');
  }
  return problems.length > 0
    ? { ok: false, problems }
    : { ok: true, turns: mergeNeighbours(turns) };
}

/** Ids of this many leading characters in common are taken to be the same id, mistyped. */
const ID_PREFIX_MATCH = 8;

/**
 * The one known id a mistyped id can only mean: the same leading characters, and no other known id
 * shares them. Anything less certain is returned as given, and reported.
 */
export function closestId(given: string, known: ReadonlySet<string>): string {
  if (given.length < ID_PREFIX_MATCH) return given;
  const head = given.slice(0, ID_PREFIX_MATCH);
  const matches = [...known].filter((id) => id.startsWith(head));
  return matches.length === 1 && matches[0] !== undefined ? matches[0] : given;
}

/** How many characters a script falls short of the floor (80% of the budget); 0 when it reaches it. */
export function shortByChars(turns: readonly ScriptTurn[], budget: number): number {
  return Math.max(0, scriptFloorChars(budget) - charCount(turns));
}

/**
 * The problem to send back when a valid reply is under the floor: how short it is and which
 * stories carry the least text, so the retry adds depth where it is thinnest.
 */
function tooShortProblem(
  turns: readonly ScriptTurn[],
  stories: readonly PodcastStory[],
  budget: number,
  request: PodcastRequest,
): string {
  const used = new Map<string, number>();
  for (const turn of turns) {
    if (turn.item_id) used.set(turn.item_id, (used.get(turn.item_id) ?? 0) + turn.text.length);
  }
  const thinnest = [...stories]
    .sort((a, b) => (used.get(a.item_id) ?? 0) - (used.get(b.item_id) ?? 0))
    .slice(0, 3)
    .map((story) => `"${story.headline}"`);
  const parts = partChars(budget, stories.length, request.format, request.length_minutes);
  const sizes =
    request.format === "headlines"
      ? `Every story needs about ${wordsFor(parts.nugget)} words.`
      : `Every deep dive needs about ${wordsFor(parts.deep_dive)} words and every nugget about ${wordsFor(parts.nugget)}.`;
  return `The script is too short by about ${wordsFor(shortByChars(turns, budget))} words: it has about ${wordsFor(charCount(turns))} and needs at least ${wordsFor(scriptFloorChars(budget))} (aim for ${wordsFor(scriptTargetChars(budget))}). ${sizes} Add depth to these stories first: ${thinnest.join("; ")}. Use only the facts in each story block; do not pad or repeat a fact.`;
}

interface Requested {
  turns: ScriptTurn[];
  calls: number;
  rejected: string[];
}

async function requestTurns(deps: ScriptDeps): Promise<Requested> {
  let problems: string[] = [];
  let rejected: string[] = [];
  // The longest reply that was valid but short: a short true episode beats none.
  let short: ScriptTurn[] | null = null;
  const reach = reachableChars(
    deps.budget_chars,
    deps.stories.length,
    deps.request.format,
    deps.request.length_minutes,
  );
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const raw = await deps.writer.writeScript(
        {
          request: deps.request,
          stories: deps.stories,
          budget_chars: deps.budget_chars,
          ...(deps.feedback ? { feedback: deps.feedback } : {}),
        },
        problems,
      );
      const result = validateReply(raw, deps.request, deps.stories);
      if (result.ok) {
        // Held to what the stories can carry, not to a length they cannot fill.
        if (shortByChars(result.turns, reach) === 0) {
          return { turns: result.turns, calls: attempt, rejected };
        }
        // Keep the longest of the short replies: a rewrite is not always longer.
        if (!short || charCount(result.turns) > charCount(short)) short = result.turns;
        problems = [tooShortProblem(result.turns, deps.stories, reach, deps.request)];
      } else {
        problems = result.problems;
      }
    } catch (error) {
      if (error instanceof BudgetExceededError) throw error;
      problems = [`The last call failed: ${describeError(error)}`];
    }
    rejected = problems;
    deps.log?.warn("The script reply was not usable", { attempt, problems });
  }
  if (short) return { turns: short, calls: ATTEMPTS, rejected };
  throw new PodcastError(`The writer did not return a usable script. ${problems.join(" ")}`);
}

/**
 * One writer call, validated and held to the stories: unknown story ids and invented numbers are
 * dealt with, the show is always named in the opening, and the length is enforced in code.
 */
export async function generateScript(deps: ScriptDeps): Promise<ScriptResult> {
  const { turns: raw, calls, rejected } = await requestTurns(deps);
  const checked = await checkTurns({
    request: deps.request,
    turns: raw,
    stories: deps.stories,
    writer: deps.writer,
    ...(deps.log ? { log: deps.log } : {}),
  });
  let turns = mergeNeighbours(checked.turns);
  if (!/singularity/i.test(turns[0]?.text ?? "")) {
    turns = [{ speaker: "a", text: FALLBACK_OPENING }, ...turns];
  }
  const fitted = fitToBudget(turns, deps.budget_chars);
  const shortBy = shortByChars(fitted.turns, deps.budget_chars);
  if (shortBy > 0) {
    deps.log?.warn("The script is shorter than the length asked for", {
      short_by_chars: shortBy,
      chars: charCount(fitted.turns),
      budget_chars: deps.budget_chars,
    });
  }
  return {
    turns: fitted.turns,
    rewritten: checked.rewritten,
    dropped_turns: checked.dropped,
    dropped_stories: fitted.dropped_stories,
    short_by_chars: shortBy,
    writer_calls: calls,
    last_problems: rejected,
  };
}
