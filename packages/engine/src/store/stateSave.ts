import { redact } from "../context.js";
import { connectConfigStore, databaseSecrets, stateStoreUrl } from "./configPaths.js";
import { hasPullRecord, pushState } from "./stateDocs.js";

/**
 * Commands whose commit also saves the run state to Postgres when the state store is on (D381): the
 * run (its stages and its failure record), the weekly podcast and the cost record they share. The
 * audio job (`publish`) has no database access by design (SEC-03); `config` and `learn` write
 * nothing the state store holds.
 */
export const STATE_SAVING_COMMANDS: ReadonlySet<string> = new Set(["run", "podcast", "costs"]);

/**
 * Send the state files this job changed to Postgres, if the state store is on and this job pulled
 * from it; do nothing if not (a failure record after a gate that never pulled has nothing to
 * send, and the command that stopped on the unreadable store has already failed). Throws with the database's own words (password removed) when the save fails.
 */
export async function saveStateIfOn(
  root: string,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const url = stateStoreUrl(env);
  if (url === null || !(await hasPullRecord(root))) return;
  try {
    await pushState(root, await connectConfigStore(url));
  } catch (error) {
    throw new Error(
      redact(String(error instanceof Error ? error.message : error), databaseSecrets(url)),
    );
  }
}
