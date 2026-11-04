import { existsSync } from "node:fs";
import { join } from "node:path";
import { FONT_FILE_BASENAMES, setFontDirectory } from "@singularity/cover";
import { findRepoRoot } from "./repoRoot";

let ready = false;

/**
 * The bundled code cannot find its fonts by their source path; a function carries them (includeFiles in
 * astro.config.mjs). Called before any cover is drawn or lettered, in a build as well, where it only
 * confirms the source tree's own files.
 */
export function loadCoverFonts(): void {
  if (ready) return;
  const directory = join(findRepoRoot(), "packages", "cover", "fonts");
  const missing = FONT_FILE_BASENAMES.filter((name) => !existsSync(join(directory, name)));
  // Drawn without them a cover has no date, and the CDN would keep it: fail instead.
  if (missing.length > 0) {
    throw new Error(`cover fonts missing from the function: ${missing.join(", ")}`);
  }
  setFontDirectory(directory);
  ready = true;
}
