import type { Logger } from "../context.js";
import type { BatchApi, BatchOutcome } from "./anthropicBatch.js";
import type { ApiRequest } from "./providers.js";

export interface BatchRunOptions {
  /** Epoch ms. Entries still running then are cancelled and left to the caller's own calls. */
  until: number;
  log?: Logger;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Time between status reads. */
  pollMs?: number;
  /** After cancelling, how long to wait for the batch to report "ended". */
  cancelWaitMs?: number;
  /** Consecutive failed status reads that end the wait. */
  maxPollFailures?: number;
  /** Called once the batch is accepted: the run now owes a look at what it billed. */
  onOpen?: (batchId: string) => void | Promise<void>;
  /** Called once the results are read. A batch the wait gave up on never gets here. */
  onClosed?: (batchId: string) => void | Promise<void>;
}

const POLL_MS = 30_000;
const CANCEL_WAIT_MS = 5 * 60_000;
const MAX_POLL_FAILURES = 6;

/**
 * Submits `entries` as one batch and waits for it, until `options.until`. Returns the outcome of
 * each entry that finished; an entry missing from the map (or not `succeeded`) is the caller's to
 * write the usual way. A batch that cannot be submitted or read returns an empty map instead of
 * throwing: the scheduled run must still publish, only at full price (D294).
 *
 * At the cutoff the batch is cancelled and its status polled until it ends, because results read
 * before it ends would miss entries that were still finishing; those results are the ones billed.
 * A batch the wait gives up on (status unreadable, cancel not ended, results unreadable) stays
 * open: `settleOpenBatches` reads what it billed once the run's stages are done.
 */
export async function runBatch(
  api: BatchApi,
  entries: ReadonlyArray<{ customId: string; request: ApiRequest }>,
  options: BatchRunOptions,
): Promise<Map<string, BatchOutcome>> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = options.pollMs ?? POLL_MS;
  const log = options.log;
  // Past the cutoff there is nothing to wait for (a later pass of the same run): submitting would
  // only pay for a batch cancelled at once.
  if (entries.length === 0 || now() >= options.until) return new Map();

  let batchId: string;
  try {
    batchId = await api.submit(entries);
  } catch (error) {
    log?.warn("The batch was not accepted; writing the stories one by one", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return new Map();
  }
  log?.info("Writer batch submitted", { batch: batchId, requests: entries.length });
  await options.onOpen?.(batchId);

  let cancelled = false;
  let cancelDeadline = Number.POSITIVE_INFINITY;
  let failures = 0;
  for (;;) {
    if (!cancelled && now() >= options.until) {
      cancelled = true;
      cancelDeadline = now() + (options.cancelWaitMs ?? CANCEL_WAIT_MS);
      log?.warn("The writer batch is not done at the cutoff; cancelling it", { batch: batchId });
      try {
        await api.cancel(batchId);
      } catch (error) {
        log?.warn("The batch could not be cancelled", {
          reason: error instanceof Error ? error.message : "unknown",
        });
      }
    }
    try {
      const { status } = await api.status(batchId);
      failures = 0;
      if (status === "ended") break;
    } catch (error) {
      failures += 1;
      log?.warn("The batch status could not be read", {
        reason: error instanceof Error ? error.message : "unknown",
        failures,
      });
      if (failures >= (options.maxPollFailures ?? MAX_POLL_FAILURES)) {
        // Giving up must not leave the batch running: it would be billed and then written again live.
        if (!cancelled) await api.cancel(batchId).catch(() => undefined);
        return new Map();
      }
    }
    if (cancelled && now() >= cancelDeadline) return new Map();
    await sleep(pollMs);
  }
  try {
    const outcomes = await api.results(batchId);
    await options.onClosed?.(batchId);
    return outcomes;
  } catch (error) {
    log?.warn("The batch results could not be read", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return new Map();
  }
}
