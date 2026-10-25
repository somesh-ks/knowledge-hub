import type { ConfigBase } from "../store/configDocs.js";
import { CONFIG_DOCUMENT_PATHS, SNAPSHOT_TRAILER } from "../store/configPaths.js";
import type { GitRunner } from "./runGit.js";

/**
 * The config files as the last snapshot commit holds them: the newest commit with SNAPSHOT_TRAILER.
 * Before any commit carried it, the newest run commit that changed a config file stands in (every
 * run commit since the store went on, 2026-10-24, carried the store's copy). Null when neither
 * exists or git cannot answer (a shallow checkout), so hydrateConfig copies the store as before.
 */
export async function configBase(run: GitRunner): Promise<ConfigBase | null> {
  const newest = async (args: string[]): Promise<string | null> => {
    const result = await run(["log", "-1", "--format=%H", ...args]);
    const sha = result.code === 0 ? result.stdout.trim() : "";
    return sha === "" ? null : sha;
  };
  const sha =
    (await newest([`--grep=^${SNAPSHOT_TRAILER}$`])) ??
    (await newest(["-E", "--grep=^chore\\((digest|state)\\): ", "--", ...CONFIG_DOCUMENT_PATHS]));
  if (sha === null) return null;
  return async (path) => {
    const result = await run(["show", `${sha}:${path}`]);
    return result.code === 0 ? result.stdout : null;
  };
}
