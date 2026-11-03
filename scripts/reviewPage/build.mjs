#!/usr/bin/env node
/**
 * Builds a review page (docs/engineering/review-page.md): one artifact per PR that shows the stills
 * of its current version, grouped by change and numbered, in the app's own look, with comments that
 * land on a spot of a still.
 *
 *   node scripts/reviewPage/build.mjs <review-dir>
 *
 * <review-dir> holds review.json and the stills it names (paths relative to it). Writes
 * <review-dir>/index.html and prints the Artifact publish call. The app's tokens, font, icons and the
 * Button, Badge, Banner and Icon rules are read from apps/web at build time, so the page follows the
 * design system as it changes. Plain Node, no dependencies.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const STYLES = join(ROOT, "apps", "web", "src", "styles");
const DS_FILES = ["buttons.css", "badge.css", "banner.css", "icon.css"];
const ICONS = ["close", "chevronLeft", "chevronRight", "pencilSimple", "search", "openInNew", "info"];
const TAG_KEYS = ["device", "browser", "theme", "mood", "hue", "state"];

function fail(message) {
  console.error(`review page: ${message}`);
  process.exit(1);
}

/** Image size from the file header (PNG, WebP, JPEG, GIF), so the page reserves the box before load. */
export function imageSize(buf) {
  if (buf.subarray(1, 4).toString() === "PNG") return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.subarray(0, 3).toString() === "GIF") return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") {
    const kind = buf.subarray(12, 16).toString();
    if (kind === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (kind === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
    }
    if (kind === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xc3) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

/** Checks review.json and fills in what the page derives: sizes, and new_in defaulting to this version. */
export function normalise(review, dir) {
  for (const key of ["pr", "pr_url", "title", "version", "updated", "changes"]) {
    if (review[key] == null) fail(`review.json needs "${key}"`);
  }
  const ids = new Set();
  for (const change of review.changes) {
    if (!change.id || !change.title || !Array.isArray(change.stills)) fail("each change needs id, title and stills");
    for (const still of change.stills) {
      if (!/^[a-z0-9][a-z0-9.-]{0,60}$/.test(still.id ?? "")) fail(`still id "${still.id}" must be lowercase letters, digits, dots and dashes`);
      if (ids.has(still.id)) fail(`still id "${still.id}" is used twice`);
      ids.add(still.id);
      if (!still.caption) fail(`still "${still.id}" needs a caption`);
      const file = join(dir, still.file ?? "");
      if (!still.file || !existsSync(file) || !statSync(file).isFile()) fail(`still "${still.id}": file "${still.file}" not found`);
      for (const key of Object.keys(still.tags ?? {})) if (!TAG_KEYS.includes(key)) fail(`still "${still.id}": unknown tag "${key}"`);
      still.new_in ??= review.version;
      if (!still.width || !still.height) Object.assign(still, imageSize(readFileSync(file)) ?? {});
    }
  }
  return review;
}

function iconSvgs() {
  const src = readFileSync(join(ROOT, "apps", "web", "src", "lib", "icons.ts"), "utf8");
  const out = {};
  for (const name of ICONS) {
    const m = new RegExp(`\\n  ${name}:\\s*"([^"]+)"`).exec(src);
    if (!m) fail(`icon "${name}" not found in icons.ts`);
    out[name] = `<svg class="icon-glyph" viewBox="0 0 256 256" aria-hidden="true"><path d="${m[1]}"/></svg>`;
  }
  return out;
}

function fontFace() {
  const font = readFileSync(join(ROOT, "apps", "web", "src", "assets", "fonts", "google-sans-flex-latin-wght-normal.woff2"));
  const css = readFileSync(join(STYLES, "fonts.css"), "utf8");
  const fallback = /@font-face\s*{\s*font-family:\s*"Google Sans Flex Fallback";[^}]*}/.exec(css)?.[0] ?? "";
  return `@font-face{font-family:"Google Sans Flex Variable";font-style:normal;font-display:swap;font-weight:400 700;src:url(data:font/woff2;base64,${font.toString("base64")}) format("woff2-variations");}\n${fallback}`;
}

export function build(dir) {
  const reviewPath = join(dir, "review.json");
  if (!existsSync(reviewPath)) fail(`${reviewPath} not found`);
  const review = normalise(JSON.parse(readFileSync(reviewPath, "utf8")), dir);
  const icons = iconSvgs();
  const data = JSON.stringify(review).replace(/</g, "\\u003c");
  // Function replacers: the inlined CSS and data hold "$" sequences that a string replacement would read.
  let html = readFileSync(join(HERE, "template.html"), "utf8")
    .replace("@TITLE@", () => `${review.short_title ?? "Review"} #${review.pr}`)
    .replace("@FONT_FACE@", () => fontFace())
    .replace("/*@TOKENS@*/", () => readFileSync(join(STYLES, "tokens.css"), "utf8"))
    .replace("/*@DS@*/", () => DS_FILES.map((f) => readFileSync(join(STYLES, f), "utf8")).join("\n"))
    .replace("/*@DATA@*/", () => data);
  html = html.replace(/@ICON_([A-Za-z]+)@/g, (_, name) => icons[name] ?? fail(`icon "${name}" is not in ICONS`));
  writeFileSync(join(dir, "index.html"), html);
  const files = Object.fromEntries(review.changes.flatMap((c) => c.stills.map((s) => [s.file, s.file])));
  return { review, files, bytes: Buffer.byteLength(html) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = resolve(process.argv[2] ?? fail("usage: node scripts/reviewPage/build.mjs <review-dir>"));
  const { review, files, bytes } = build(dir);
  console.log(`Built ${join(dir, "index.html")} (${Math.round(bytes / 1024)} KB, ${Object.keys(files).length} stills).`);
  console.log("Publish with the Artifact tool:");
  console.log(JSON.stringify({ file_path: join(dir, "index.html"), root: dir, files, ...(review.artifact_url ? { url: review.artifact_url } : { icon: "review" }) }, null, 2));
}
