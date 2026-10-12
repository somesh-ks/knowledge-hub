import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The fixture build always has briefings, so Today and the Library with nothing in them never render
 * in the e2e suite (e2e/empty.spec.ts covers the states it can reach). The vitest config has no Astro
 * compiler, so these read the components' source.
 */

const HERE = import.meta.dirname;
const read = (...path: string[]) => readFileSync(join(HERE, ...path), "utf8");
const art = read("EmptyArt.astro");
const SCENES = ["today", "library", "results", "offline", "online", "notfound"];

describe("the empty-state art", () => {
  it("holds no raw colour: every fill and stroke comes from a class", () => {
    expect(art).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|style=|\bfill="|\bstroke="/);
  });

  it("is one decorative svg, hidden from assistive technology, on the kit's canvas", () => {
    const svg = art.slice(art.indexOf("<svg"), art.indexOf(">", art.indexOf("<svg")));
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('focusable="false"');
    expect(svg).toContain('viewBox="0 0 240 180"');
    expect(art.match(/<svg/g)).toHaveLength(1);
  });

  it("draws every scene it names, each in about 1.2 KB or less", () => {
    for (const scene of SCENES) expect(art, scene).toContain(`"${scene}"`);
    const blocks = art.split(/\n {2}\{\n/).slice(1);
    expect(blocks.length).toBeGreaterThanOrEqual(5);
    for (const block of blocks) expect(block.length).toBeLessThanOrEqual(1229);
  });

  it("names only classes that empty.css colours", () => {
    const css = read("..", "styles", "empty.css");
    for (const [, names = ""] of art.matchAll(/class="([^"]+)"/g)) {
      for (const name of names.split(" ")) {
        if (name === "empty-art") continue;
        expect(css, name).toContain(`.${name}`);
      }
    }
  });
});

describe("the empty state", () => {
  const state = read("EmptyState.astro");

  it("with no props is Today with nothing yet: its scene, the page's h1 and two ways on", () => {
    expect(state).toContain('art = "today"');
    expect(state).toContain('title = "No briefings yet"');
    expect(state).toContain('body = "The first one arrives within two days."');
    expect(state).toContain('primary = { label: "Check again", href: "/", reload: true }');
    expect(state).toContain('secondary = { label: "Settings", href: "/settings" }');
    expect(state).toContain('level === 1 ? "h1" : "h2"');
    expect(state).toContain('level === 1 ? "page-title"');
    expect(state).toContain('tabindex={level === 1 ? "-1" : undefined}');
    expect(state).toContain('class="btn-primary"');
  });

  it("Today renders it when there is no briefing", () => {
    const today = read("..", "pages", "index.astro");
    expect(today).toMatch(
      /latest \?[\s\S]*:\s*\(\s*<main id="main" tabindex="-1">\s*<EmptyState \/>/,
    );
  });

  it("the Library with nothing in it keeps its h1 and gives the empty state an h2 and New episode", () => {
    const page = read("..", "pages", "library.astro");
    const none = page.slice(
      page.indexOf('class="library-none"'),
      page.indexOf("<div data-library>"),
    );
    expect(none).toMatch(/<h1 class="page-title library-title" id="page-title"/);
    expect(none).toContain('<EmptyArt art="library" />');
    expect(none).toMatch(/<h2 class="empty-title">/);
    expect(none).toMatch(/class="btn-primary"[^>]*data-create-open/);
  });
});
