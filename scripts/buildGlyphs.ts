import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Compiles tokens/glyphs.json into the two icon registries the site uses: one for Astro pages and
 * one for the React player. Both come from the same file, so a glyph can never look different in
 * the two places.
 *
 *   npx tsx scripts/buildGlyphs.ts           writes the registries
 *   npx tsx scripts/buildGlyphs.ts --check   fails when a committed registry is stale
 *   npx tsx scripts/buildGlyphs.ts --fetch   downloads every path again (the only network use)
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const GLYPHS_PATH = resolve(ROOT, "tokens/glyphs.json");
export const PAGE_REGISTRY_PATH = resolve(ROOT, "apps/web/src/lib/icons.ts");
export const PLAYER_REGISTRY_PATH = resolve(ROOT, "apps/web/src/player/ui/iconPaths.tsx");

export const GENERATED_HEADER = "GENERATED FILE. Do not edit.";
const LINE_WIDTH = 100;

export type GlyphTarget = "page" | "player";

export interface Glyph {
  /** Material Symbols name, snake_case. */
  symbol: string;
  /** True for the filled variant of the symbol. */
  fill?: boolean;
  targets: GlyphTarget[];
  /** The single path of the symbol, in the document's view box. */
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
    if (!/^[a-z0-9_]+$/.test(glyph.symbol)) problems.push(`${name}: symbol "${glyph.symbol}"`);
    if (glyph.targets.length === 0) problems.push(`${name}: no target`);
    for (const target of glyph.targets) {
      if (target !== "page" && target !== "player") problems.push(`${name}: target "${target}"`);
    }
    // A path is move, line and curve commands only. Anything else is not a path from the set.
    if (!/^[Mm][\dA-Za-z .,-]+$/.test(glyph.d)) {
      problems.push(`${name}: path is missing or malformed`);
    }
  }
  return problems;
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
    " * One icon set: Material Symbols, outlined, weight 400 (Google, Apache License 2.0). Every",
    " * glyph is one filled path in currentColor. Decorative by default: the button or link that",
    " * holds an icon carries the accessible name.",
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
    ...header("The icon registry for the React player."),
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

function symbolFile(glyph: Glyph): string {
  return `${glyph.symbol}${glyph.fill ? "-fill" : ""}.svg`;
}

/** Extracts the single path from a Material Symbols file. Throws when the file has another shape. */
export function pathFromSvg(svg: string): string {
  const paths = [...svg.matchAll(/<path d="([^"]+)"\s*\/>/g)];
  if (paths.length !== 1 || !paths[0]?.[1]) throw new Error("Expected exactly one path");
  return paths[0][1];
}

async function fetchGlyphs(doc: GlyphDocument): Promise<GlyphDocument> {
  let version = "";
  const glyphs: Record<string, Glyph> = {};
  for (const [name, glyph] of Object.entries(doc.glyphs)) {
    const url = `${doc.source}@${doc.sourceVersion || "latest"}/outlined/${symbolFile(glyph)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${name}: ${response.status} for ${url}`);
    version ||= response.headers.get("x-jsd-version") ?? "";
    glyphs[name] = { ...glyph, d: pathFromSvg(await response.text()) };
    process.stdout.write(".");
  }
  process.stdout.write("\n");
  return { ...doc, sourceVersion: doc.sourceVersion || version, glyphs };
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
    doc = await fetchGlyphs(doc);
    writeFileSync(GLYPHS_PATH, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
    console.log(`Fetched ${Object.keys(doc.glyphs).length} glyphs at ${doc.sourceVersion}`);
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
