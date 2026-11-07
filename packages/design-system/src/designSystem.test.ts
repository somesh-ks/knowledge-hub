import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { flagParts } from "./flag";
import { COMPONENTS } from "./registry";

/**
 * Each component's own stylesheet and guidance. That no app writes its classes by hand, and the
 * other checks of how the apps draw the system, are in scripts/systemUse.test.ts at the repository
 * root, where the apps are visible (D382 step 4c).
 */
const STYLES = join(import.meta.dirname, "..", "styles");
const sheet = (name: string) => readFileSync(join(STYLES, name), "utf8");

describe("design-system components", () => {
  it.each(COMPONENTS)(
    "$name: every class it draws has rules, and every rule belongs to it",
    (c) => {
      const css = sheet(c.sheet);
      const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
      const defined = [...rules.matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1] ?? "");
      for (const name of c.classes) expect(defined, `${name} has no rule`).toContain(name);
      const orphans = [...new Set(defined.filter((n) => n.startsWith(c.prefix)))].filter(
        (n) => !c.classes.includes(n),
      );
      expect(orphans, `${c.sheet} styles a class no ${c.name} draws`).toEqual([]);
    },
  );

  it.each(COMPONENTS)(
    "$name: it and each of its parts say when to use them and when not to",
    (c) => {
      const parts = [["", c] as const, ...Object.entries(c.parts)];
      for (const [name, part] of parts) {
        const label = `${c.name} ${name}`.trim();
        expect(part.summary, `${label}: summary`).not.toBe("");
        expect(part.useWhen.length, `${label}: useWhen`).toBeGreaterThan(0);
        expect(part.dontUseWhen.length, `${label}: dontUseWhen`).toBeGreaterThan(0);
        for (const { when, instead } of part.dontUseWhen) {
          expect(when, `${label}: a dontUseWhen with no situation`).not.toBe("");
          // A pointer into a component the system already has must name a variant or tone it has.
          const [target, partName] = (instead ?? "").split(".");
          const known = COMPONENTS.find((k) => k.name === target);
          if (known && partName) {
            expect(Object.keys(known.parts), `${label}: "${when}" points at ${instead}`).toContain(
              partName,
            );
          }
        }
      }
    },
  );
});

// Windows draws no flag emoji, only two letters (owner, 2026-10-25 and 2026-11-04: "the emoji doesn't
// get read in all platforms"): every flag the app draws is the Flag's art (D367).
describe("the Flag", () => {
  it("draws a flag emoji in text as the Flag, and leaves other text as it is", () => {
    expect(flagParts("You're in India 🇮🇳")).toEqual(["You're in India", { region: "IN" }]);
    expect(flagParts("🇸🇪")).toEqual([{ region: "SE" }]);
    expect(flagParts("🎨 Design")).toEqual(["🎨 Design"]);
  });
});
