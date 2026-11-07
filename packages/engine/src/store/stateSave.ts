import { redact } from "../context.js";
import { connectConfigStore, databaseSecrets, stateStoreUrl } from "./configPaths.js";
import { hasPullRecord, pushState, stateScopeFor } from "./stateDocs.js";

/**
 * Commands whose commit also saves the run state to Postgres when the state store is on (D381): the
 * run (its stages and its failure record), the weekly podcast and the cost record they share, and
 * the audio job (`publish`), which holds a login of its own that sees only its cost rows (SEC-03).
 * `config` and `learn` write nothing the state store holds.
 */
export const STATE_SAVING_COMMANDS: ReadonlySet<string> = new Set([
  "run",
  "podcast",
  "costs",
  "publish",
]);

/**
 * Send the state files this job changed to Postgres, if the state store is on and this job pulled
 * from it; do nothing if not (a failure record after a gate that never pulled has nothing to
 * send, and the command that stopped on the unreadable store has already failed). Throws with the database's own words (password removed) when the save fails.
 */
export async function saveStateIfOn(
  root: string,
  command: string,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const url = stateStoreUrl(env);
  if (url === null) return;
  if (!(await hasPullRecord(root))) {
    // A failure record after a gate that could not pull lands here too; both are worth one line.
    process.stderr.write(
      "singularity: the state store is on but this job did not pull from it, so its state was not saved.\n",
    );
    return;
  }
  try {
    await pushState(root, await connectConfigStore(url), undefined, stateScopeFor(command));
  } catch (error) {
    throw new Error(
      redact(String(error instanceof Error ? error.message : error), databaseSecrets(url)),
    );
  }
}
