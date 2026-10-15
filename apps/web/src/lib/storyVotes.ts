/**
 * The like and dislike a reader gives a story, kept on the device and sent in batches. DOM-free:
 * scripts/storyVotes.ts holds the clock, the storage and the requests. A vote is never listed or
 * counted anywhere on the site; it is stored so later briefings and episodes fit the listener.
 *
 * Every config save is a workflow run, a commit and a redeploy, so votes wait on the device and go
 * in one `profile.vote` op: when the page is hidden or left, or SEND_AFTER_MS after the first vote
 * not yet sent. Only a story's final state is sent.
 */
import type { ConfigOp } from "@dispatch/core";

export const VOTES_KEY = "dispatch:story-votes";
/** How long the first unsent vote may wait before the batch goes. */
export const SEND_AFTER_MS = 10 * 60 * 1000;
/** The most votes one op carries. */
export const MAX_PER_OP = 15;
/**
 * The longest request body the server reads (MAX_CONFIG_BODY_CHARS in server/configEdit.ts); a
 * longer one is refused as invalid, every time. Room is left for the passphrase (up to 256 characters,
 * more once escaped) and the wrapping.
 */
export const MAX_BODY_CHARS = 8192 - 512;
/** The most edits one request may carry (MAX_OPS in server/configEdit.ts). */
export const MAX_OPS = 8;
/**
 * The server takes one edit every ten seconds, counted from when the last one started, and refuses
 * the next one sooner with a 429 (GAP_MS in scripts/managePageSave.ts, which sends settings).
 */
export const GAP_MS = 10_000 + 250;
/** Outlets stopped and not yet accepted by the server, kept so a page left or reloaded still sends them. */
export const BLOCKS_KEY = "dispatch:story-blocks";
/** The longest headline an op carries. */
export const HEADLINE_MAX = 200;
/** Sent votes remembered so a story shows its mark again; the oldest beyond this are forgotten. */
const KEEP_SENT = 400;
/**
 * How long an open may wait for a vote or a stop to ride along with. Opens are weak signals and
 * every save is a commit, so they never make a request of their own sooner than this.
 */
export const OPENS_WAIT_MS = 24 * 60 * 60 * 1000;
/** Opens kept on the device; the oldest beyond this are forgotten, sent or not. */
const KEEP_OPENS = 100;

/** The ops as packages/core/src/configOps.ts defines them. */
export type VoteOp = Extract<ConfigOp, { op: "profile.vote" }>;
export type BlockOp = Extract<ConfigOp, { op: "profile.block" }>;
export type VoteValue = VoteOp["votes"][number]["value"];

/** What the server needs to know about a story to learn from a vote. */
export interface StoryRef {
  story_id: string;
  url: string;
  headline: string;
  topic: string;
  source_id: string;
}

export interface StoredVote extends StoryRef {
  value: VoteValue;
  /** ISO time of the last change. */
  at: string;
  sent: boolean;
}

/** A story opened at its source, kept until it goes and then forgotten. */
export interface StoredOpen extends StoryRef {
  /** ISO time of the open. */
  at: string;
}

export interface VoteState {
  /** When the oldest vote not yet sent was given, in ms; null while every vote is sent. */
  waiting_since: number | null;
  votes: Record<string, StoredVote>;
  /** Opens not yet sent, by story. */
  opens: Record<string, StoredOpen>;
}

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

export const emptyVotes = (): VoteState => ({ waiting_since: null, votes: {}, opens: {} });

const isRef = (value: Partial<StoredOpen> | null | undefined): value is StoredOpen =>
  !!value &&
  isText(value.story_id) &&
  isText(value.url) &&
  isText(value.headline) &&
  isText(value.topic) &&
  isText(value.source_id) &&
  isText(value.at);

/** The stored state, or an empty one when the text is missing or not ours. */
export function parseVotes(raw: string | null | undefined): VoteState {
  const state = emptyVotes();
  try {
    const data = JSON.parse(raw ?? "null") as Partial<VoteState> | null;
    if (!data || typeof data.votes !== "object" || data.votes === null) return state;
    for (const [id, vote] of Object.entries(data.votes)) {
      if (
        vote &&
        (vote.value === "up" || vote.value === "down" || vote.value === "clear") &&
        isText(vote.story_id) &&
        isText(vote.url) &&
        isText(vote.headline) &&
        isText(vote.topic) &&
        isText(vote.source_id) &&
        isText(vote.at) &&
        typeof vote.sent === "boolean"
      )
        state.votes[id] = vote;
    }
    if (typeof data.waiting_since === "number") state.waiting_since = data.waiting_since;
    if (typeof data.opens === "object" && data.opens !== null)
      for (const [id, open] of Object.entries(data.opens)) if (isRef(open)) state.opens[id] = open;
  } catch {
    // Malformed storage reads as no votes.
  }
  return state;
}

/** The mark a story shows: its stored vote, or none. */
export function pressedOf(state: VoteState, id: string): "up" | "down" | null {
  const value = state.votes[id]?.value;
  return value === "up" || value === "down" ? value : null;
}

export const hasUnsent = (state: VoteState): boolean =>
  Object.values(state.votes).some((vote) => !vote.sent);

/** Presses `value` on a story: it toggles on, excludes the other, and pressing the active one clears. */
export function press(
  state: VoteState,
  story: StoryRef,
  value: "up" | "down",
  now: number,
): VoteState {
  const next = pressedOf(state, story.story_id) === value ? "clear" : value;
  const vote: StoredVote = {
    ...story,
    headline: story.headline.slice(0, HEADLINE_MAX),
    value: next,
    at: new Date(now).toISOString(),
    sent: false,
  };
  const votes = { ...state.votes, [story.story_id]: vote };
  // Sent entries beyond the cap go, oldest first; nothing unsent is ever dropped.
  const sent = Object.values(votes)
    .filter((entry) => entry.sent)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(KEEP_SENT);
  for (const entry of sent) delete votes[entry.story_id];
  return { ...state, waiting_since: state.waiting_since ?? now, votes };
}

/** Notes that a story was opened at its source. It waits for the next request (pendingOps). */
export function recordOpen(state: VoteState, story: StoryRef, now: number): VoteState {
  const opens = {
    ...state.opens,
    [story.story_id]: {
      ...story,
      headline: story.headline.slice(0, HEADLINE_MAX),
      at: new Date(now).toISOString(),
    },
  };
  const old = Object.values(opens)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(KEEP_OPENS);
  for (const entry of old) delete opens[entry.story_id];
  return { ...state, opens };
}

/** When the oldest open waiting was made, in ms, or null when none waits. */
const oldestOpen = (state: VoteState): number | null => {
  const times = Object.values(state.opens).map((open) => Date.parse(open.at));
  return times.length === 0 ? null : Math.min(...times);
};

/** Milliseconds until the batch is due (0 when it is), or null when nothing waits. */
export function dueIn(state: VoteState, now: number): number | null {
  const opened = oldestOpen(state);
  const votesDue = hasUnsent(state) ? (state.waiting_since ?? now) + SEND_AFTER_MS : Infinity;
  const opensDue = opened === null ? Infinity : opened + OPENS_WAIT_MS;
  const due = Math.min(votesDue, opensDue);
  return due === Infinity ? null : Math.max(0, due - now);
}

const size = (value: unknown): number => JSON.stringify(value).length;

/**
 * The ops that carry every unsent vote, oldest first: up to MAX_PER_OP votes and opens in each, and
 * each small enough to go in a request on its own (long headlines and addresses would otherwise make
 * an op the server refuses every time, holding every later vote back with it). Opens go only with a
 * vote, or alone once the oldest has waited OPENS_WAIT_MS.
 */
export function pendingOps(state: VoteState, now: number = Date.now()): VoteOp[] {
  const unsent = Object.values(state.votes)
    .filter((vote) => !vote.sent)
    .sort((a, b) => a.at.localeCompare(b.at));
  const ops: VoteOp[] = [];
  let current: VoteOp | null = null;
  for (const vote of unsent) {
    const given = {
      story_id: vote.story_id,
      url: vote.url,
      headline: vote.headline.slice(0, HEADLINE_MAX),
      topic: vote.topic,
      source_id: vote.source_id,
      value: vote.value,
      at: vote.at,
    };
    if (
      current === null ||
      current.votes.length >= MAX_PER_OP ||
      size(current) + size(given) + 1 > MAX_BODY_CHARS
    ) {
      current = { op: "profile.vote", votes: [], opens: [] };
      ops.push(current);
    }
    current.votes.push(given);
  }
  const opened = oldestOpen(state);
  if (opened === null || (unsent.length === 0 && now - opened < OPENS_WAIT_MS)) return ops;
  const opens = Object.values(state.opens).sort((a, b) => a.at.localeCompare(b.at));
  for (const open of opens) {
    const given = {
      story_id: open.story_id,
      url: open.url,
      headline: open.headline.slice(0, HEADLINE_MAX),
      topic: open.topic,
      source_id: open.source_id,
      at: open.at,
    };
    const count = current ? current.votes.length + (current.opens?.length ?? 0) : 0;
    if (
      current === null ||
      count >= MAX_PER_OP ||
      size(current) + size(given) + 1 > MAX_BODY_CHARS
    ) {
      current = { op: "profile.vote", votes: [], opens: [] };
      ops.push(current);
    }
    current.opens = [...(current.opens ?? []), given];
  }
  return ops;
}

/** An outlet stopped from a story, waiting for the server: its domain and the name the toast uses. */
export interface PendingBlock {
  domain: string;
  outlet: string;
}

/** The stored outlets waiting to be stopped, or none when the text is missing or not ours. */
export function parseBlocks(raw: string | null | undefined): PendingBlock[] {
  try {
    const data = JSON.parse(raw ?? "null") as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(
      (entry): entry is PendingBlock =>
        typeof entry === "object" &&
        entry !== null &&
        isText((entry as PendingBlock).domain) &&
        isText((entry as PendingBlock).outlet),
    );
  } catch {
    return [];
  }
}

/**
 * The edits the next request carries: every waiting block first (they are small, and the reader is
 * watching for them), then the vote ops that still fit in MAX_OPS and MAX_BODY_CHARS. One request
 * for everything waiting, because a second one inside the server's ten seconds is refused.
 */
export function nextRequest(blocks: readonly BlockOp[], votes: readonly VoteOp[]): ConfigOp[] {
  const ops: ConfigOp[] = [];
  for (const op of [...blocks, ...votes]) {
    if (ops.length >= MAX_OPS) break;
    if (ops.length > 0 && size([...ops, op]) > MAX_BODY_CHARS) break;
    ops.push(op);
  }
  return ops;
}

/** How long the next request must wait after the last one went through at `last` (0 for none). */
export function gapLeft(last: number, now: number): number {
  return last === 0 ? 0 : Math.max(0, Math.min(GAP_MS, last + GAP_MS - now));
}

function withSent(state: VoteState, op: VoteOp, sent: boolean): VoteState {
  const opens = { ...state.opens };
  for (const given of op.opens ?? []) {
    const stored = opens[given.story_id];
    // Sent opens are forgotten; one that did not go comes back, unless opened again meanwhile.
    if (sent && stored?.at === given.at) delete opens[given.story_id];
    if (!sent && (!stored || stored.at <= given.at)) opens[given.story_id] = given;
  }
  const votes = { ...state.votes };
  for (const given of op.votes) {
    const stored = votes[given.story_id];
    // A story pressed again meanwhile has a newer time, and keeps its own state.
    if (stored && stored.at === given.at) votes[given.story_id] = { ...stored, sent };
  }
  const waiting = Object.values(votes).filter((vote) => !vote.sent);
  const oldest = waiting.reduce((min, vote) => Math.min(min, Date.parse(vote.at)), Infinity);
  return { waiting_since: waiting.length === 0 ? null : oldest, votes, opens };
}

/**
 * Notes that an op is on its way. A page that is being left cannot hear the answer, so a batch counts
 * as sent from the moment it goes; markUnsent puts it back when an answer says it did not.
 */
export const markSent = (state: VoteState, op: VoteOp): VoteState => withSent(state, op, true);

/** The op was refused or did not go: its votes wait for the next attempt. */
export const markUnsent = (state: VoteState, op: VoteOp): VoteState => withSent(state, op, false);

/** Whether pressing Stop again can help: at once, after a while, or not until something changes. */
export type StopRetry = "now" | "later" | "no";

/**
 * What a failed stop says, from the answer's status (0 when none came). Each known cause names what
 * failed and whether pressing again can help, so a refusal that will repeat does not read as the
 * reader's bad timing. A 503 is the site failing to reach GitHub: a passing outage or a refused
 * token, which the answer does not tell apart, so it is "later" and says what to suspect if it stays.
 */
export function stopFailure(outlet: string, status: number): { message: string; retry: StopRetry } {
  switch (status) {
    case 0:
      return {
        message: `Could not reach the site to stop ${outlet}. Check the connection and try again.`,
        retry: "now",
      };
    case 429:
      return {
        message: `Could not stop ${outlet}: settings changed too often just now. Try again in a minute.`,
        retry: "later",
      };
    case 503:
      return {
        message: `Could not stop ${outlet}: the site could not save settings. If it keeps failing, its GitHub access needs fixing.`,
        retry: "later",
      };
    case 400:
      return { message: `Could not stop ${outlet}: its address was not accepted.`, retry: "no" };
    case 401:
      return { message: `Could not stop ${outlet}: the change was refused.`, retry: "no" };
    default:
      return {
        message: `Could not stop ${outlet}: the site answered ${status}. Try again later.`,
        retry: "later",
      };
  }
}
