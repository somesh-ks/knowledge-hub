import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FONT_FILE_BASENAMES, setFontDirectory } from "@singularity/cover";
import type { APIRoute, GetStaticPaths } from "astro";
import { coverPng, coverWebp } from "../../../lib/covers";
import { findRepoRoot } from "../../../lib/repoRoot";
import { loadStoreSite } from "../../../server/contentRepo";
import {
  coverCacheHeaders,
  findCoverRecord,
  NOT_FOUND_HEADERS,
  parseCoverPath,
} from "../../../server/coverRoute";

/**
 * A cover the build did not draw, drawn when it is asked for (D256). vercel.json sends `/covers/*`
 * here when no built file answers: a briefing or episode newer than the last deploy (D173). The
 * build's own routes draw the rest.
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

export const GET: APIRoute = async ({ params, url }) => {
  const request = parseCoverPath(params.path ?? "");
  if (!request) return new Response("Not found", { status: 404, headers: NOT_FOUND_HEADERS });
  try {
    const site = await loadStoreSite({
      env: process.env,
      fetch,
      now: Date.now,
      log: (message) => console.error(`[api/cover] ${message}`),
    });
    const record = site ? findCoverRecord(site, request.id) : null;
    if (!record) return new Response("Not found", { status: 404, headers: NOT_FOUND_HEADERS });
    loadShippedFonts();
    const source = request.mode ? { ...record.source, mode: request.mode } : record.source;
    const draw = request.format === "png" ? coverPng : coverWebp;
    const body = await draw(source, request.size, CACHE);
    return new Response(body, {
      headers: {
        "Content-Type": request.format === "png" ? "image/png" : "image/webp",
        ...coverCacheHeaders(url.searchParams.get("v") ?? "", record),
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
