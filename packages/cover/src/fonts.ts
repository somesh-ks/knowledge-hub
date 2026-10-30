import { fileURLToPath } from "node:url";

/**
 * Schibsted Grotesk (SIL OFL 1.1, see fonts/OFL.txt). The variable file is the committed source;
 * resvg ignores variable axes and renders every weight as the default, so the weights the covers
 * use are static instances cut from it:
 *
 *   fonttools varLib.instancer "SchibstedGrotesk[wght].ttf" wght=<400|500|700|900> --update-name-table
 *
 * Rendering loads only these files and never touches system fonts, so output is identical everywhere.
 */
export const FONT_FAMILY = "Schibsted Grotesk";

const WEIGHT_FILES = ["Regular", "Medium", "Bold", "Black"] as const;

export const FONT_FILES: readonly string[] = WEIGHT_FILES.map((weight) =>
  fileURLToPath(new URL(`../fonts/SchibstedGrotesk-${weight}.ttf`, import.meta.url)),
);

export const RESVG_FONT_OPTIONS: {
  fontFiles: string[];
  loadSystemFonts: false;
  defaultFontFamily: string;
} = {
  fontFiles: [...FONT_FILES],
  loadSystemFonts: false,
  defaultFontFamily: FONT_FAMILY,
};

/** Font stack for SVG text. The named family is bundled; the rest only matter outside resvg. */
export const FONT_STACK = `${FONT_FAMILY}, system-ui, sans-serif`;

const FONT_FILE_NAMES = WEIGHT_FILES.map((weight) => `SchibstedGrotesk-${weight}.ttf`);

/**
 * Points the renderer at a directory that holds the font files. A bundled server function runs from
 * a different place than the source tree the build pinned the paths to, so the code that finds the
 * shipped files calls this before its first render.
 */
export function setFontDirectory(directory: string): void {
  const base = directory.replaceAll("\\", "/").replace(/\/$/, "");
  RESVG_FONT_OPTIONS.fontFiles = FONT_FILE_NAMES.map((name) => `${base}/${name}`);
}

/** The font file names the renderer needs, so a caller can check a directory holds them all. */
export const FONT_FILE_BASENAMES: readonly string[] = FONT_FILE_NAMES;
