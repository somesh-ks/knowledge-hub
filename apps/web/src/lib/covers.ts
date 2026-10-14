import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Digest } from "@dispatch/core";
import { renderCoverPng } from "@dispatch/cover";
import sharp from "sharp";

/** What a cover is drawn from. A briefing and a podcast episode both have these. */
export type CoverSource = Pick<Digest, "id" | "date" | "kind" | "cover">;

/** An episode is drawn as an on-demand briefing, dated by when it was written. */
export function episodeCover(entry: {
  id: string;
  episode: { date: string };
  cover: Digest["cover"];
}): CoverSource {
  return { id: entry.id, date: entry.episode.date, kind: "on-demand", cover: entry.cover };
}

export type CoverSize = 512 | 1024;
export const COVER_SIZES: readonly CoverSize[] = [512, 1024];

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
    meta: { id: digest.id, date: digest.date, kind: digest.kind },
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
    render(digest.cover, { id: digest.id, date: digest.date, kind: digest.kind }, size),
  );
  await mkdir(options.cacheDir, { recursive: true });
  await writeFile(file, png);
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
  await writeFile(file, webp);
  return webp;
}
