import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { type BrandColors, readBrandColors } from "../apps/web/src/lib/brandColors";

/**
 * Renders the app icon from one SVG mark, so every size comes from the same artwork and can never
 * drift. The mark is the rail with its current node: a line, its upper half at full strength, and a
 * node at the midpoint. It is drawn in the accent color on the surface color. Every PNG is opaque,
 * because iOS composites transparency onto black and applies its own corner mask.
 *
 * Outputs go to apps/web/public/. Run: npx tsx scripts/buildIcons.ts
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "apps", "web", "public");
const TOKENS = join(HERE, "..", "apps", "web", "src", "styles", "tokens.css");

/** The mark's own box, in the units of the brand SVG (16 wide, 24 tall). */
const MARK = { width: 16, height: 24 } as const;

export interface IconSpec {
  file: string;
  size: number;
  /** How tall the mark is, as a share of the icon. Maskable icons keep to the central safe zone. */
  markShare: number;
}

export const ICON_SPECS: readonly IconSpec[] = [
  { file: "apple-touch-icon.png", size: 180, markShare: 0.56 },
  { file: "icon-192.png", size: 192, markShare: 0.56 },
  { file: "icon-512.png", size: 512, markShare: 0.56 },
  // Android crops a maskable icon to a circle that can be as small as 80 percent of its box.
  { file: "icon-maskable-512.png", size: 512, markShare: 0.42 },
];

function markPaths(): string {
  return (
    '<rect x="7" y="0" width="2" height="24" rx="1" opacity=".28"/>' +
    '<rect x="7" y="0" width="2" height="12" rx="1"/>' +
    '<circle cx="8" cy="12" r="5"/>'
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
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 24">' +
    `<title>Dispatch</title><style>g{fill:${colors.accentLight}}@media (prefers-color-scheme:dark){g{fill:${colors.accentDark}}}</style>` +
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

export function buildIcons(outDir: string = OUT, tokensPath: string = TOKENS): string[] {
  const colors = readBrandColors(tokensPath);
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const spec of ICON_SPECS) {
    const { png } = renderIcon(iconSvg(colors, spec.size, spec.markShare), spec.size);
    writeFileSync(join(outDir, spec.file), png);
    written.push(spec.file);
  }
  writeFileSync(join(outDir, "favicon.svg"), faviconSvg(colors));
  written.push("favicon.svg");
  return written;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Wrote ${buildIcons().join(", ")} to ${OUT}`);
}
