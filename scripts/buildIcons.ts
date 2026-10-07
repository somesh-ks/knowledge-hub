import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { type BrandColors, readBrandColors } from "../apps/web/src/lib/brandColors";

/**
 * Renders the app icon from one SVG mark, so every size comes from the same artwork and can never
 * drift. The mark is a ringed dot: a point inside a circle, the same figure as the ringed play
 * glyph on the play chip. It is drawn in the accent color on the surface color. Every PNG is opaque,
 * because iOS composites transparency onto black and applies its own corner mask.
 *
 * Outputs go to apps/web/public/.
 *   npm run icons              writes the files
 *   npm run icons -- --check   fails when a committed file is stale
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "apps", "web", "public");
const TOKENS = join(HERE, "..", "apps", "web", "src", "styles", "tokens.css");

/** The mark's own box, in the units of the brand SVG. */
const MARK = { width: 24, height: 24 } as const;

export interface IconSpec {
  file: string;
  size: number;
  /** How tall the mark is, as a share of the icon. Maskable icons keep to the central safe zone. */
  markShare: number;
}

export const ICON_SPECS: readonly IconSpec[] = [
  { file: "apple-touch-icon.png", size: 180, markShare: 0.5 },
  { file: "icon-192.png", size: 192, markShare: 0.5 },
  { file: "icon-512.png", size: 512, markShare: 0.5 },
  // Android crops a maskable icon to a circle that can be as small as 80 percent of its box.
  { file: "icon-maskable-512.png", size: 512, markShare: 0.42 },
];

/** The ring as one even-odd path, so the whole mark takes a single fill and needs no stroke. */
export const MARK_RING =
  "M12 1.25a10.75 10.75 0 1 0 0 21.5 10.75 10.75 0 0 0 0-21.5Zm0 2.5a8.25 8.25 0 1 1 0 16.5 8.25 8.25 0 0 1 0-16.5Z";
export const MARK_DOT_RADIUS = 4.5;

function markPaths(): string {
  return (
    `<path fill-rule="evenodd" d="${MARK_RING}"/>` +
    `<circle cx="12" cy="12" r="${MARK_DOT_RADIUS}"/>`
  );
}

/** The icon as SVG: an opaque surface square with the mark centered in the accent color. */
export function iconSvg(colors: BrandColors, size: number, markShare: number): string {
  const scale = (size * markShare) / MARK.height;
  const x = (size - MARK.width * scale) / 2;
  const y = (size - MARK.height * scale) / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
    `<rect width="${size}" height="${size}" fill="${colors.surfaceLight}"/>` +
    `<g transform="translate(${x.toFixed(3)} ${y.toFixed(3)}) scale(${scale.toFixed(5)})" fill="${colors.accentLight}">${markPaths()}</g>` +
    "</svg>"
  );
}

/** Browser-tab icon: the bare mark on a transparent ground, in the accent color for each scheme. */
export function faviconSvg(colors: BrandColors): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    `<title>Singularity</title><style>g{fill:${colors.accentLight}}@media (prefers-color-scheme:dark){g{fill:${colors.accentDark}}}</style>` +
    `<g>${markPaths()}</g></svg>\n`
  );
}

export interface RenderedIcon {
  png: Uint8Array;
  /** Raw RGBA, used to check that nothing is transparent. */
  pixels: Uint8Array;
  width: number;
  height: number;
}

export function renderIcon(svg: string, size: number): RenderedIcon {
  const image = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render();
  return {
    png: new Uint8Array(image.asPng()),
    pixels: new Uint8Array(image.pixels),
    width: image.width,
    height: image.height,
  };
}

/** Every output file with the bytes it should hold, in a fixed order. */
export function iconFiles(tokensPath: string = TOKENS): Array<[file: string, bytes: Uint8Array]> {
  const colors = readBrandColors(tokensPath);
  const files: Array<[string, Uint8Array]> = ICON_SPECS.map((spec) => [
    spec.file,
    renderIcon(iconSvg(colors, spec.size, spec.markShare), spec.size).png,
  ]);
  files.push(["favicon.svg", new TextEncoder().encode(faviconSvg(colors))]);
  return files;
}

export function buildIcons(outDir: string = OUT, tokensPath: string = TOKENS): string[] {
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const [file, bytes] of iconFiles(tokensPath)) {
    writeFileSync(join(outDir, file), bytes);
    written.push(file);
  }
  return written;
}

/** Files in `outDir` that are missing or differ from what the tokens and the mark now produce. */
export function staleIcons(outDir: string = OUT, tokensPath: string = TOKENS): string[] {
  const stale: string[] = [];
  for (const [file, bytes] of iconFiles(tokensPath)) {
    const path = join(outDir, file);
    if (!existsSync(path) || !Buffer.from(bytes).equals(readFileSync(path))) stale.push(file);
  }
  return stale;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const stale = staleIcons();
    if (stale.length > 0) {
      console.error(`Stale app icons: ${stale.join(", ")}. Run: npm run icons`);
      process.exit(1);
    }
  } else {
    console.log(`Wrote ${buildIcons().join(", ")} to ${OUT}`);
  }
}
