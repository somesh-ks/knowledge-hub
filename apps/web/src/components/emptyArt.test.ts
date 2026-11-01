import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cobweb } from "./cobweb";
import { batOffline, batOnline, cauldron, ghost, pumpkin, tombstone } from "./halloweenArt";

/**
 * The fixture build always has briefings, so Today and the Library with nothing in them never render
 * in the e2e suite (e2e/empty.spec.ts covers the states it can reach). The vitest config has no Astro
 * compiler, so these read the components' source.
 */

const HERE = import.meta.dirname;
const read = (...path: string[]) => readFileSync(join(HERE, ...path), "utf8");
const art = read("EmptyArt.astro");

describe("the empty-state art", () => {
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

  // The Halloween scenes are drawn by functions, so the classes they name are read from what they draw
  // (D306): a class empty.css does not define paints nothing, and the scene loses a part without a sound.
  it("draws the style's scenes with classes empty.css colours", () => {
    const css = read("..", "styles", "empty.css");
    const drawn = [pumpkin, ghost, cauldron, batOffline, batOnline, tombstone, cobweb].map((draw) =>
      draw(),
    );
    for (const svg of drawn) {
      for (const [, names = ""] of svg.matchAll(/class="([^"]+)"/g)) {
        for (const name of names.split(" ")) expect(css, name).toContain(`.${name}`);
      }
    }
  });

  it("gives every scene of the Default art a Halloween one", () => {
    const halloween = read("EmptyArtHalloween.astro");
    for (const name of ["today", "library", "results", "offline", "online", "notfound"]) {
      expect(halloween, name).toContain(`${name}:`);
    }
  });
});
