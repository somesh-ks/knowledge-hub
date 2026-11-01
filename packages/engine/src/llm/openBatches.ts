import { rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Logger } from "../context.js";
import { readJsonIfExists } from "../curate/inputs.js";
import { writeJson } from "../curate/output.js";
import { runCacheDir } from "../run/plan.js";
import type { SpendTracker } from "../run/spend.js";
import type { BatchApi } from "./anthropicBatch.js";

/** `.cache/run/open-batches.json`: the Message Batches this run has sent and not yet read. */
export function openBatchesPath(root: string): string {
  return join(runCacheDir(root), "open-batches.json");
}

const OpenFile = z.object({
  version: z.literal(1),
  /** The plan's `created_at`; a list from another run is ignored. */
  run: z.string(),
  batches: z.array(z.object({ id: z.string(), model: z.string() })),
});
type OpenBatch = z.infer<typeof OpenFile>["batches"][number];

async function readOpen(root: string, run: string): Promise<OpenBatch[]> {
  const raw = await readJsonIfExists(openBatchesPath(root), "open-batches.json").catch(() => null);
  const parsed = raw === null ? null : OpenFile.safeParse(raw);
  return parsed?.success && parsed.data.run === run ? parsed.data.batches : [];
}

async function writeOpen(root: string, run: string, batches: OpenBatch[]): Promise<void> {
  if (batches.length === 0) await rm(openBatchesPath(root), { force: true });
  else await writeJson(openBatchesPath(root), { version: 1, run, batches });
}

/**
 * The run's list of open batches, kept on disk because the settle step is another process. A write
 * that fails is swallowed: the list is a safety net, and the run must go on without it.
 */
export function trackOpenBatches(root: string, run: string) {
  return {
    async add(id: string, model: string): Promise<void> {
      try {
        const open = await readOpen(root, run);
        await writeOpen(root, run, [...open.filter((b) => b.id !== id), { id, model }]);
      } catch {
        // See above.
      }
    },
    async remove(id: string): Promise<void> {
      try {
        await writeOpen(
          root,
          run,
          (await readOpen(root, run)).filter((b) => b.id !== id),
        );
      } catch {
        // See above.
      }
    },
  };
}

/** How long the settle step waits for one batch to end after cancelling it. */
const SETTLE_WAIT_MS = 3 * 60_000;
const SETTLE_POLL_MS = 10_000;

/**
 * Reads what the run's open batches billed into its spend (D294, audit C6): the batches the write
 * stage gave up on, or that a cancelled job left running. Each is cancelled (it may still be
 * running, and would be billed and written again live), waited for until it ends, and its
 * succeeded entries' tokens added to the run's units at the batch price. A batch that does not end
 * in time stays on the list. The caller saves the tracker.
 */
export async function settleOpenBatches(args: {
  root: string;
  run: string;
  api: BatchApi;
  spend: SpendTracker;
  log?: Logger;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  waitMs?: number;
}): Promise<void> {
  const { root, run, api, spend, log } = args;
  const now = args.now ?? Date.now;
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const track = trackOpenBatches(root, run);
  for (const { id, model } of await readOpen(root, run)) {
    await api.cancel(id).catch(() => undefined);
    const deadline = now() + (args.waitMs ?? SETTLE_WAIT_MS);
    let ended = false;
    while (!ended && now() < deadline) {
      ended = await api
        .status(id)
        .then((s) => s.status === "ended")
        .catch(() => false);
      if (!ended) await sleep(SETTLE_POLL_MS);
    }
    if (!ended) {
      log?.warn("A batch did not end in time; its spend is not counted yet", { batch: id });
      continue;
    }
    try {
      const outcomes = await api.results(id);
      for (const outcome of outcomes.values()) {
        if (outcome.type !== "succeeded") continue;
        spend.meter.addUnits("anthropic", model, "batch_input_tokens", outcome.reply.inputTokens);
        spend.meter.addUnits("anthropic", model, "batch_output_tokens", outcome.reply.outputTokens);
      }
      await track.remove(id);
      log?.info("Settled a batch the run had left open", { batch: id, entries: outcomes.size });
    } catch (error) {
      log?.warn("A batch's results could not be read; its spend is not counted yet", {
        batch: id,
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }
}
