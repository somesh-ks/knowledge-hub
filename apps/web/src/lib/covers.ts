import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Digest } from "@singularity/core";
import {
  type CoverMode,
  coverColors,
  renderCoverPng,
  renderLiveCoverSvg,
} from "@singularity/cover";
import sharp from "sharp";
import { loadCoverFonts } from "./coverFonts";

/**
 * What a cover is drawn from. A briefing and a podcast episode both have these. `mode` draws it for
 * the app's light or dark theme; left out, it is drawn as authored (the lock screen and social card).
 */
export type CoverSource = Pick<Digest, "id" | "date" | "kind" | "cover"> & { mode?: CoverMode };

/** An episode is drawn as an on-demand briefing, dated by when it was written. */
export function episodeCover(entry: {
  id: string;
  episode: { date: string };
  cover: Digest["cover"];
}): CoverSource {
  return { id: entry.id, date: entry.episode.date, kind: "on-demand", cover: entry.cover };
}

/**
 * The colour at the cover's edge as drawn: a monthly cover's season or a weekly's matte, not its
 * palette id. The box shows it before the image decodes, and a pale one gets a rim on the light page.
 */
export function coverEdge(source: CoverSource, mode: CoverMode): string {
  return coverColors(source.cover, { id: source.id, date: source.date, kind: source.kind, mode })
    .ground;
}

/**
 * The cover as the page draws it (D311): one small vector whose colours the page's own CSS sets, so
 * a theme, a style or a hue changes it with no request. Drawn once for each record per process.
 */
const liveCovers = new Map<string, string>();

export function coverLiveSvg(source: CoverSource): string {
  loadCoverFonts();
  const key = `${source.id}|${source.date}|${source.kind}|${JSON.stringify(source.cover)}`;
  let svg = liveCovers.get(key);
  if (svg === undefined) {
    svg = renderLiveCoverSvg(source.cover, { id: source.id, date: source.date, kind: source.kind });
    liveCovers.set(key, svg);
  }
  return svg;
}

/** Where a record's live cover is served: `/covers/<id>.svg`, versioned like the images. */
export function coverLiveSrc(id: string, generatedAt?: string): string {
  return `/covers/${id}.svg${coverVersion(generatedAt)}`;
}

/**
 * The `?v=` a cover address carries: when its record was generated, in base 36. A regenerated
 * briefing or episode keeps its id and gets a new version, so the browser, the CDN and the service
 * worker fetch the new cover. A record without a time gets no version and its old address.
 */
export function coverVersion(generatedAt: string | undefined): string {
  const time = generatedAt === undefined ? Number.NaN : Date.parse(generatedAt);
  return Number.isNaN(time) ? "" : `?v=${time.toString(36)}`;
}

/** The address a record's cover is shown at: `/covers/<id>-512.webp?v=<version>`. */
export function coverSrc(id: string, size: CoverSize, generatedAt?: string): string {
  return `/covers/${id}-${size}.webp${coverVersion(generatedAt)}`;
}

export type CoverSize = 512 | 1024;
export const COVER_SIZES: readonly CoverSize[] = [512, 1024];

/**
 * Written under a name of its own and renamed into place, so a request that reads the cache while
 * another writes it never sees half an image: a cover drawn on request (D256) is kept for a year.
 */
async function writeCacheFile(file: string, body: Uint8Array): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, body);
  await rename(temporary, file);
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

/**
 * A hash of everything that changes how a cover looks: the renderer's source, its palettes and its
 * fonts. Cover cache keys include it, so editing a template invalidates every cached image and
 * nothing else does.
 */
export async function rendererFingerprint(
  directories: readonly string[],
  files: readonly string[] = [],
): Promise<string> {
  const hash = createHash("sha256");
  const all = [...(await Promise.all(directories.map(listFiles))).flat(), ...files].sort();
  for (const file of all) {
    hash.update(file.replaceAll("\\", "/").split("/").slice(-3).join("/"));
    hash.update(await readFile(file));
  }
  return hash.digest("hex");
}

/** Deterministic cache key for one image: same digest cover, same renderer, same size. */
export function coverCacheKey(digest: CoverSource, size: CoverSize, fingerprint: string): string {
  const input = JSON.stringify({
    fingerprint,
    size,
    spec: digest.cover,
    meta: { id: digest.id, date: digest.date, kind: digest.kind, mode: digest.mode },
  });
  return createHash("sha256").update(input).digest("hex");
}

export interface CoverCacheOptions {
  cacheDir: string;
  fingerprint: string;
  render?: typeof renderCoverPng;
}

/** The cover PNG, from the content-addressed cache when present, rendered and stored otherwise. */
export async function coverPng(
  digest: CoverSource,
  size: CoverSize,
  options: CoverCacheOptions,
): Promise<Uint8Array<ArrayBuffer>> {
  const render = options.render ?? renderCoverPng;
  const file = join(options.cacheDir, `${coverCacheKey(digest, size, options.fingerprint)}.png`);
  try {
    return new Uint8Array(await readFile(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // Copied so the bytes are backed by a plain ArrayBuffer, which a Response accepts as a body.
  const png = new Uint8Array(
    render(
      digest.cover,
      {
        id: digest.id,
        date: digest.date,
        kind: digest.kind,
        ...(digest.mode ? { mode: digest.mode } : {}),
      },
      size,
    ),
  );
  await mkdir(options.cacheDir, { recursive: true });
  await writeCacheFile(file, png);
  return png;
}

/**
 * The cover as lossless WebP, from the same cache. Measured on the renderer's output (2026-10-10):
 * pixel-identical to the PNG at about a third of the bytes (5.6 against 17.7 KB at 512 px, 11.7
 * against 41.6 at 1024), encoded in about 30 ms. Lossy WebP was larger on these flat shapes, and
 * AVIF saved a few KB more only by losing edges and taking 80 times as long to encode.
 */
export async function coverWebp(
  digest: CoverSource,
  size: CoverSize,
  options: CoverCacheOptions,
): Promise<Uint8Array<ArrayBuffer>> {
  const file = join(options.cacheDir, `${coverCacheKey(digest, size, options.fingerprint)}.webp`);
  try {
    return new Uint8Array(await readFile(file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const png = await coverPng(digest, size, options);
  const webp = new Uint8Array(await sharp(png).webp({ lossless: true, effort: 6 }).toBuffer());
  await writeCacheFile(file, webp);
  return webp;
}
