import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

/**
 * Checks on the built HTML: how much JavaScript a first visit loads, whether any of it blocks
 * rendering, and whether every inline script is allowed by the page's Content-Security-Policy. The
 * functions are pure (the file reads are passed in) so the rules are tested without a build.
 */

/**
 * First-load JavaScript, gzipped. It was 100 KB until the bottom bar became a full transport (seek,
 * clock, volume) and the Topics and Sources pages arrived; 63 KB of it is React itself. It went
 * from 102 to 103 KB on 2026-10-08 for the Space key, instant deletion and the Back key closing the
 * Create panel, which must be on every page: the reading pages sit at 100 to 101 KB, and only the
 * management pages under Settings, which carry their editor, reach 102.5. To 104 KB the same day
 * for interface sounds on every control, live run stages and the cover play button: reading pages
 * are at 101.5 to 102.4, and Topics and Sources at 103.5. The way back down is to load those two
 * pages' editor on first use; do that before raising this again.
 */
export const FIRST_LOAD_BUDGET_BYTES = 104 * 1024;
/** Self-hosted fonts, build plan 8.8: subset, one preloaded, 80 KB or less in total. */
export const FONT_BUDGET_BYTES = 80 * 1024;
/** The inline theme script runs before first paint, so it must stay tiny. */
export const MAX_BLOCKING_INLINE_BYTES = 512;

export function gzipBytes(content: string | Uint8Array): number {
  return gzipSync(content).length;
}

interface ScriptTag {
  attributes: string;
  src: string | null;
  body: string;
  isModule: boolean;
  isDeferred: boolean;
  isJson: boolean;
  inHead: boolean;
}

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(
    `(?:^|\\s)${name}(?:=(?:"([^"]*)"|'([^']*)'|([^\\s>]+)))?(?=\\s|$)`,
  ).exec(attributes);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? "";
}

export function parseScripts(html: string): ScriptTag[] {
  const headEnd = html.indexOf("</head>");
  const tags: ScriptTag[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const attributes = match[1] ?? "";
    const type = attribute(attributes, "type");
    tags.push({
      attributes,
      src: attribute(attributes, "src"),
      body: match[2] ?? "",
      isModule: type === "module",
      isDeferred:
        attribute(attributes, "defer") !== null || attribute(attributes, "async") !== null,
      isJson: type === "application/json" || type === "application/ld+json",
      inHead: headEnd === -1 || (match.index ?? 0) < headEnd,
    });
  }
  return tags;
}

/** Scripts that hold up first paint: an external classic script, or a large inline one, in the head. */
export function findRenderBlockingScripts(html: string): string[] {
  const problems: string[] = [];
  for (const tag of parseScripts(html)) {
    if (!tag.inHead || tag.isJson || tag.isModule || tag.isDeferred) continue;
    if (tag.src) problems.push(`External script blocks rendering: ${tag.src}`);
    else if (Buffer.byteLength(tag.body) > MAX_BLOCKING_INLINE_BYTES) {
      problems.push(
        `Inline head script is ${Buffer.byteLength(tag.body)} bytes, over ${MAX_BLOCKING_INLINE_BYTES}`,
      );
    }
  }
  return problems;
}

/** Every JavaScript file a page asks for at load: script tags, preloads, and the islands' modules. */
export function entryScripts(html: string): string[] {
  const urls = new Set<string>();
  for (const tag of parseScripts(html)) if (tag.src) urls.add(tag.src);
  for (const match of html.matchAll(
    /<link\b[^>]*rel=["']modulepreload["'][^>]*href=["']([^"']+)["']/g,
  )) {
    if (match[1]) urls.add(match[1]);
  }
  for (const match of html.matchAll(
    /\b(?:component-url|renderer-url|before-hydration-url)=["']([^"']+)["']/g,
  )) {
    if (match[1]) urls.add(match[1]);
  }
  return [...urls].filter((url) => url.startsWith("/") && !url.startsWith("//"));
}

/** The modules a file imports statically. Dynamic import() is lazy and not part of first load. */
export function staticImports(source: string): string[] {
  const specifiers = new Set<string>();
  for (const match of source.matchAll(
    /(?:\bimport|\bexport)\s*(?:[^"'`;()]*?\bfrom\s*)?["']([^"']+\.js)["']/g,
  )) {
    if (match[1]) specifiers.add(match[1]);
  }
  return [...specifiers];
}

function resolveUrl(from: string, specifier: string): string {
  return new URL(specifier, `https://site${from}`).pathname;
}

export interface FirstLoadReport {
  files: Array<{ url: string; gzip: number }>;
  totalGzip: number;
}

/** Follows static imports from the entry scripts and sums their gzipped sizes. */
export function firstLoadReport(
  entries: readonly string[],
  read: (url: string) => string | null,
): FirstLoadReport {
  const seen = new Set<string>();
  const queue = [...entries];
  const files: FirstLoadReport["files"] = [];
  while (queue.length > 0) {
    const url = queue.shift();
    if (url === undefined || seen.has(url)) continue;
    seen.add(url);
    const source = read(url);
    if (source === null) throw new Error(`Page asks for ${url}, which is not in the build output`);
    files.push({ url, gzip: gzipBytes(source) });
    for (const specifier of staticImports(source)) queue.push(resolveUrl(url, specifier));
  }
  return { files, totalGzip: files.reduce((sum, file) => sum + file.gzip, 0) };
}

/** `sha256-...` source expressions of the page's inline scripts that run (not JSON data blocks). */
export function inlineScriptHashes(html: string): string[] {
  return parseScripts(html)
    .filter((tag) => !tag.src && !tag.isJson && tag.body.trim() !== "")
    .map((tag) => `sha256-${createHash("sha256").update(tag.body).digest("base64")}`);
}

/** The script-src hashes the page's CSP meta element allows. */
export function allowedScriptHashes(html: string): string[] {
  const meta =
    /<meta\b[^>]*http-equiv=["']content-security-policy["'][^>]*>/i.exec(html)?.[0] ?? "";
  // The policy holds single quotes ("'self'"), so the attribute is read by its own quote character.
  const policy = /\bcontent="([^"]*)"|\bcontent='([^']*)'/.exec(meta);
  const text = policy?.[1] ?? policy?.[2] ?? "";
  const scriptSrc =
    text.split(";").find((directive) => directive.trim().startsWith("script-src")) ?? "";
  return [...scriptSrc.matchAll(/'(sha256-[^']+)'/g)].map((match) => match[1] ?? "");
}

/** Inline scripts the Content-Security-Policy would block. Empty means every one is allowed. */
export function unallowedInlineScripts(html: string): string[] {
  const allowed = new Set(allowedScriptHashes(html));
  return inlineScriptHashes(html).filter((hash) => !allowed.has(hash));
}
