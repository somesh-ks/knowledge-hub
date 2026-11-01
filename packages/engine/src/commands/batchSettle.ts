import type { CommandRun } from "../context.js";
import { createAnthropicBatchApi } from "../llm/anthropicBatch.js";
import { settleOpenBatches } from "../llm/openBatches.js";
import { readPlan } from "../run/plan.js";
import { SpendTracker } from "../run/spend.js";

/**
 * `singularity batch-settle`: run.yml's step before Commit, run whatever the earlier steps did
 * (D294, audit C6). Settles the batches the run left open into its spend file, so the committed
 * ledger and the run log count them. It never fails the run: a batch it cannot settle stays on the
 * list and is reported.
 */
export const run: CommandRun = async (_argv, ctx) => {
  try {
    const plan = await readPlan(ctx.root);
    const key = ctx.env.ANTHROPIC_API_KEY;
    if (!plan || !key) return 0;
    const spend = new SpendTracker();
    await spend.resume(ctx.root, plan.created_at);
    await settleOpenBatches({
      root: ctx.root,
      run: plan.created_at,
      api: createAnthropicBatchApi({ apiKey: key }),
      spend,
      log: ctx.log,
    });
    await spend.save(ctx.root);
  } catch (error) {
    ctx.log.warn("The open batches were not settled", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  return 0;
};
