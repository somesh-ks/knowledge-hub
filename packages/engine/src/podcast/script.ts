import type { PodcastRequest } from "@singularity/core";
import type { Logger } from "../context.js";
import { BudgetExceededError, describeError } from "../llm/errors.js";
import type { Taste } from "../profile/tasteNote.js";
import { checkTurns } from "./check.js";
import { charCount, fitToBudget, mergeNeighbours } from "./fit.js";
import { ScriptReply } from "./llmScriptWriter.js";
import {
  partChars,
  reachableChars,
  scriptAcceptChars,
  scriptFloorChars,
  scriptTargetChars,
  wordsFor,
} from "./plan.js";
import type { ScriptShape } from "./structure.js";
import { PodcastError, type PodcastStory, type ScriptTurn, type ScriptWriter } from "./types.js";

/** Attempts at a valid reply: the first call and two retries that name what was wrong. */
const ATTEMPTS = 3;

/**
 * No new script attempt starts after this long, and every writer call (its own retries included)
 * ends by then, so a stalled provider cannot use up the 15 minute job.
 */
export const SCRIPT_TIME_LIMIT_MS = 8 * 60_000;

/** Said when the opening turn was dropped by the checks, so the show is always named. */
const FALLBACK_OPENING = "This is Singularity.";

export interface ScriptDeps {
  writer: ScriptWriter;
  request: PodcastRequest;
  stories: readonly PodcastStory[];
  budget_chars: number;
  /** The listener's changes to a previous version; reaches the writer as delimited text. */
  feedback?: string | undefined;
  /** What the listener liked and disliked recently; reaches the writer as delimited data. */
  taste?: Taste | undefined;
  log?: Logger;
  /** The clock for the time limit; tests replace it. */
  now?: () => number;
  /**
   * Asks the writer for the opening turns first (when it can) and hands them over as soon as they
   * are checked, before the rest of the script is written. The script then continues after them.
   */
  onOpening?: (turns: readonly ScriptTurn[]) => Promise<void>;
  /** The Catch up structure's asks (D170); absent is the shape every episode had before it. */
  shape?: ScriptShape | undefined;
}

/** An opening is a few turns; more than this is the writer ignoring the ask, and is cut. */
const OPENING_MAX_TURNS = 8;
const OPENING_MIN_TURNS = 2;

/**
 * The opening turns of a reply, cleaned the way a script's are, or null when they are not usable:
 * too few, the show not named, a discussion that does not start with host "a". It is stricter than
 * nothing and looser than a script: it only has to be safe to speak while the rest is written.
 */
export function validateOpening(
  raw: unknown,
  request: PodcastRequest,
  stories: readonly PodcastStory[],
): ScriptTurn[] | null {
  const parsed = ScriptReply.safeParse(raw);
  if (!parsed.success) return null;
  const known = new Set(stories.map((story) => story.item_id));
  const turns: ScriptTurn[] = [];
  for (const row of parsed.data.turns.slice(0, OPENING_MAX_TURNS)) {
    const text = cleanText(row.text);
    if (text === "") continue;
    const given = row.item_id ? row.item_id : undefined;
    const itemId = given === undefined || known.has(given) ? given : closestId(given, known);
    turns.push({
      speaker: request.format === "discussion" ? row.speaker : "a",
      text,
      ...(itemId !== undefined && known.has(itemId) ? { item_id: itemId } : {}),
    });
  }
  if (turns.length < OPENING_MIN_TURNS) return null;
  if (!/singularity/i.test(turns[0]?.text ?? "")) return null;
  if (request.format === "discussion" && turns[0]?.speaker === "b") return null;
  return turns;
}

/** The opening, or null when the writer has none to give or it failed: the script goes on without. */
async function requestOpening(deps: ScriptDeps): Promise<ScriptTurn[] | null> {
  if (!deps.onOpening || !deps.writer.writeOpening) return null;
  try {
    const raw = await deps.writer.writeOpening({
      request: deps.request,
      stories: deps.stories,
      budget_chars: deps.budget_chars,
      ...(deps.feedback ? { feedback: deps.feedback } : {}),
      ...(deps.taste ? { taste: deps.taste } : {}),
      ...(deps.shape ? { shape: deps.shape } : {}),
      deadline_at: (deps.now ?? Date.now)() + SCRIPT_TIME_LIMIT_MS,
    });
    const turns = validateOpening(raw, deps.request, deps.stories);
    if (turns === null) {
      deps.log?.warn("The opening was not usable; the script is written without it");
      return null;
    }
    await deps.onOpening(turns);
    return turns;
  } catch (error) {
    if (error instanceof BudgetExceededError) throw error;
    deps.log?.warn("The opening could not be written; the script is written without it", {
      reason: describeError(error),
    });
    return null;
  }
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
 * The one known id a mistyped id can only mean: the one known id it contains (a model sometimes
 * copies the marker around the id as well), or the same leading characters when no other known
 * id shares them. Anything less certain is returned as given, and reported.
 */
export function closestId(given: string, known: ReadonlySet<string>): string {
  const inside = [...known].filter((id) => id.length > 0 && given.includes(id));
  if (inside.length === 1 && inside[0] !== undefined) return inside[0];
  if (inside.length > 1) return given;
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
  shape?: ScriptShape,
): string {
  const used = new Map<string, number>();
  for (const turn of turns) {
    if (turn.item_id) used.set(turn.item_id, (used.get(turn.item_id) ?? 0) + turn.text.length);
  }
  const thinnest = [...stories]
    .sort((a, b) => (used.get(a.item_id) ?? 0) - (used.get(b.item_id) ?? 0))
    .slice(0, 3)
    .map((story) => `"${story.headline}"`);
  const parts = partChars(budget, stories.length, request.format, request.length_minutes, shape);
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

async function requestTurns(
  deps: ScriptDeps,
  opening: readonly ScriptTurn[] | null = null,
): Promise<Requested> {
  let problems: string[] = [];
  let rejected: string[] = [];
  // The longest reply that was valid but short: a short true episode beats none.
  let short: ScriptTurn[] | null = null;
  let calls = 0;
  const reach = reachableChars(
    deps.budget_chars,
    deps.stories.length,
    deps.request.format,
    deps.request.length_minutes,
    deps.shape,
  );
  const now = deps.now ?? Date.now;
  const deadline = now() + SCRIPT_TIME_LIMIT_MS;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (attempt > 1 && now() >= deadline) {
      deps.log?.warn("The script ran out of time for another attempt", {
        attempts: calls,
        limit_ms: SCRIPT_TIME_LIMIT_MS,
      });
      break;
    }
    calls = attempt;
    try {
      const raw = await deps.writer.writeScript(
        {
          request: deps.request,
          stories: deps.stories,
          budget_chars: deps.budget_chars,
          ...(deps.feedback ? { feedback: deps.feedback } : {}),
          ...(deps.taste ? { taste: deps.taste } : {}),
          ...(opening ? { opening } : {}),
          ...(deps.shape ? { shape: deps.shape } : {}),
          deadline_at: deadline,
        },
        problems,
      );
      const result = validateReply(raw, deps.request, deps.stories);
      if (result.ok) {
        // Held to what the stories can carry, not to a length they cannot fill.
        const chars = charCount(result.turns);
        if (chars >= scriptAcceptChars(reach)) {
          const shortBy = shortByChars(result.turns, reach);
          if (shortBy > 0) {
            deps.log?.info("Kept a script a little under the floor instead of rewriting it", {
              attempt,
              chars,
              floor_chars: scriptFloorChars(reach),
              short_by_chars: shortBy,
            });
          }
          return { turns: result.turns, calls: attempt, rejected };
        }
        // Keep the longest of the short replies: a rewrite is not always longer.
        if (!short || chars > charCount(short)) short = result.turns;
        problems = [tooShortProblem(result.turns, deps.stories, reach, deps.request, deps.shape)];
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
  if (short) return { turns: short, calls, rejected };
  throw new PodcastError(`The writer did not return a usable script. ${problems.join(" ")}`);
}

/** A script under this share of what the stories can carry is extended, up to twice. */
export const EXTEND_BELOW_SHARE = 0.9;
const EXTEND_PASSES = 2;

/**
 * A valid script still under 90% of its target is sent back to deepen its shortest segments from
 * the story blocks (no invention), at most twice; a pass that is not longer is dropped. The
 * planned, written and final lengths are logged so a run shows where the minutes went.
 */
async function extendTurns(deps: ScriptDeps, written: ScriptTurn[]): Promise<ScriptTurn[]> {
  const reach = reachableChars(
    deps.budget_chars,
    deps.stories.length,
    deps.request.format,
    deps.request.length_minutes,
    deps.shape,
  );
  const target = scriptTargetChars(reach);
  const writtenChars = charCount(written);
  let turns = written;
  let passes = 0;
  const writer = deps.writer;
  if (writer.extendScript) {
    while (passes < EXTEND_PASSES && charCount(turns) < Math.floor(reach * EXTEND_BELOW_SHARE)) {
      passes += 1;
      try {
        const problem = tooShortProblem(turns, deps.stories, reach, deps.request, deps.shape);
        const result = validateReply(
          await writer.extendScript(
            {
              request: deps.request,
              stories: deps.stories,
              budget_chars: deps.budget_chars,
              ...(deps.shape ? { shape: deps.shape } : {}),
            },
            turns,
            problem.replace(/^The script is too short/, "The script is under its length"),
          ),
          deps.request,
          deps.stories,
        );
        if (result.ok && charCount(result.turns) > charCount(turns)) turns = result.turns;
      } catch (error) {
        if (error instanceof BudgetExceededError) throw error;
        deps.log?.warn("An extend pass failed", { reason: describeError(error) });
      }
    }
  }
  deps.log?.info("Script length", {
    planned_chars: target,
    reachable_chars: reach,
    written_chars: writtenChars,
    final_chars: charCount(turns),
    extend_passes: passes,
  });
  return turns;
}

/**
 * One writer call, validated and held to the stories: unknown story ids and invented numbers are
 * dealt with, the show is always named in the opening, and the length is enforced in code.
 */
export async function generateScript(deps: ScriptDeps): Promise<ScriptResult> {
  const opening = await requestOpening(deps);
  const requested = await requestTurns(deps, opening);
  const { calls, rejected } = requested;
  const raw = await extendTurns(deps, requested.turns);
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
  // A structured episode gives up its close before any story (D170): order there is priority.
  const fitted = fitToBudget(turns, deps.budget_chars, { closeFirst: deps.shape !== undefined });
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
