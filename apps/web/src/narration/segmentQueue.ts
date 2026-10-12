/**
 * Makes a briefing's missing audio files, one request at a time.
 *
 * trackAudio.ts asks for files in two ways: `ensure` when the playhead needs one now, `prepare` when
 * it will need one soon. Both land in one queue. The server charges and counts per request and its
 * monthly counter is a read-then-write, so requests never overlap; a file the listener is waiting
 * for jumps the line instead.
 *
 * A refusal that will not change by trying again (wrong passphrase, the daily cap, the monthly
 * budget) stops the queue until `reset` is called, so one bad passphrase is one request, not
 * nineteen.
 */
import type { Playlist, TrackSegment } from "./trackAudio";

/** Why a file could not be made. The names are the server's error codes, plus two of the client's. */
export type NarrationFailure =
  | "passphrase_required"
  | "wrong_passphrase"
  | "daily_cap"
  | "monthly_budget"
  | "not_narratable"
  | "digest_not_found"
  | "segment_not_found"
  | "unavailable"
  | "offline"
  | "failed";

export class NarrationError extends Error {
  readonly reason: NarrationFailure;

  constructor(reason: NarrationFailure) {
    super(`Narration failed: ${reason}`);
    this.name = "NarrationError";
    this.reason = reason;
  }
}

/**
 * Refusals that stand until something outside the queue changes. `unavailable` is not one: the
 * server sends it for passing failures too (a store it cannot reach, a time budget spent), so a
 * later request is still sent.
 */
const STANDING: ReadonlySet<NarrationFailure> = new Set([
  "passphrase_required",
  "wrong_passphrase",
  "daily_cap",
  "monthly_budget",
  "not_narratable",
  "digest_not_found",
]);

export type NarrateResult = { ok: true; url: string } | { ok: false; reason: NarrationFailure };

export interface SegmentQueueOptions {
  segments: TrackSegment[];
  /** One request for one segment. Resolves either way; it never throws. */
  narrate(key: string, passphrase: string): Promise<NarrateResult>;
  /** The passphrase for this session, or null when the listener has not given one. */
  getPassphrase(): string | null;
  /**
   * Called when a request is refused, so the interface can say why. `needed` is true when the
   * playhead was waiting for that file, false when it was only being made ahead of time.
   */
  onFailure?(reason: NarrationFailure, needed: boolean): void;
  /** Called each time a file arrives, with how many segments now have one. */
  onProgress?(ready: number, total: number): void;
}

export interface SegmentQueue extends Playlist {
  /**
   * Like `ensure`, but a file at a guessed address does not count: the server is asked, which
   * answers at once for a file that exists and makes it when it does not. Joins a request for the
   * same segment that is already on its way.
   */
  confirm(index: number): Promise<string>;
  /**
   * Asks the server for a segment in the background, at the back of the line. Asks nothing of a
   * file that is known to exist, and nothing at all after a standing refusal. Returns at once.
   */
  warm(index: number): void;
  /** Clears a standing refusal, after a new passphrase for instance. */
  reset(): void;
  /**
   * Stops making files ahead of time. A request already sent is allowed to finish, and a later
   * `ensure` starts the queue again, because the playhead needing a file is never ignored.
   */
  stop(): void;
}

interface Waiter {
  resolve(url: string): void;
  reject(error: NarrationError): void;
}

export function createSegmentQueue(options: SegmentQueueOptions): SegmentQueue {
  const { segments } = options;
  /** Indexes waiting for a request, most urgent first. */
  const line: number[] = [];
  const waiters = new Map<number, Waiter[]>();
  /** A file that failed for a passing reason is not asked for again unless the playhead needs it. */
  const failedOnce = new Set<number>();
  let inFlight: number | null = null;
  let standing: NarrationFailure | null = null;
  let stopped = false;

  function readyCount(): number {
    return segments.filter((segment) => segment.url !== null).length;
  }

  function settle(index: number, outcome: NarrateResult): void {
    const waiting = waiters.get(index) ?? [];
    waiters.delete(index);
    if (outcome.ok) {
      const segment = segments[index];
      if (segment) {
        segment.url = outcome.url;
        // The server just answered for this file: it is no longer a guess.
        segment.unconfirmed = false;
      }
      failedOnce.delete(index);
      for (const waiter of waiting) waiter.resolve(outcome.url);
      options.onProgress?.(readyCount(), segments.length);
      return;
    }
    if (STANDING.has(outcome.reason)) standing = outcome.reason;
    else failedOnce.add(index);
    for (const waiter of waiting) waiter.reject(new NarrationError(outcome.reason));
    options.onFailure?.(outcome.reason, waiting.length > 0);
  }

  /** A standing refusal answers everyone in line at once: nothing more will be sent. */
  function refuseAll(reason: NarrationFailure): void {
    for (const index of line.splice(0)) {
      const waiting = waiters.get(index) ?? [];
      waiters.delete(index);
      for (const waiter of waiting) waiter.reject(new NarrationError(reason));
    }
  }

  function pump(): void {
    if (inFlight !== null || stopped) return;
    if (standing) {
      refuseAll(standing);
      return;
    }
    const index = line.shift();
    if (index === undefined) return;
    const segment = segments[index];
    if (!segment || isConfirmed(segment)) {
      if (segment?.url) settle(index, { ok: true, url: segment.url });
      pump();
      return;
    }
    const passphrase = options.getPassphrase();
    if (passphrase === null) {
      line.unshift(index);
      standing = "passphrase_required";
      options.onFailure?.("passphrase_required", (waiters.get(index)?.length ?? 0) > 0);
      refuseAll("passphrase_required");
      return;
    }
    inFlight = index;
    options.narrate(segment.key, passphrase).then((outcome) => {
      inFlight = null;
      settle(index, outcome);
      pump();
    });
  }

  /** A file the server has vouched for, as opposed to one at the address it would have. */
  function isConfirmed(segment: TrackSegment): boolean {
    return segment.url !== null && !segment.unconfirmed;
  }

  function wait(index: number): Promise<string> {
    // The playhead needing a file outranks an earlier stop: the queue runs again.
    stopped = false;
    return new Promise<string>((resolve, reject) => {
      const waiting = waiters.get(index) ?? [];
      waiting.push({ resolve, reject });
      waiters.set(index, waiting);
      enqueue(index, true);
      pump();
    });
  }

  function enqueue(index: number, urgent: boolean): void {
    const at = line.indexOf(index);
    if (index === inFlight) return;
    if (urgent) {
      if (at !== -1) line.splice(at, 1);
      line.unshift(index);
    } else if (at === -1) {
      line.push(index);
    }
  }

  return {
    segments,
    ensure(index) {
      const segment = segments[index];
      if (!segment) return Promise.reject(new NarrationError("segment_not_found"));
      if (segment.url !== null) return Promise.resolve(segment.url);
      if (standing) return Promise.reject(new NarrationError(standing));
      return wait(index);
    },
    confirm(index) {
      const segment = segments[index];
      if (!segment) return Promise.reject(new NarrationError("segment_not_found"));
      if (isConfirmed(segment) && segment.url) return Promise.resolve(segment.url);
      if (standing) return Promise.reject(new NarrationError(standing));
      return wait(index);
    },
    warm(index) {
      const segment = segments[index];
      if (!segment || isConfirmed(segment) || standing || stopped || failedOnce.has(index)) return;
      enqueue(index, false);
      pump();
    },
    prepare(index) {
      const segment = segments[index];
      if (!segment || segment.url !== null || standing || stopped) return;
      // A hint is not worth a second request for a file that just failed; a real need still is.
      if (failedOnce.has(index)) return;
      enqueue(index, false);
      pump();
    },
    reset() {
      standing = null;
      stopped = false;
      failedOnce.clear();
      pump();
    },
    stop() {
      stopped = true;
      refuseAll("failed");
    },
  };
}
