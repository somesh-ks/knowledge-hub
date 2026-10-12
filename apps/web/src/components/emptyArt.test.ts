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

describe("the empty-state art", () => {
  it("holds no raw colour: every fill and stroke comes from a class", () => {
    expect(art).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|style=|\bfill="|\bstroke="/);
  });

  it("is one decorative svg, hidden from assistive technology, on the kit's scale", () => {
    const svg = art.slice(art.indexOf("<svg"), art.indexOf(">", art.indexOf("<svg")));
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('focusable="false"');
    // One scale (240 units across), each scene's box cropped to its drawing.
    expect(svg).toContain("viewBox={VIEW[art]}");
    expect(art).toMatch(/const VIEW: Record<ArtName, string> = \{[^}]*"0 \d+ 240 \d+"/);
    expect(art.match(/<svg/g)).toHaveLength(1);
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
