import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FONT_FILE_BASENAMES, setFontDirectory } from "@singularity/cover";
import type { APIRoute, GetStaticPaths } from "astro";
import { coverPng, coverWebp } from "../../lib/covers";
import { findRepoRoot } from "../../lib/repoRoot";
import {
  type ContentRepoDeps,
  expireContentManifest,
  loadStoreSite,
  loadStoreSiteChecked,
} from "../../server/contentRepo";
import {
  type CoverResolution,
  coverCacheHeaders,
  NOT_FOUND_HEADERS,
  parseCoverPath,
  resolveCover,
  versionOf,
} from "../../server/coverRoute";

/**
 * A cover the build did not draw, drawn when it is asked for (D256): a briefing or episode newer
 * than the last deploy (D173). Vercel serves a built file before any function, so this route only
 * sees the addresses no file answers; the build's own routes draw the rest. It sits at the public
 * address itself: a rewrite to another path reached this function with the reader's original URL,
 * which no route matched, so it answered an empty 404 (2026-11-01).
 */
export const prerender = false;
// The static test build prerenders every route; no cover is drawn on demand there.
export const getStaticPaths = (() => []) satisfies GetStaticPaths;

let fontsReady = false;

/** The bundled code cannot find its fonts by their source path; the function carries them (includeFiles). */
function loadShippedFonts(): void {
  if (fontsReady) return;
  const directory = join(findRepoRoot(), "packages", "cover", "fonts");
  const missing = FONT_FILE_BASENAMES.filter((name) => !existsSync(join(directory, name)));
  // Drawn without them a cover has no date, and the CDN would keep it: fail instead.
  if (missing.length > 0)
    throw new Error(`cover fonts missing from the function: ${missing.join(", ")}`);
  setFontDirectory(directory);
  fontsReady = true;
}

const CACHE = { cacheDir: join(tmpdir(), "singularity-covers"), fingerprint: "function" };

/** At most one extra manifest read this often per instance, so junk addresses cost a bounded few reads. */
const MIN_REFRESH_MS = 5_000;
let lastRefresh = Number.NEGATIVE_INFINITY;

/** The manifest re-read in flight; requests that arrive while it runs wait for it, not for a 503. */
let refreshing: ReturnType<typeof loadStoreSiteChecked> | null = null;

/** Reads the manifest once more, or joins the read in flight; undefined inside the window after one. */
function refresh(deps: ContentRepoDeps): typeof refreshing | undefined {
  if (refreshing) return refreshing;
  if (Date.now() - lastRefresh < MIN_REFRESH_MS) return undefined;
  lastRefresh = Date.now();
  expireContentManifest();
  refreshing = loadStoreSiteChecked(deps).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

const BEHIND_HEADERS = { "Cache-Control": "no-store", "Retry-After": "5" } as const;

export const GET: APIRoute = async ({ params, url }) => {
  // The function sees the address the reader asked for (Astro matches routes on it, not on a rewrite's
  // destination), so the version is read from the query here.
  const version = versionOf(url.searchParams.get("v"));
  const request = parseCoverPath(params.path ?? "");
  if (!request) {
    return new Response("Not found", { status: 404, headers: NOT_FOUND_HEADERS });
  }
  const deps: ContentRepoDeps = {
    env: process.env,
    fetch,
    now: Date.now,
    log: (message) => console.error(`[covers] ${message}`),
  };
  try {
    const held = await loadStoreSite(deps);
    let resolution: CoverResolution = held
      ? resolveCover(held, request.id, version)
      : { kind: "missing" };
    // Whether the store's newest manifest, not a held one, backs a non-draw answer.
    let confirmed = false;
    if (resolution.kind !== "draw") {
      // A page is drawn from the store's newest manifest, and this instance may hold an older one
      // for up to its window. The CDN keeps whatever is answered here, so read the manifest once
      // more before saying a cover is missing or behind. The held site reloads only if it changed.
      const refreshed = await refresh(deps);
      if (refreshed !== undefined) {
        resolution = refreshed
          ? resolveCover(refreshed.site, request.id, version)
          : { kind: "missing" };
        // A failed read keeps the held manifest, which proves nothing.
        confirmed = refreshed !== null && !refreshed.saved;
      }
    }
    if (resolution.kind === "missing") {
      // A 404 is kept for an hour, or a year with a `?v=`: only the store's word can earn one.
      if (!confirmed) {
        return new Response("This cover is not ready yet.", {
          status: 503,
          headers: BEHIND_HEADERS,
        });
      }
      return new Response("Not found", { status: 404, headers: NOT_FOUND_HEADERS });
    }
    if (resolution.kind === "behind") {
      return new Response("This cover is not ready yet.", { status: 503, headers: BEHIND_HEADERS });
    }
    const { record } = resolution;
    loadShippedFonts();
    const source = request.mode
      ? { ...record.source, mode: request.mode, ...(request.style ? { style: request.style } : {}) }
      : record.source;
    const draw = request.format === "png" ? coverPng : coverWebp;
    const body = await draw(source, request.size, CACHE);
    return new Response(body, {
      headers: {
        "Content-Type": request.format === "png" ? "image/png" : "image/webp",
        ...coverCacheHeaders(version, record),
      },
    });
  } catch (error) {
    console.error(`[covers] ${request.id}: ${error instanceof Error ? error.message : "unknown"}`);
    return new Response("This cover could not be drawn right now.", {
      status: 503,
      headers: { ...NOT_FOUND_HEADERS, "Retry-After": "60" },
    });
  }
};
