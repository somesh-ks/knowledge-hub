import { defineMiddleware } from "astro:middleware";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  copiesOfShared,
  readFromGraph,
  SHARED_STYLES_KEY,
  WAKE_STYLES_KEY,
  withModulePreloads,
  withoutStylesheets,
} from "./lib/bundleBudget";
import { findRepoRoot } from "./lib/repoRoot";

/**
 * A page rendered on request (D173) gets the modulepreload links the build gives every built page
 * (astro.config.mjs, preloadPageModules): without them its scripts' imports arrive one round trip at
 * a time. The links come from the scripts' import graph the build wrote, read once per instance.
 */
let graph: Record<string, string[]> | null | undefined;

function moduleGraph(): Record<string, string[]> | null {
  if (graph !== undefined) return graph;
  try {
    const file = join(findRepoRoot(), "apps", "web", ".cache", "module-graph.json");
    graph = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, string[]>)
      : null;
  } catch {
    graph = null;
  }
  return graph;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  // Built pages have their links already; in development the graph is an older build's.
  if (context.isPrerendered || !import.meta.env.PROD) return response;
  if (!response.headers.get("content-type")?.startsWith("text/html")) return response;
  const known = moduleGraph();
  if (!known) return response;
  const html = await response.text();
  let hinted = html;
  try {
    // The graph is recorded before the build writes player.*.css, so its copy is found by name.
    const copies = [
      ...(known[WAKE_STYLES_KEY] ?? []),
      ...copiesOfShared(html, known[SHARED_STYLES_KEY] ?? []),
    ];
    hinted = withoutStylesheets(withModulePreloads(html, readFromGraph(known)), copies);
  } catch {
    // A script the graph does not know (a newer deploy's page, a public file): the page goes as built.
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(hinted, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
