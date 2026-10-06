import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  allowedScriptHashes,
  entryScripts,
  findRenderBlockingScripts,
  firstLoadReport,
  gzipBytes,
  inlineScriptHashes,
  parseScripts,
  staticImports,
  unallowedInlineScripts,
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
    const withLazy = { ...files, "/_astro/entry.js": 'import("./lazy.js");export default 1;' };
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
