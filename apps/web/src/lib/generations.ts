import type { GenerationRow } from "../types/contracts";
import { queuePercent } from "./queuePercent";
import { timeLeft } from "./runStages";

/**
 * What a row of the generations list says: its title, its stage and time left, how far along its bar
 * is, and the thumbnail it draws. Pure, so the list's script (scripts/generations.ts) carries only
 * the DOM and the words (the panel's data attributes) are passed in.
 */

/** The sentences a row is made of. `left` carries `{n}`, whole minutes. */
export interface GenerationWords {
  waiting: string;
  left: string;
  slow: string;
  episode: string;
  briefing: string;
  regenerate: string;
}

/** The run this device started and follows (the run indicator's record), when it is the row's. */
export interface FollowedRun {
  id: number;
  /** When it entered the stage it is in. */
  stageAt?: number;
  t0?: number;
  /** The usual length of each stage, from the status route for this run's format and length. */
  estimates?: (number | null)[];
  /** The request that started it: an episode's `request`, or a Regenerate's `replace` id. */
  retry?: { body: Record<string, unknown> };
}

/** What the live copy of an episode being written tells (the run indicator polls it). */
export interface LiveHint {
  runId: number;
  title: string | null;
  /** The cover box's colour until the drawn cover is deployed. */
  tint: string | null;
}

export interface GenerationContext {
  now: number;
  words: GenerationWords;
  followed?: FollowedRun | null;
  live?: LiveHint | null;
  /** When this list first saw the run in this stage, for a run this device did not start. */
  stageSince?: (id: number, stage: number) => number | undefined;
}

export interface GenerationView {
  id: number;
  kind: GenerationRow["what"];
  running: boolean;
  title: string;
  /** The stage, and the time left after it when there is an estimate. */
  meta: string;
  /** 0 to 1: how far along the run is. */
  progress: number;
  /** The whole number in the queue's ring: 0 while queued, else 1 to 99 (lib/queuePercent.ts). */
  percent: number;
  /** A plain hex colour for the thumbnail's ground, or null. */
  tint: string | null;
  /** A cover image to draw in the thumbnail (a Regenerate's briefing), or null. */
  cover: string | null;
  /** The episode can be listened to as it is written. */
  listen: boolean;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
/** A digest id: a date, then `-weekly` or a same-day number (core's DigestId). */
const DIGEST_ID = /^\d{4}-\d{2}-\d{2}(-weekly|-[2-9]|-[1-9]\d+)?$/;

/** The least a run shows once it is going, so the bar never reads as nothing; and the most, so it never reads as done. */
const MIN_PROGRESS = 0.04;
const MAX_PROGRESS = 0.96;
const QUEUED_PROGRESS = 0.02;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function requestOf(followed: FollowedRun | null | undefined): Record<string, unknown> {
  const request = followed?.retry?.body.request;
  return typeof request === "object" && request !== null
    ? (request as Record<string, unknown>)
    : {};
}

export function describeGeneration(row: GenerationRow, context: GenerationContext): GenerationView {
  const { now, words } = context;
  const followed = context.followed?.id === row.run_id ? context.followed : null;
  const live = context.live?.runId === row.run_id ? context.live : null;
  const replacing = text(followed?.retry?.body.replace);
  const running = row.state === "running";

  const title =
    text(live?.title) ||
    text(requestOf(followed).title) ||
    (replacing ? words.regenerate : row.what === "episode" ? words.episode : words.briefing);

  const since =
    followed?.stageAt ?? context.stageSince?.(row.run_id, row.stage) ?? followed?.t0 ?? now;
  const elapsed = Math.max(0, now - since);
  const estimates = followed?.estimates ?? row.stage_estimates_ms;

  let eta = "";
  if (running) {
    const left = timeLeft(row.stage, estimates, elapsed);
    if (left.kind === "slow") eta = words.slow;
    else if (left.kind === "left") eta = words.left.replace("{n}", String(left.minutes));
  }
  const meta = !running ? words.waiting : eta ? `${eta} · ${row.label}` : row.label;

  // The last stage of a run's list is the wait for the site, which the workflow cannot see and the
  // list never holds, so the bar spans the stages before it.
  const spans = Math.max(1, row.stages - 1);
  const usual = estimates?.[row.stage];
  const within = typeof usual === "number" && usual > 0 ? Math.min(0.95, elapsed / usual) : 0.5;
  const progress = !running
    ? QUEUED_PROGRESS
    : Math.min(MAX_PROGRESS, Math.max(MIN_PROGRESS, (row.stage + within) / spans));

  const percent = queuePercent({
    stage: row.stage,
    stages: row.stages,
    elapsedInStageMs: elapsed,
    estimates,
    queued: !running,
  });

  return {
    id: row.run_id,
    kind: row.what,
    running,
    title,
    meta,
    progress,
    percent,
    tint: live?.tint && HEX_COLOR.test(live.tint) ? live.tint : null,
    cover: DIGEST_ID.test(replacing) ? `/covers/${replacing}-512.webp` : null,
    listen: running && row.what === "episode" && live !== null,
  };
}
