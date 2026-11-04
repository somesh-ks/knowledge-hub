import type { PodcastRequest } from "@singularity/core";
import type { Logger } from "../context.js";
import { BudgetExceededError, describeError } from "../llm/errors.js";
import type { Taste } from "../profile/tasteNote.js";
import { checkTurns } from "./check.js";
import { charCount, fitToBudget, mergeNeighbours, spokenMs } from "./fit.js";
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
import {
  PodcastError,
  type PodcastStory,
  type ScriptInput,
  type ScriptRow,
  type ScriptTurn,
  type ScriptWriter,
} from "./types.js";

/** Attempts at a valid reply: the first call and two retries that name what was wrong. */
const ATTEMPTS = 3;

/**
 * No new script attempt starts after this long, and every writer call (its own retries included)
 * ends by then, so a stalled provider cannot use up the 15 minute job.
 */
export const SCRIPT_TIME_LIMIT_MS = 8 * 60_000;

/** Said when the opening turn was dropped by the checks, so the show is always named. */
const FALLBACK_OPENING = "This is Singularity.";

/**
 * A part of a streamed reply goes out once this many characters of complete turns are unsent, or
 * an eighth of what the stories can carry when that is more: about 37 seconds of speech at 2x.
 */
const PART_MIN_CHARS = 1_200;
/** Later parts of one reply wait this long after the one before, which keeps the writes few. */
const PART_SPACING_MS = 15_000;
/** A script under this share of what its stories can carry gets one continuation (D366). */
const CONTINUE_BELOW_SHARE = 0.9;
/** Said to the continuation when the close and sign-off are held back to follow its turns. */
const ENDING_WRITTEN =
  "The close and sign-off are already written and follow your turns, so end on your last story turn and do not sign off.";

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
  /** The clock for the time limit and the parts; tests replace it. */
  now?: () => number;
  /**
   * Gets the script in parts while it is written, each once its turns are checked: the whole list
   * so far (every list starts with the one before, word for word) and how long the episode is
   * expected to run. The last call has the finished script and its own length. With it the reply
   * is streamed; each call is awaited, so the last write is done when the script is.
   */
  onPart?: (turns: readonly ScriptTurn[], expectedMs: number) => Promise<void>;
  /** The Catch up structure's asks (D170); absent is the shape every episode had before it. */
  shape?: ScriptShape | undefined;
}

export interface ScriptResult {
  turns: ScriptTurn[];
  rewritten: number;
  dropped_turns: number;
  /** Characters under the floor (80% of the budget) the kept script still is; 0 when it reaches it. */
  short_by_chars: number;
  dropped_stories: number;
  /** How many times the writer was asked for a script (the first call, retries, the continuation). */
  writer_calls: number;
  /** The problems found in the last reply that was sent back; empty when every reply was accepted. */
  last_problems: string[];
  /** Milliseconds from the start of the script to its first part written; absent without onPart. */
  first_part_ms?: number;
}

/** Spoken text has no em dashes or stray whitespace; the model sometimes sends both anyway. */
function cleanText(text: string): string {
  return text
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A reply's rows as turns: the text cleaned, empty ones left out, a solo host always "a" (the label
 * carries no information there), and a mistyped id taken as the one it can only mean.
 */
function cleanRows(
  rows: readonly ScriptRow[],
  request: PodcastRequest,
  known: ReadonlySet<string>,
): ScriptTurn[] {
  const turns: ScriptTurn[] = [];
  for (const row of rows) {
    const text = cleanText(row.text);
    if (text === "") continue;
    const given = row.item_id ? row.item_id : undefined;
    // A model that drops or swaps a character of an id has still said which story it means.
    const itemId = given === undefined || known.has(given) ? given : closestId(given, known);
    turns.push({
      speaker: request.format === "discussion" ? row.speaker : "a",
      text,
      ...(itemId === undefined ? {} : { item_id: itemId }),
    });
  }
  return turns;
}

/** The turns are always there, so a reply that is out already can be kept whatever its problems. */
interface Validated {
  ok: boolean;
  turns: ScriptTurn[];
  problems: string[];
}

/**
 * Apply the format rules to a raw reply. Everything that is wrong is reported, so the retry can say
 * what to fix. The first `held` turns are out already (the listener may be hearing them, and the
 * player adds turns by their place): they stand as they are, and only the turns after them are
 * cleaned and merged.
 */
export function validateReply(
  raw: unknown,
  request: PodcastRequest,
  stories: readonly PodcastStory[],
  held: readonly ScriptTurn[] = [],
): Validated {
  const parsed = ScriptReply.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      turns: [...held],
      problems: [
        `The reply is not the required JSON shape (${issue?.path.join(".") || "(root)"}: ${issue?.message ?? "invalid"}).`,
      ],
    };
  }
  const known = new Set(stories.map((story) => story.item_id));
  const rest = cleanRows(parsed.data.turns.slice(held.length), request, known);
  const turns = [...held, ...rest];
  const problems: string[] = [];
  const unknownIds = new Set(
    rest.flatMap((turn) =>
      turn.item_id !== undefined && !known.has(turn.item_id) ? [turn.item_id] : [],
    ),
  );
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
  if (problems.length > 0) return { ok: false, turns, problems };
  return { ok: true, turns: [...held, ...mergeNeighbours(rest)], problems };
}

/**
 * Whether turns can start the episode while the rest is written: two at least, one of them about a
 * story, the show named first and, in a discussion, host "a" first.
 */
function opensEpisode(
  turns: readonly ScriptTurn[],
  request: PodcastRequest,
  known: ReadonlySet<string>,
): boolean {
  return (
    turns.length >= 2 &&
    turns.some((turn) => turn.item_id !== undefined && known.has(turn.item_id)) &&
    /singularity/i.test(turns[0]?.text ?? "") &&
    (request.format !== "discussion" || turns[0]?.speaker === "a")
  );
}

/** Where the story-less turns at the end (the close and sign-off) begin; 0 with no story turn. */
function endingAt(turns: readonly { item_id?: string | null | undefined }[]): number {
  return turns.findLastIndex((turn) => Boolean(turn.item_id)) + 1;
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

/** What one reply is cut into as it streams. */
interface Cut {
  onTurns: (rows: readonly ScriptRow[]) => void;
  /** How many of the reply's own rows (after its opening) the parts took. */
  readonly covered: number;
  /** The reply's complete rows no part took, up to its last story turn. */
  unsent(): ScriptTurn[];
}

/**
 * The parts of one script: the turns out already, and a queue that checks each part like the
 * finished script (merged only inside itself), adds it after the turns before it and hands the
 * whole list over. Nothing out is ever changed or dropped (D366).
 */
function createLive(deps: ScriptDeps, reach: number) {
  const now = deps.now ?? Date.now;
  const started = now();
  const known = new Set(deps.stories.map((story) => story.item_id));
  const threshold = Math.max(PART_MIN_CHARS, Math.floor(reach / 8));
  // The length the listener picked, until the finished script gives its own.
  const expectedMs = deps.request.length_minutes * 60_000;
  const published: ScriptTurn[] = [];
  const stats = { rewritten: 0, dropped: 0, first_part_ms: undefined as number | undefined };
  let queue: Promise<void> = Promise.resolve();

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    queue = queue.then(task);
    // A failed part fails the script where it next waits on the queue, not as an unhandled rejection.
    queue.catch(() => {});
    return queue;
  };

  async function write(turns: readonly ScriptTurn[], ms: number): Promise<void> {
    if (!deps.onPart) return;
    await deps.onPart(turns, ms);
    stats.first_part_ms ??= now() - started;
  }

  /** The number checks and the merge, for turns that are not out yet. */
  async function check(turns: readonly ScriptTurn[]): Promise<ScriptTurn[]> {
    if (turns.length === 0) return [];
    const checked = await checkTurns({
      request: deps.request,
      turns,
      stories: deps.stories,
      writer: deps.writer,
      ...(deps.log ? { log: deps.log } : {}),
    });
    stats.rewritten += checked.rewritten;
    stats.dropped += checked.dropped;
    return mergeNeighbours(checked.turns);
  }

  function publish(turns: readonly ScriptTurn[]): void {
    if (turns.length === 0) return;
    void enqueue(async () => {
      const checked = await check(turns);
      if (checked.length === 0) return;
      // The show is named first even when the checks dropped the hello.
      if (published.length === 0 && !/singularity/i.test(checked[0]?.text ?? "")) {
        published.push({ speaker: "a", text: FALLBACK_OPENING });
      }
      published.push(...checked);
      await write(published.slice(), expectedMs);
    });
  }

  function reply(): Cut {
    let rows: readonly ScriptRow[] = [];
    let covered = 0;
    let lastAt: number | null = null;
    const turnsOf = (to: number): ScriptTurn[] =>
      cleanRows(rows.slice(covered, to), deps.request, known);
    return {
      get covered() {
        return covered;
      },
      unsent: () => turnsOf(endingAt(rows)),
      onTurns(next) {
        rows = next;
        // A part ends on a story turn: the close and sign-off wait for the end of the reply.
        const end = endingAt(rows);
        if (end <= covered) return;
        const turns = turnsOf(end);
        if (charCount(turns) < threshold) return;
        const at = now();
        if (lastAt !== null && at - lastAt < PART_SPACING_MS) return;
        if (published.length === 0 && covered === 0 && !opensEpisode(turns, deps.request, known)) {
          return;
        }
        covered = end;
        lastAt = at;
        publish(turns);
      },
    };
  }

  return {
    /** The turns out already, in order; a later part only adds to them. */
    published: published as readonly ScriptTurn[],
    stats,
    check,
    /** Check the turns and put them out after the ones before. */
    publish,
    reply,
    /** The finished script, with its own length, as the last part. */
    finish: (turns: readonly ScriptTurn[]): Promise<void> =>
      enqueue(() => write(turns, spokenMs(turns))),
    /** Resolves once every part asked for is written; rejects with a part's failure. */
    settled: (): Promise<void> => queue,
  };
}

type Live = ReturnType<typeof createLive>;

/** The writer's input for one call, carrying on after `opening` when it has turns. */
function scriptInput(
  deps: ScriptDeps,
  deadline: number,
  opening: readonly ScriptTurn[],
  cut: Cut,
): ScriptInput {
  return {
    request: deps.request,
    stories: deps.stories,
    budget_chars: deps.budget_chars,
    ...(deps.feedback ? { feedback: deps.feedback } : {}),
    ...(deps.taste ? { taste: deps.taste } : {}),
    ...(opening.length > 0 ? { opening } : {}),
    ...(deps.shape ? { shape: deps.shape } : {}),
    // Streamed only for a listener: without one, a reply that fails validation can still be resent.
    ...(deps.onPart ? { onTurns: cut.onTurns } : {}),
    deadline_at: deadline,
  };
}

/**
 * A reply as the script it makes: the turns out already, then the reply's own rows (after the
 * `opening` it was given) that no part took. A reply that is not the JSON shape is returned as it
 * came, for validateReply to report.
 */
function spliced(
  raw: unknown,
  opening: number,
  published: readonly ScriptTurn[],
  covered: number,
): unknown {
  const parsed = ScriptReply.safeParse(raw);
  return parsed.success
    ? { turns: [...published, ...parsed.data.turns.slice(opening + covered)] }
    : raw;
}

interface Requested {
  /** The turns after the ones out already: valid, not yet checked. */
  rest: ScriptTurn[];
  calls: number;
  rejected: string[];
}

async function requestTurns(
  deps: ScriptDeps,
  live: Live,
  reach: number,
  deadline: number,
): Promise<Requested> {
  let problems: string[] = [];
  let rejected: string[] = [];
  // The longest reply that was valid but short: a short true episode beats none.
  let short: ScriptTurn[] | null = null;
  let calls = 0;
  const now = deps.now ?? Date.now;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (attempt > 1 && now() >= deadline) {
      deps.log?.warn("The script ran out of time for another attempt", {
        attempts: calls,
        limit_ms: SCRIPT_TIME_LIMIT_MS,
      });
      break;
    }
    calls = attempt;
    // Once a part is out, a call carries on after it: what may have been heard is not written again.
    const opening = live.published.slice();
    const cut = live.reply();
    try {
      const raw = await deps.writer.writeScript(
        scriptInput(deps, deadline, opening, cut),
        problems,
      );
      await live.settled();
      const result = validateReply(
        spliced(raw, opening.length, live.published, cut.covered),
        deps.request,
        deps.stories,
        live.published,
      );
      const rest = result.turns.slice(live.published.length);
      if (live.published.length > 0) {
        // Out already, so kept as it is; the continuation makes up a short one.
        if (!result.ok) {
          deps.log?.warn("A reply that is out already failed validation; it is kept", {
            attempt,
            problems: result.problems,
          });
        }
        return { rest, calls, rejected: result.ok ? rejected : result.problems };
      }
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
          return { rest, calls, rejected };
        }
        // Keep the longest of the short replies: a rewrite is not always longer.
        if (!short || chars > charCount(short)) short = result.turns;
        problems = [tooShortProblem(result.turns, deps.stories, reach, deps.request, deps.shape)];
      } else {
        problems = result.problems;
      }
    } catch (error) {
      if (error instanceof BudgetExceededError) throw error;
      await live.settled();
      problems = [`The last call failed: ${describeError(error)}`];
      if (live.published.length > 0) {
        // Part of it is out: what else it wrote in full follows, and the next call carries on.
        // shortcut: a break right after the first part leaves about 7 s to spare at 2x (D366), so a
        // slow or failed next call is heard as a pause; if the owner hears one, hold that part longer.
        live.publish(cut.unsent());
        await live.settled();
        deps.log?.warn(
          "The script reply broke off after a part went out; the next call continues",
          {
            attempt,
            problems,
          },
        );
        rejected = problems;
        problems = [];
        continue;
      }
    }
    rejected = problems;
    deps.log?.warn("The script reply was not usable", { attempt, problems });
  }
  if (live.published.length > 0) {
    deps.log?.warn("The script ends where its last part did", { attempts: calls });
    return { rest: [], calls, rejected };
  }
  if (short) return { rest: short, calls, rejected };
  throw new PodcastError(`The writer did not return a usable script. ${problems.join(" ")}`);
}

/**
 * A script under 90% of what its stories can carry gets one more call that only adds turns: the
 * turns up to the last story go out first, the call carries on after them, and the close and
 * sign-off already written follow what it adds (D366). Its turns are kept when one about a story
 * passes the checks.
 */
async function continueScript(
  deps: ScriptDeps,
  live: Live,
  reach: number,
  deadline: number,
  rest: ScriptTurn[],
): Promise<{ rest: ScriptTurn[]; calls: number }> {
  const script = [...live.published, ...rest];
  const chars = charCount(script);
  if (chars >= Math.floor(reach * CONTINUE_BELOW_SHARE)) return { rest, calls: 0 };
  const end = endingAt(script);
  const late = (deps.now ?? Date.now)() >= deadline;
  // An ending that is out already cannot have turns put before it.
  if (end === 0 || end < live.published.length || late) {
    deps.log?.warn("The script stays under its length: it cannot be continued", {
      chars,
      reachable_chars: reach,
      reason: late ? "time" : "ending out",
    });
    return { rest, calls: 0 };
  }
  const ending = script.slice(end);
  live.publish(script.slice(live.published.length, end));
  await live.settled();
  const opening = live.published.slice();
  const cut = live.reply();
  const problem = tooShortProblem(script, deps.stories, reach, deps.request, deps.shape);
  let added: ScriptTurn[];
  try {
    const raw = await deps.writer.writeScript(scriptInput(deps, deadline, opening, cut), [
      ending.length > 0 ? `${problem} ${ENDING_WRITTEN}` : problem,
    ]);
    await live.settled();
    added = validateReply(
      spliced(raw, opening.length, live.published, cut.covered),
      deps.request,
      deps.stories,
      live.published,
    ).turns.slice(live.published.length);
  } catch (error) {
    if (error instanceof BudgetExceededError) throw error;
    await live.settled();
    deps.log?.warn("The continuation failed; the script keeps what it had", {
      reason: describeError(error),
    });
    added = cut.unsent();
  }
  // Its own close and sign-off give way to the ones written first.
  const checked = await live.check(ending.length > 0 ? added.slice(0, endingAt(added)) : added);
  const kept = checked.some((turn) => turn.item_id !== undefined) ? checked : [];
  deps.log?.info("Continued the script", {
    chars,
    added_chars: charCount(kept),
    reachable_chars: reach,
  });
  // The ending is checked here too, so the caller checks nothing twice. It is merged apart from the
  // kept turns, as a part is: at the seam one speaker can keep two turns in a row.
  return { rest: [...kept, ...(await live.check(ending))], calls: 1 };
}

/**
 * The script, validated and held to the stories: unknown story ids and invented numbers are dealt
 * with, the show is always named in the opening, and the length is enforced in code. With onPart
 * it goes out in parts as it streams, and what is out is never rewritten (D366).
 */
export async function generateScript(deps: ScriptDeps): Promise<ScriptResult> {
  const now = deps.now ?? Date.now;
  const deadline = now() + SCRIPT_TIME_LIMIT_MS;
  const reach = reachableChars(
    deps.budget_chars,
    deps.stories.length,
    deps.request.format,
    deps.request.length_minutes,
    deps.shape,
  );
  const live = createLive(deps, reach);
  try {
    const requested = await requestTurns(deps, live, reach, deadline);
    const written = charCount(live.published) + charCount(requested.rest);
    const continued = await continueScript(deps, live, reach, deadline, requested.rest);
    // The turns not out yet get the checks the parts had (a continuation checked its own); the
    // ones out are final.
    const rest = continued.calls > 0 ? continued.rest : await live.check(continued.rest);
    let turns = [...live.published, ...rest];
    if (live.published.length === 0 && !/singularity/i.test(turns[0]?.text ?? "")) {
      turns = [{ speaker: "a", text: FALLBACK_OPENING }, ...turns];
    }
    // A structured episode gives up its close before any story (D170): order there is priority.
    const fitted = fitToBudget(turns, deps.budget_chars, {
      closeFirst: deps.shape !== undefined,
      keep: live.published.length,
    });
    const finalChars = charCount(fitted.turns);
    if (finalChars > deps.budget_chars) {
      deps.log?.warn("The script runs over its length: the turns over it were out already", {
        chars: finalChars,
        budget_chars: deps.budget_chars,
      });
    }
    deps.log?.info("Script length", {
      planned_chars: scriptTargetChars(reach),
      reachable_chars: reach,
      written_chars: written,
      final_chars: finalChars,
      continued: continued.calls > 0,
    });
    const shortBy = shortByChars(fitted.turns, deps.budget_chars);
    if (shortBy > 0) {
      deps.log?.warn("The script is shorter than the length asked for", {
        short_by_chars: shortBy,
        chars: finalChars,
        budget_chars: deps.budget_chars,
      });
    }
    // The last part has the finished script and its own length; awaited, so it is written before
    // the step ends (an unawaited write is lost when the process exits).
    await live.finish(fitted.turns);
    return {
      turns: fitted.turns,
      rewritten: live.stats.rewritten,
      dropped_turns: live.stats.dropped,
      dropped_stories: fitted.dropped_stories,
      short_by_chars: shortBy,
      writer_calls: requested.calls + continued.calls,
      last_problems: requested.rejected,
      ...(live.stats.first_part_ms === undefined
        ? {}
        : { first_part_ms: live.stats.first_part_ms }),
    };
  } catch (error) {
    // A part still being written finishes first, so it never lands after the run says it failed.
    await live.settled().catch(() => {});
    throw error;
  }
}
