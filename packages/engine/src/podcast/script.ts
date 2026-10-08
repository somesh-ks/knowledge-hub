import type { PodcastRequest } from "@dispatch/core";
import type { Logger } from "../context.js";
import { BudgetExceededError, describeError } from "../llm/errors.js";
import { checkTurns } from "./check.js";
import { fitToBudget, mergeNeighbours } from "./fit.js";
import { ScriptReply } from "./nebiusScriptWriter.js";
import { PodcastError, type PodcastStory, type ScriptTurn, type ScriptWriter } from "./types.js";

/** Attempts at a valid reply: the first call and one retry that names what was wrong. */
const ATTEMPTS = 2;

/** Said when the opening turn was dropped by the checks, so the show is always named. */
const FALLBACK_OPENING = "This is Singularity.";

export interface ScriptDeps {
  writer: ScriptWriter;
  request: PodcastRequest;
  stories: readonly PodcastStory[];
  budget_chars: number;
  log?: Logger;
}

export interface ScriptResult {
  turns: ScriptTurn[];
  rewritten: number;
  dropped_turns: number;
  dropped_stories: number;
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
    const itemId = row.item_id ? row.item_id : undefined;
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

async function requestTurns(deps: ScriptDeps): Promise<ScriptTurn[]> {
  let problems: string[] = [];
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const raw = await deps.writer.writeScript(
        { request: deps.request, stories: deps.stories, budget_chars: deps.budget_chars },
        problems,
      );
      const result = validateReply(raw, deps.request, deps.stories);
      if (result.ok) return result.turns;
      problems = result.problems;
    } catch (error) {
      if (error instanceof BudgetExceededError) throw error;
      problems = [`The last call failed: ${describeError(error)}`];
    }
    deps.log?.warn("The script reply was not usable", { attempt, problems });
  }
  throw new PodcastError(`The writer did not return a usable script. ${problems.join(" ")}`);
}

/**
 * One writer call, validated and held to the stories: unknown story ids and invented numbers are
 * dealt with, the show is always named in the opening, and the length is enforced in code.
 */
export async function generateScript(deps: ScriptDeps): Promise<ScriptResult> {
  const raw = await requestTurns(deps);
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
  return {
    turns: fitted.turns,
    rewritten: checked.rewritten,
    dropped_turns: checked.dropped,
    dropped_stories: fitted.dropped_stories,
  };
}
