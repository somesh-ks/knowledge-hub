import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeDigest } from "../testing/digestFactory";
import { coverCacheKey, coverPng, coverWebp, rendererFingerprint } from "./covers";

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "singularity-covers-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const fakePng = (marker: number) => new Uint8Array([137, 80, 78, 71, marker]);

describe("coverCacheKey", () => {
  const digest = makeDigest();

  it("is deterministic", () => {
    expect(coverCacheKey(digest, 512, "abc")).toBe(coverCacheKey(digest, 512, "abc"));
  });

  it("changes with the size, the renderer and the cover spec", () => {
    const base = coverCacheKey(digest, 512, "abc");
    expect(coverCacheKey(digest, 1024, "abc")).not.toBe(base);
    expect(coverCacheKey(digest, 512, "def")).not.toBe(base);
    const reseeded = makeDigest({ cover: { ...digest.cover, seed: 2 } });
    expect(coverCacheKey(reseeded, 512, "abc")).not.toBe(base);
  });

  it("changes with the date, which the cover prints", () => {
    const other = makeDigest({ id: "2026-10-08" });
    expect(coverCacheKey(other, 512, "abc")).not.toBe(coverCacheKey(digest, 512, "abc"));
  });

  it("ignores everything the cover does not draw", () => {
    const edited = makeDigest({ read_minutes: 9, listen_minutes: 9 });
    expect(coverCacheKey(edited, 512, "abc")).toBe(coverCacheKey(digest, 512, "abc"));
  });
});

describe("rendererFingerprint", () => {
  it("changes when a renderer file changes", async () => {
    const source = join(directory, "src");
    await mkdir(source);
    await writeFile(join(source, "template.ts"), "export const a = 1;");
    const before = await rendererFingerprint([source]);
    await writeFile(join(source, "template.ts"), "export const a = 2;");
    expect(await rendererFingerprint([source])).not.toBe(before);
  });

  it("is stable when nothing changes and includes extra files", async () => {
    const source = join(directory, "src");
    await mkdir(source);
    await writeFile(join(source, "a.ts"), "x");
    const palettes = join(directory, "covers.json");
    await writeFile(palettes, "{}");
    const first = await rendererFingerprint([source], [palettes]);
    expect(await rendererFingerprint([source], [palettes])).toBe(first);
    await writeFile(palettes, '{"a":1}');
    expect(await rendererFingerprint([source], [palettes])).not.toBe(first);
  });
});

describe("coverPng", () => {
  const options = () => ({ cacheDir: join(directory, "cache"), fingerprint: "fp" });

  it("renders once and then serves from the cache", async () => {
    const render = vi.fn(() => fakePng(1));
    const digest = makeDigest();
    const first = await coverPng(digest, 512, { ...options(), render });
    const second = await coverPng(digest, 512, { ...options(), render });
    expect(render).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("renders again for another size or another digest", async () => {
    const render = vi.fn(() => fakePng(2));
    await coverPng(makeDigest(), 512, { ...options(), render });
    await coverPng(makeDigest(), 1024, { ...options(), render });
    await coverPng(makeDigest({ id: "2026-10-08" }), 512, { ...options(), render });
    expect(render).toHaveBeenCalledTimes(3);
    expect(await readdir(join(directory, "cache"))).toHaveLength(3);
  });

  it("renders again after the renderer changes", async () => {
    const render = vi.fn(() => fakePng(3));
    await coverPng(makeDigest(), 512, {
      cacheDir: join(directory, "cache"),
      fingerprint: "one",
      render,
    });
    await coverPng(makeDigest(), 512, {
      cacheDir: join(directory, "cache"),
      fingerprint: "two",
      render,
    });
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("passes the spec and the cover facts to the renderer", async () => {
    const render = vi.fn(() => fakePng(4));
    const digest = makeDigest({ id: "2026-10-04-weekly", kind: "weekly" });
    await coverPng(digest, 1024, { ...options(), render });
    expect(render).toHaveBeenCalledWith(
      digest.cover,
      { id: "2026-10-04-weekly", date: "2026-10-04", kind: "weekly" },
      1024,
    );
  });
});

describe("coverWebp", () => {
  const options = () => ({ cacheDir: join(directory, "cache"), fingerprint: "fp" });
  // A real PNG with hard-edged flat colour, like a cover, so the encoder has something to keep.
  const realPng = async () =>
    new Uint8Array(
      await sharp({
        create: { width: 8, height: 8, channels: 3, background: { r: 24, g: 40, b: 168 } },
      })
        .composite([
          {
            input: Buffer.from([250, 220, 60]),
            raw: { width: 1, height: 1, channels: 3 },
            left: 3,
            top: 3,
          },
        ])
        .png()
        .toBuffer(),
    );

  it("is WebP with the PNG's exact pixels, rendered once and then cached", async () => {
    const png = await realPng();
    const render = vi.fn(() => png);
    const digest = makeDigest();
    const webp = await coverWebp(digest, 512, { ...options(), render });
    expect(Buffer.from(webp.subarray(8, 12)).toString("ascii")).toBe("WEBP");
    const decoded = await sharp(webp).removeAlpha().raw().toBuffer();
    expect(decoded.equals(await sharp(png).removeAlpha().raw().toBuffer())).toBe(true);
    expect(await coverWebp(digest, 512, { ...options(), render })).toEqual(webp);
    expect(render).toHaveBeenCalledTimes(1);
  });
});
