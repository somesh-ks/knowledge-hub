import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  allowedScriptHashes,
  entryScripts,
  FIRST_LOAD_BUDGET_BYTES,
  findRenderBlockingScripts,
  firstLoadReport,
  gzipBytes,
  importGraph,
  inlineScriptHashes,
  overBudget,
  parseScripts,
  readFromGraph,
  staticImports,
  unallowedInlineScripts,
  unhintedModules,
  withModulePreloads,
} from "./bundleBudget";

const hashOf = (text: string) => `sha256-${createHash("sha256").update(text).digest("base64")}`;

function page(options: { head?: string; body?: string; policy?: string } = {}): string {
  const policy = options.policy ?? "script-src 'self'";
  return `<!DOCTYPE html><html><head><meta http-equiv="content-security-policy" content="default-src 'self';img-src 'self' data:; ${policy}">${options.head ?? ""}</head><body>${options.body ?? ""}</body></html>`;
}

describe("parseScripts", () => {
  it("tells apart module, deferred, JSON and inline scripts", () => {
    const html = page({
      head: '<script type="module" src="/_astro/a.js"></script><script defer src="/b.js"></script><script>var x=1</script>',
      body: '<script type="application/json" id="d">{}</script>',
    });
    const tags = parseScripts(html);
    expect(
      tags.map((tag) => [tag.src, tag.isModule, tag.isDeferred, tag.isJson, tag.inHead]),
    ).toEqual([
      ["/_astro/a.js", true, false, false, true],
      ["/b.js", false, true, false, true],
      [null, false, false, false, true],
      [null, false, false, true, false],
    ]);
  });
});

describe("findRenderBlockingScripts", () => {
  it("accepts module and deferred scripts and a tiny inline script", () => {
    const html = page({
      head: '<script>(()=>{})()</script><script type="module" src="/a.js"></script><script async src="/b.js"></script>',
    });
    expect(findRenderBlockingScripts(html)).toEqual([]);
  });

  it("flags an external classic script in the head", () => {
    const html = page({ head: '<script src="/blocking.js"></script>' });
    expect(findRenderBlockingScripts(html)[0]).toContain("/blocking.js");
  });

  it("flags a large inline script in the head but not in the body", () => {
    const big = `<script>${"x".repeat(600)}</script>`;
    expect(findRenderBlockingScripts(page({ head: big })).length).toBe(1);
    expect(findRenderBlockingScripts(page({ body: big }))).toEqual([]);
  });

  it("ignores JSON data blocks", () => {
    const html = page({ head: `<script type="application/json">${"x".repeat(900)}</script>` });
    expect(findRenderBlockingScripts(html)).toEqual([]);
  });
});

describe("entryScripts", () => {
  it("collects script tags, preloads and the islands' modules", () => {
    const html = page({
      head: '<script type="module" src="/_astro/page.js"></script><link rel="modulepreload" href="/_astro/chunk.js">',
      body: '<astro-island component-url="/_astro/Player.js" renderer-url="/_astro/client.js" before-hydration-url=""></astro-island>',
    });
    expect(entryScripts(html).sort()).toEqual([
      "/_astro/Player.js",
      "/_astro/chunk.js",
      "/_astro/client.js",
      "/_astro/page.js",
    ]);
  });

  it("leaves out other origins", () => {
    expect(
      entryScripts(page({ head: '<script src="https://cdn.example/x.js"></script>' })),
    ).toEqual([]);
  });
});

describe("staticImports", () => {
  it("finds static imports and re-exports, not dynamic ones", () => {
    const source =
      'import{a}from"./one.js";import"./two.js";export{b}from"./three.js";const lazy=()=>import("./lazy.js");';
    expect(staticImports(source).sort()).toEqual(["./one.js", "./three.js", "./two.js"]);
  });
});

describe("firstLoadReport", () => {
  const files: Record<string, string> = {
    "/_astro/entry.js": 'import{x}from"./shared.js";export default x;',
    "/_astro/shared.js": 'import"./leaf.js";export const x=1;',
    "/_astro/leaf.js": "export const y=2;",
    "/_astro/lazy.js": "export const z=3;",
  };
  const read = (url: string) => files[url] ?? null;

  it("follows static imports and counts each file once", () => {
    const report = firstLoadReport(["/_astro/entry.js", "/_astro/shared.js"], read);
    expect(report.files.map((file) => file.url).sort()).toEqual([
      "/_astro/entry.js",
      "/_astro/leaf.js",
      "/_astro/shared.js",
    ]);
    expect(report.totalGzip).toBe(report.files.reduce((sum, file) => sum + file.gzip, 0));
  });

  it("does not count a lazily imported file", () => {
    const withLazy: Record<string, string> = {
      ...files,
      "/_astro/entry.js": 'import("./lazy.js");export default 1;',
    };
    const report = firstLoadReport(["/_astro/entry.js"], (url) => withLazy[url] ?? null);
    expect(report.files.map((file) => file.url)).toEqual(["/_astro/entry.js"]);
  });

  it("fails when a page asks for a file that was not built", () => {
    expect(() => firstLoadReport(["/_astro/missing.js"], read)).toThrow(/missing\.js/);
  });

  it("measures gzip, not raw size", () => {
    const repetitive = "a".repeat(10_000);
    expect(gzipBytes(repetitive)).toBeLessThan(200);
  });
});

describe("Content-Security-Policy hashes", () => {
  const theme = "(()=>{document.documentElement.dataset.theme='dark'})();";

  it("reads the script-src hashes from the meta element", () => {
    const html = page({ policy: `script-src 'self' '${hashOf(theme)}' 'sha256-other='` });
    expect(allowedScriptHashes(html)).toEqual([hashOf(theme), "sha256-other="]);
  });

  it("hashes inline scripts and skips external and JSON ones", () => {
    const html = page({
      head: `<script>${theme}</script><script src="/a.js"></script>`,
      body: '<script type="application/json">{"a":1}</script>',
    });
    expect(inlineScriptHashes(html)).toEqual([hashOf(theme)]);
  });

  it("passes when every inline script is listed", () => {
    const html = page({
      head: `<script>${theme}</script>`,
      policy: `script-src 'self' '${hashOf(theme)}'`,
    });
    expect(unallowedInlineScripts(html)).toEqual([]);
  });

  it("reports an inline script the policy would block", () => {
    const html = page({ head: `<script>${theme}</script>`, policy: "script-src 'self'" });
    expect(unallowedInlineScripts(html)).toEqual([hashOf(theme)]);
  });

  it("reports every inline script when there is no policy at all", () => {
    expect(
      unallowedInlineScripts(`<html><head><script>${theme}</script></head></html>`),
    ).toHaveLength(1);
  });
});

describe("module preload hints", () => {
  // Without hints the bar's island and its imports load one round trip at a time after idle, which
  // left it unpressable for 2.5 to 3 s after the largest paint on a slow phone, and nothing failed.
  const files: Record<string, string> = {
    "/_astro/page.js": 'import"./shared.js";',
    "/_astro/Player.js": 'import{x}from"./shared.js";import"./react.js";import("./lazy.js");',
    "/_astro/client.js": 'import"./react.js";',
    "/_astro/shared.js": "export const x=1;",
    "/_astro/react.js": "export default 1;",
    "/_astro/lazy.js": "export const z=3;",
  };
  const read = (url: string) => files[url] ?? null;
  const html = page({
    head: '<script type="module" src="/_astro/page.js"></script>',
    body: '<astro-island component-url="/_astro/Player.js" renderer-url="/_astro/client.js"></astro-island>',
  });

  it("names every eager module the HTML does not, and nothing lazy", () => {
    expect(unhintedModules(html, read).sort()).toEqual([
      "/_astro/Player.js",
      "/_astro/client.js",
      "/_astro/react.js",
      "/_astro/shared.js",
    ]);
  });

  it("leaves a hinted page with nothing unhinted, its scripts unchanged and its policy intact", () => {
    const hinted = withModulePreloads(html, read);
    expect(unhintedModules(hinted, read)).toEqual([]);
    expect(parseScripts(hinted)).toEqual(parseScripts(html));
    expect(unallowedInlineScripts(hinted)).toEqual([]);
  });

  // A page rendered on request is not in the build's HTML, so it lost every hint on production
  // (2026-10-24) and nothing failed; its server adds them from the graph the build recorded.
  it("gives a page from the recorded graph the same hints the build gives it from the files", () => {
    const graph = importGraph(Object.keys(files), read);
    expect(withModulePreloads(html, readFromGraph(graph))).toBe(withModulePreloads(html, read));
  });

  // A hint for an island that waits to be woken fetches React at load and silently undoes the wait
  // (cut 1 in docs/engineering/first-load-js.md, D178).
  it("hints nothing a wake island loads", () => {
    const waking = page({
      head: '<script type="module" src="/_astro/page.js"></script>',
      body: '<astro-island component-url="/_astro/Player.js" renderer-url="/_astro/client.js" client="wake"></astro-island>',
    });
    const built = withModulePreloads(waking, read);
    expect(entryScripts(built).sort()).toEqual(["/_astro/page.js", "/_astro/shared.js"]);
    expect(built).not.toContain('href="/_astro/react.js"');
  });
});

describe("the first-load budget", () => {
  // The line sits a few KB over the heaviest page (D112), so a page that grows past it must fail
  // the build, here and on Vercel, rather than pass with a ceiling nobody reads.
  it("fails a page one byte past the line and passes one on it", () => {
    const pages = [
      { name: "/on/index.html", totalGzip: FIRST_LOAD_BUDGET_BYTES },
      { name: "/past/index.html", totalGzip: FIRST_LOAD_BUDGET_BYTES + 1 },
    ];
    const problems = overBudget(pages);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^\/past\/index\.html: /);
  });
});
