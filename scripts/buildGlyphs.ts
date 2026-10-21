import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Compiles tokens/glyphs.json into the icon registries the site uses: one for Astro pages, and two
 * for the React player (a small one that loads with every page, and the full one for code that
 * loads on demand). Both come from the same file, so a glyph can never look different in
 * the two places.
 *
 *   npx tsx scripts/buildGlyphs.ts           writes the registries
 *   npx tsx scripts/buildGlyphs.ts --check   fails when a committed registry is stale
 *   npx tsx scripts/buildGlyphs.ts --fetch   rebuilds every path from the installed Phosphor package
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const GLYPHS_PATH = resolve(ROOT, "tokens/glyphs.json");
export const PAGE_REGISTRY_PATH = resolve(ROOT, "apps/web/src/lib/icons.ts");
export const PLAYER_REGISTRY_PATH = resolve(ROOT, "apps/web/src/player/ui/iconPaths.tsx");
/** Every player glyph. Only code that loads on demand imports it, so its size costs no page load. */
export const PLAYER_LAZY_REGISTRY_PATH = resolve(ROOT, "apps/web/src/player/ui/iconPathsLazy.tsx");

export const GENERATED_HEADER = "GENERATED FILE. Do not edit.";
const LINE_WIDTH = 100;

/** A Phosphor icon name: lower-case words joined by hyphens. */
const SYMBOL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type GlyphWeight = "regular" | "fill" | "bold";

export type GlyphTarget = "page" | "player" | "playerLazy";

export interface Glyph {
  /** Phosphor icon name, kebab-case. */
  phosphor: string;
  /** The Phosphor weight the path is taken from. */
  weight: GlyphWeight;
  targets: GlyphTarget[];
  /** The single path of the icon, in the document's view box. */
  d: string;
}

export interface GlyphDocument {
  $description: string;
  viewBox: string;
  source: string;
  sourceVersion: string;
  glyphs: Record<string, Glyph>;
}

export function loadGlyphs(path: string = GLYPHS_PATH): GlyphDocument {
  return JSON.parse(readFileSync(path, "utf8")) as GlyphDocument;
}

/** Problems that would produce a broken or misleading registry. Empty when the document is sound. */
export function validateGlyphs(doc: GlyphDocument): string[] {
  const problems: string[] = [];
  if (!/^-?\d+ -?\d+ \d+ \d+$/.test(doc.viewBox)) problems.push(`viewBox "${doc.viewBox}"`);
  for (const [name, glyph] of Object.entries(doc.glyphs)) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(name)) problems.push(`${name}: name is not camelCase`);
    if (!SYMBOL_NAME.test(glyph.phosphor ?? "")) problems.push(`${name}: no Phosphor name`);
    if (!["regular", "fill", "bold"].includes(glyph.weight)) problems.push(`${name}: no weight`);
    if (glyph.targets.length === 0) problems.push(`${name}: no target`);
    for (const target of glyph.targets) {
      if (target !== "page" && target !== "player" && target !== "playerLazy")
        problems.push(`${name}: target "${target}"`);
    }
    // A path is move, line and curve commands only. Anything else is not a path from the set.
    if (!/^[Mm][\dA-Za-z .,-]+$/.test(glyph.d)) {
      problems.push(`${name}: path is missing or malformed`);
    }
  }
  return problems;
}

/** The document as the formatter prints it: two-space JSON with each list of targets on one line. */
export function serializeGlyphs(doc: GlyphDocument): string {
  const json = JSON.stringify(doc, null, 2);
  const oneLine = (_list: string, body: string): string =>
    `[${body.trim().split(/,\s*/).join(", ")}]`;
  return `${json.replace(/\[\n\s+([^\]{}]+?)\n\s+\]/g, oneLine)}\n`;
}

function namesFor(doc: GlyphDocument, target: GlyphTarget): string[] {
  return Object.keys(doc.glyphs)
    .filter((name) => doc.glyphs[name]?.targets.includes(target))
    .sort();
}

/**
 * One object property the way the formatter prints it, so the generated file passes the lint
 * untouched: on one line when it fits, otherwise broken after the colon, except that a key shorter
 * than five characters never breaks (the overlap would be too small to help).
 */
function property(name: string, value: string, indent: string): string {
  const oneLine = `${indent}${name}: ${value},`;
  if (oneLine.length <= LINE_WIDTH || name.length < 5) return oneLine;
  return `${indent}${name}:\n${indent}  ${value},`;
}

function header(what: string): string[] {
  return [
    "/**",
    ` * ${GENERATED_HEADER} Source: tokens/glyphs.json, compiled by scripts/buildGlyphs.ts.`,
    " *",
    ` * ${what}`,
    " * One icon set: Phosphor, regular weight, with the fill weight where a glyph must read as",
    " * solid, the bold weight for the plus, and the bold dots for More",
    " * (Phosphor Icons, MIT License). Every glyph is one filled path in currentColor.",
    " * Decorative by default: the button or link that holds an icon carries the accessible name.",
    " */",
  ];
}

export function buildPageRegistry(doc: GlyphDocument): string {
  const lines = [
    ...header("The icon registry for Astro pages."),
    `export const ICON_VIEW_BOX = "${doc.viewBox}";`,
    "",
    "export const ICON_PATHS = {",
    ...namesFor(doc, "page").map((name) =>
      property(name, JSON.stringify(doc.glyphs[name]?.d ?? ""), "  "),
    ),
    "} as const;",
    "",
    "export type IconName = keyof typeof ICON_PATHS;",
    "",
  ];
  return lines.join("\n");
}

/** Null while no glyph targets the player, so the hand-written registry is left alone. */
export function buildPlayerRegistry(doc: GlyphDocument): string | null {
  const names = namesFor(doc, "player");
  if (names.length === 0) return null;
  const lines = [
    ...header(
      "The glyphs the React player's first load draws, offline too; lazy code uses LazyIcon.",
    ),
    `export const ICON_VIEW_BOX = "${doc.viewBox}";`,
    "",
    "export const ICON_PATHS = {",
    ...names.map((name) => property(name, JSON.stringify(doc.glyphs[name]?.d ?? ""), "  ")),
    "} as const;",
    "",
    "export type IconName = keyof typeof ICON_PATHS;",
    "",
  ];
  return lines.join("\n");
}

/** The full player registry: the first-load glyphs and the ones only on-demand code draws. */
export function buildPlayerLazyRegistry(doc: GlyphDocument): string {
  const names = [...new Set([...namesFor(doc, "player"), ...namesFor(doc, "playerLazy")])].sort();
  const lines = [
    ...header("The full icon registry for the React player, for code that loads on demand."),
    `export const ICON_VIEW_BOX = "${doc.viewBox}";`,
    "",
    "export const ICON_PATHS = {",
    ...names.map((name) => property(name, JSON.stringify(doc.glyphs[name]?.d ?? ""), "  ")),
    "} as const;",
    "",
    "export type IconName = keyof typeof ICON_PATHS;",
    "",
  ];
  return lines.join("\n");
}

/** Whether a committed registry is one this script wrote, as opposed to a hand-written one. */
export function isGenerated(source: string): boolean {
  return source.includes(GENERATED_HEADER);
}

/** Where an icon lives inside the Phosphor core package. */
export function symbolFile(glyph: Pick<Glyph, "phosphor" | "weight">): string {
  const suffix = glyph.weight === "regular" ? "" : `-${glyph.weight}`;
  return `assets/${glyph.weight}/${glyph.phosphor}${suffix}.svg`;
}

/** Extracts the single path from a Phosphor file. Throws when the file has another shape. */
export function pathFromSvg(svg: string): string {
  const paths = [...svg.matchAll(/<path d="([^"]+)"\s*\/>/g)];
  if (paths.length !== 1 || !paths[0]?.[1]) throw new Error("Expected exactly one path");
  return paths[0][1];
}

/** Rebuilds every path from the installed @phosphor-icons/core package (a dev dependency). */
export function rebuildGlyphs(doc: GlyphDocument): GlyphDocument {
  const root = resolve(ROOT, "node_modules/@phosphor-icons/core");
  const version = (
    JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { version: string }
  ).version;
  const glyphs: Record<string, Glyph> = {};
  for (const [name, glyph] of Object.entries(doc.glyphs)) {
    glyphs[name] = {
      ...glyph,
      d: pathFromSvg(readFileSync(resolve(root, symbolFile(glyph)), "utf8")),
    };
  }
  return { ...doc, sourceVersion: version, glyphs };
}

function writeRegistries(doc: GlyphDocument, check: boolean): number {
  const problems = validateGlyphs(doc);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`glyphs.json: ${problem}`);
    return 1;
  }
  const outputs: Array<[string, string | null]> = [
    [PAGE_REGISTRY_PATH, buildPageRegistry(doc)],
    [PLAYER_REGISTRY_PATH, buildPlayerRegistry(doc)],
    [PLAYER_LAZY_REGISTRY_PATH, buildPlayerLazyRegistry(doc)],
  ];
  let stale = 0;
  for (const [path, source] of outputs) {
    if (source === null) continue;
    let current = "";
    try {
      current = readFileSync(path, "utf8");
    } catch {
      current = "";
    }
    // A registry that was written by hand is replaced only on request, never by a routine build.
    if (path === PLAYER_REGISTRY_PATH && current !== "" && !isGenerated(current)) continue;
    if (current === source) continue;
    if (check) {
      console.error(`${path} is stale. Run: npm run glyphs`);
      stale += 1;
    } else {
      writeFileSync(path, source, "utf8");
      console.log(`Wrote ${path}`);
    }
  }
  return stale > 0 ? 1 : 0;
}

async function main(): Promise<number> {
  const args = new Set(process.argv.slice(2));
  let doc = loadGlyphs();
  if (args.has("--fetch")) {
    doc = rebuildGlyphs(doc);
    writeFileSync(GLYPHS_PATH, serializeGlyphs(doc), "utf8");
    console.log(`Rebuilt ${Object.keys(doc.glyphs).length} glyphs at ${doc.sourceVersion}`);
  }
  return writeRegistries(doc, args.has("--check"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
