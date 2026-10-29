import type { GenerationRow } from "../types/contracts";
import { queuePercent } from "./queuePercent";
import { NAMED_EPISODE_STAGES, NAMED_EPISODE_STEPS, timeLeft } from "./runStages";

/**
 * What a row of the podcast queue says besides its name (lib/queueNames.ts): the time left and the
 * stage, the percent in its ring, the thumbnail it draws, and what can be done to it. Pure, so the
 * queue's script (scripts/queue.ts) carries only the DOM and the words (the element's data
 * attributes) are passed in.
 */

/** The sentences a row is made of. `left` carries `{n}`, whole minutes. */
export interface GenerationWords {
  waiting: string;
  left: string;
  slow: string;
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
  kind: GenerationRow["kind"];
  running: boolean;
  /** The time left ("3 min left"), or "" when the engine has no estimate or the run is waiting. */
  eta: string;
  /** The stage; "Taking longer than usual" leads it past one and a half times the usual; waiting while queued. */
  status: string;
  /** The whole number in the queue's ring: 0 while queued, else 1 to 99 (lib/queuePercent.ts). */
  percent: number;
  /** A plain hex colour for the thumbnail's ground, or null. */
  tint: string | null;
  /** A cover image to draw in the thumbnail (a regenerated podcast's own), or null. */
  cover: string | null;
  /** The episode can be listened to as it is written. */
  listen: boolean;
  /** Cancel is offered: not once the voices are being recorded (the spend would go unrecorded), nor in the wait for the site. */
  cancellable: boolean;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
/** A digest id: a date, then `-weekly` or a same-day number (core's DigestId). */
const DIGEST_ID = /^\d{4}-\d{2}-\d{2}(-weekly|-[2-9]|-[1-9]\d+)?$/;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** The stage from which a Catch up's voices are being recorded: stopping it there loses that run's usage charge (D208, D217). */
const VOICES_STAGE = NAMED_EPISODE_STEPS.indexOf("Recording voices");

export function describeGeneration(row: GenerationRow, context: GenerationContext): GenerationView {
  const { now, words } = context;
  const followed = context.followed?.id === row.run_id ? context.followed : null;
  const live = context.live?.runId === row.run_id ? context.live : null;
  const replacing = text(row.target) || text(followed?.retry?.body.replace);
  const running = row.state === "running";

  const since =
    followed?.stageAt ?? context.stageSince?.(row.run_id, row.stage) ?? followed?.t0 ?? now;
  const elapsed = Math.max(0, now - since);
  const estimates = followed?.estimates ?? row.stage_estimates_ms;

  let eta = "";
  let slow = false;
  if (running) {
    const left = timeLeft(row.stage, estimates, elapsed);
    if (left.kind === "slow") slow = true;
    else if (left.kind === "left") eta = words.left.replace("{n}", String(left.minutes));
  }
  const status = !running ? words.waiting : slow ? `${words.slow} · ${row.label}` : row.label;

  // The last stage of a run's list is the wait for the site (a Catch up's; a briefing is live as it
  // commits), which the workflow cannot see: the run is over, so there is nothing to stop.
  const voices = row.stages === NAMED_EPISODE_STAGES.length && row.stage >= VOICES_STAGE;
  const waiting = row.what === "episode" && row.stage >= row.stages - 1;

  return {
    id: row.run_id,
    kind: row.kind,
    running,
    eta,
    status,
    percent: queuePercent({
      stage: row.stage,
      stages: row.stages,
      elapsedInStageMs: elapsed,
      estimates,
      queued: !running,
    }),
    tint: live?.tint && HEX_COLOR.test(live.tint) ? live.tint : null,
    cover: DIGEST_ID.test(replacing) ? `/covers/${replacing}-512.webp` : null,
    listen: running && row.what === "episode" && row.kind === "catch_up" && live !== null,
    cancellable: !voices && !waiting,
  };
}
