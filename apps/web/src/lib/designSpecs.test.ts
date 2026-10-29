/**
 * The style guide's specs (D220) against the stylesheets they describe. A shared class with no
 * spec is a part the guide cannot show, so it fails here; a spec that claims a class it never
 * draws, or one no stylesheet defines, is wrong the other way.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type DesignSpec, defaultState, demoStates } from "./designSpec";
import { designSpecs } from "./designSpecs";

const stylesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "styles");
const stylesheet = (name: string): string =>
  readFileSync(join(stylesDir, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every class a stylesheet's selectors name. */
function classesIn(name: string): Set<string> {
  const found = new Set<string>();
  for (const rule of stylesheet(name).matchAll(/([^{}]+)\{/g)) {
    const prelude = (rule[1] ?? "").trim();
    if (prelude.startsWith("@")) continue;
    for (const match of prelude.matchAll(/\.([a-zA-Z][\w-]*)/g)) found.add(match[1] ?? "");
  }
  return found;
}

/** The sheets whose classes are the design system's own: a class here must have a spec. */
const SHARED_SHEETS = ["buttons.css", "primitives.css", "banner.css"];

/** Shared classes that live in a feature's sheet but are drawn on more than one page. */
const ALSO_SHARED = [
  "settings-row",
  "settings-label",
  "settings-text",
  "settings-hint",
  "settings-switch",
  "settings-range",
  "settings-head",
  "settings-note",
  "settings-crumb",
  "manage-field",
  "manage-form",
  "field-label",
  "search-field",
  "menu-sheet",
  "hero-menu-item",
  "app-nav",
  "app-bar",
  "wordmark",
];

/** Classes in a shared sheet that are not parts: each says why. */
const NOT_A_PART: Record<string, string> = {};

const allStyles = readdirSync(stylesDir).filter((name) => name.endsWith(".css"));
const defined = new Set(allStyles.flatMap((name) => [...classesIn(name)]));

/** Every state a spec can be in with one control moved off its default. */
function statesOf(spec: DesignSpec) {
  const base = defaultState(spec.controls);
  const states = [base, ...demoStates(spec)];
  for (const control of spec.controls) {
    if (control.kind === "choice")
      for (const option of control.options) states.push({ ...base, [control.id]: option.value });
    if (control.kind === "toggle") states.push({ ...base, [control.id]: !control.value });
  }
  return states;
}

describe("design specs", () => {
  it("have unique kebab-case ids, so every spec has its own page", () => {
    const ids = designSpecs.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
  });

  it("draw every class they claim, and only classes a stylesheet defines", () => {
    for (const spec of designSpecs) {
      const markup = statesOf(spec)
        .map((state) => spec.render(state))
        .join("\n");
      expect(markup.length, `${spec.id} draws nothing`).toBeGreaterThan(0);
      for (const name of spec.classes) {
        expect(defined.has(name), `${spec.id}: .${name} is in no stylesheet`).toBe(true);
        expect(
          new RegExp(`class="[^"]*\\b${name}\\b[^"]*"`).test(markup),
          `${spec.id} claims .${name} but never draws it`,
        ).toBe(true);
      }
    }
  });

  it("cover every shared class, so no part of the system is missing from the guide", () => {
    const covered = new Set(designSpecs.flatMap((spec) => spec.classes));
    const shared = [
      ...new Set([...SHARED_SHEETS.flatMap((name) => [...classesIn(name)]), ...ALSO_SHARED]),
    ];
    const missing = shared.filter((name) => !covered.has(name) && !(name in NOT_A_PART));
    expect(
      missing,
      "add a *.design.ts beside the component, or list the class in NOT_A_PART with a reason",
    ).toEqual([]);
  });

  it("name only classes that are still shared, so the list does not rot", () => {
    for (const name of Object.keys(NOT_A_PART))
      expect(defined.has(name), `.${name} is gone`).toBe(true);
  });
});
