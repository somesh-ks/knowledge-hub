/**
 * The run state the engine commits, as this build holds it: Vite compiles these files into the server
 * build, as it does the ledger (costSource.ts). The Health page reads the content store first and
 * these only when the store cannot answer, saying so, since they are a deploy behind.
 */
const REPO_ROOT = "../../../../";

const stateFiles = import.meta.glob<string>(
  ["../../../../state/last-run.json", "../../../../state/source-health.json"],
  { query: "?raw", import: "default", eager: true },
);

/** The build's text of a state file by repository path, or null when the build has none. */
export function bundledStateFile(path: string): string | null {
  return stateFiles[`${REPO_ROOT}${path}`] ?? null;
}
