import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FONT_FILE_BASENAMES, setFontDirectory } from "@singularity/cover";
import type { APIRoute, GetStaticPaths } from "astro";
import { coverPng, coverWebp } from "../../../lib/covers";
import { findRepoRoot } from "../../../lib/repoRoot";
import { loadStoreSite, resetContentRepo } from "../../../server/contentRepo";
import {
  type CoverResolution,
  coverCacheHeaders,
  NOT_FOUND_HEADERS,
  parseCoverPath,
  resolveCover,
  splitVersion,
} from "../../../server/coverRoute";

/**
 * A cover the build did not draw, drawn when it is asked for (D256). vercel.json sends `/covers/*`
 * here when no built file answers: a briefing or episode newer than the last deploy (D173). The
 * build's own routes draw the rest. The path is `<version>/<cover path>`: vercel.json moves the
 * address's `?v=` there, because the CDN keys a cover by its path alone.
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

const BEHIND_HEADERS = { "Cache-Control": "no-store", "Retry-After": "5" } as const;

export const GET: APIRoute = async ({ params }) => {
  const split = splitVersion(params.path ?? "");
  const request = split && parseCoverPath(split.rest);
  if (!split || !request) {
    return new Response("Not found", { status: 404, headers: NOT_FOUND_HEADERS });
  }
  const load = () =>
    loadStoreSite({
      env: process.env,
      fetch,
      now: Date.now,
      log: (message) => console.error(`[api/cover] ${message}`),
    });
  try {
    let site = await load();
    let resolution: CoverResolution = site
      ? resolveCover(site, request.id, split.version)
      : { kind: "missing" };
    if (resolution.kind !== "draw") {
      // A page is drawn from the store's newest manifest, and this instance may hold an older one
      // for up to its window. The CDN keeps whatever is answered here, so read the store once more
      // before saying a cover is missing or behind.
      resetContentRepo();
      site = await load();
      resolution = site ? resolveCover(site, request.id, split.version) : { kind: "missing" };
    }
    if (resolution.kind === "missing") {
      return new Response("Not found", { status: 404, headers: NOT_FOUND_HEADERS });
    }
    if (resolution.kind === "behind") {
      return new Response("This cover is not ready yet.", { status: 503, headers: BEHIND_HEADERS });
    }
    const { record } = resolution;
    loadShippedFonts();
    const source = request.mode ? { ...record.source, mode: request.mode } : record.source;
    const draw = request.format === "png" ? coverPng : coverWebp;
    const body = await draw(source, request.size, CACHE);
    return new Response(body, {
      headers: {
        "Content-Type": request.format === "png" ? "image/png" : "image/webp",
        ...coverCacheHeaders(split.version, record),
      },
    });
  } catch (error) {
    console.error(
      `[api/cover] ${request.id}: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return new Response("This cover could not be drawn right now.", {
      status: 503,
      headers: { ...NOT_FOUND_HEADERS, "Retry-After": "60" },
    });
  }
};
