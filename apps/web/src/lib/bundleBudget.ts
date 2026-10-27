import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

/**
 * Checks on the built HTML: how much JavaScript a first visit loads, whether any of it blocks
 * rendering, and whether every inline script is allowed by the page's Content-Security-Policy. The
 * functions are pure (the file reads are passed in) so the rules are tested without a build.
 */

/**
 * First-load JavaScript, gzipped. It was 100 KB until the bottom bar became a full transport (seek,
 * clock, volume) and the Categories and Sources pages arrived; 68 KB of it is React itself. Raised to
 * 104 KB on 2026-10-08 for interface sounds, live run stages and the cover play button. On
 * 2026-10-10 the Podcast page's editor moved after first paint (the Topics editor already was), so
 * the heaviest page was /library at 102.7 KB. The owner declined preact/compat (about 57 KB off every
 * page), so React stays. Raised to 110 KB on 2026-10-10 (D53) with the ask to keep it low: the
 * budget is a ceiling, not a target, and docs/engineering/first-load-js.md lists what could still come off.
 * Raised to 150 KB on 2026-10-13 at the owner's request (D103): room for features, still a ceiling.
 * Lowered to 109 KB on 2026-10-14 (D112), about 3 KB over the heaviest page, once three cuts had
 * come off: the Blocked outlets editor at idle (111.0 to 106.3 KB on that page), the player's eager
 * glyphs and scrubber math (0.4 KB on every page) and the player surface's motion after first paint
 * (3.5 KB on every page). The heaviest page was then Topics at 105.7 KB. A ceiling 40 KB above the
 * code let a page grow by a third before anything failed; at 3 KB a feature that adds first-load
 * code has to take it off somewhere or load it lazily.
 * Raised to 130 KB on 2026-10-21 at the owner's request (D141): the heaviest page sat at 109.0 KB
 * after the hardening's fault reporter, so every further feature needed a cut first. Still a
 * ceiling, not a target.
 */
export const FIRST_LOAD_BUDGET_BYTES = 130 * 1024;
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
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\b[^>]*>/gi)) {
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

/** The opening tag of an island that hydrates only when the page wakes it (lib/wakeDirective.ts). */
const WAKE_ISLAND = /<astro-island\b[^>]*\bclient="wake"[^>]*>/g;

function islandModules(tag: string): string[] {
  const urls: string[] = [];
  for (const match of tag.matchAll(/\b(?:component-url|renderer-url)=["']([^"']+)["']/g)) {
    if (match[1]) urls.push(match[1]);
  }
  return urls;
}

/**
 * Every JavaScript file a page asks for at load: script tags, preloads, and the islands' modules.
 * A `client:wake` island's modules are not among them: nothing fetches them until the page wakes it.
 */
export function entryScripts(page: string): string[] {
  const html = page.replace(WAKE_ISLAND, "");
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

/** Every module the entries load at start, in the order they are reached: the entries, then their static imports. */
export function moduleGraph(
  entries: readonly string[],
  read: (url: string) => string | null,
): string[] {
  const seen = new Set<string>();
  const queue = [...entries];
  const order: string[] = [];
  while (queue.length > 0) {
    const url = queue.shift();
    if (url === undefined || seen.has(url)) continue;
    seen.add(url);
    const source = read(url);
    if (source === null) throw new Error(`Page asks for ${url}, which is not in the build output`);
    order.push(url);
    for (const specifier of staticImports(source)) queue.push(resolveUrl(url, specifier));
  }
  return order;
}

/** Follows static imports from the entry scripts and sums their gzipped sizes. */
export function firstLoadReport(
  entries: readonly string[],
  read: (url: string) => string | null,
): FirstLoadReport {
  // Each file is read once: the graph's walk keeps what it read for the sizes.
  const sources = new Map<string, string | null>();
  const once = (url: string): string | null => {
    if (!sources.has(url)) sources.set(url, read(url));
    return sources.get(url) ?? null;
  };
  const files = moduleGraph(entries, once).map((url) => ({
    url,
    gzip: gzipBytes(once(url) ?? ""),
  }));
  return { files, totalGzip: files.reduce((sum, file) => sum + file.gzip, 0) };
}

/**
 * The modules a page loads at start that nothing names in its HTML: the islands' imports and the page
 * scripts' imports. Without a hint the browser finds them one round trip at a time (the island waits
 * for idle, then its module, then that module's imports), so on a slow phone the bar became pressable
 * 2.5 to 3 s after the largest paint. The islands' graph comes first, so its files are asked for first.
 */
export function unhintedModules(html: string, read: (url: string) => string | null): string[] {
  const named = new Set<string>();
  for (const tag of parseScripts(html)) if (tag.src) named.add(tag.src);
  for (const match of html.matchAll(
    /<link\b[^>]*rel=["']modulepreload["'][^>]*href=["']([^"']+)["']/g,
  )) {
    if (match[1]) named.add(match[1]);
  }
  const entries = entryScripts(html);
  const islands = entries.filter((url) => !named.has(url));
  const graph = moduleGraph([...islands, ...entries], read);
  return graph.filter((url) => !named.has(url));
}

/**
 * Every built script's static imports, by URL. A page rendered on request is not in the build's
 * HTML, so its server adds the hints from this (middleware.ts) instead of reading the scripts.
 */
export function importGraph(urls: readonly string[], read: (url: string) => string | null) {
  const graph: Record<string, string[]> = {};
  for (const url of urls) {
    const source = read(url);
    if (source !== null) graph[url] = staticImports(source).map((spec) => resolveUrl(url, spec));
  }
  return graph;
}

/** A `read` for `withModulePreloads` that knows only the imports `importGraph` recorded. */
export function readFromGraph(graph: Record<string, string[]>): (url: string) => string | null {
  return (url) => graph[url]?.map((dependency) => `import"${dependency}";`).join("") ?? null;
}

/** The page with a modulepreload link for each module `unhintedModules` finds, at the end of its head. */
export function withModulePreloads(html: string, read: (url: string) => string | null): string {
  const urls = unhintedModules(html, read);
  const headEnd = html.indexOf("</head>");
  if (urls.length === 0 || headEnd === -1) return html;
  const links = urls.map((url) => `<link rel="modulepreload" href="${url}">`).join("");
  return `${html.slice(0, headEnd)}${links}${html.slice(headEnd)}`;
}

/** Where `importGraph`'s file also names the duplicate stylesheet links to drop. */
export const WAKE_STYLES_KEY = "stylesheets:wake";

/**
 * The copies of the player and sheets islands' stylesheet that a page links under a second name.
 * Astro links player.css (54 KB) in every head twice (Icon.*.css, the file the islands list in their
 * dependencies, and player.*.css, the same bytes), so a first visit downloads and waits for both.
 * The islands' own link stays: a resumed bar paints at first load and needs it then (a first try
 * that left both out let the bar show unstyled and the pages overflow).
 */
export function wakeStylesheets(
  urls: readonly string[],
  read: (url: string) => string | null,
): string[] {
  const listed = (island: string) => {
    const script = urls.find((url) => url.startsWith(`/_astro/${island}.`) && url.endsWith(".js"));
    const source = script ? read(script) : null;
    return new Set(
      source ? [...source.matchAll(/_astro\/([\w.-]+\.css)/g)].map((m) => `/_astro/${m[1]}`) : [],
    );
  };
  const players = listed("PlayerRoot");
  const sheets = listed("SheetsRoot");
  const shared = [...players].filter((url) => sheets.has(url));
  const bodies = new Set(shared.map(read).filter((body) => body !== null));
  return urls.filter((url) => {
    if (!url.endsWith(".css")) return false;
    const body = read(url);
    return !shared.includes(url) && body !== null && bodies.has(body);
  });
}

/** The page without the render-blocking links to the given stylesheets. */
export function withoutStylesheets(html: string, hrefs: readonly string[]): string {
  if (hrefs.length === 0) return html;
  return html.replace(/<link\b[^>]*>/g, (tag) => {
    if (!/\brel=["']stylesheet["']/.test(tag)) return tag;
    const href = /\bhref=["']([^"']+)["']/.exec(tag)?.[1];
    return href !== undefined && hrefs.includes(href) ? "" : tag;
  });
}

/**
 * The modules each `client:wake` island loads when it wakes, beyond what the page loaded at start,
 * in the order of its tags. They are not first load, so the budget does not count them.
 */
export function wakeModules(html: string, read: (url: string) => string | null): string[][] {
  const eager = new Set(moduleGraph(entryScripts(html), read));
  return [...html.matchAll(WAKE_ISLAND)].map((match) =>
    moduleGraph(islandModules(match[0]), read).filter((url) => !eager.has(url)),
  );
}

/** One line per page whose first load is past the budget; empty when every page is inside it. */
export function overBudget(
  pages: ReadonlyArray<{ name: string; totalGzip: number }>,
  budget: number = FIRST_LOAD_BUDGET_BYTES,
): string[] {
  const kilobytes = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
  return pages
    .filter((page) => page.totalGzip > budget)
    .map(
      (page) =>
        `${page.name}: ${kilobytes(page.totalGzip)} of first-load JavaScript, budget ${kilobytes(budget)}`,
    );
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
