import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildSystem,
  LLMS_PATH,
  renderLlms,
  renderSystemJson,
  SYSTEM_PATH,
  sourceFiles,
} from "@singularity/design-system/scripts/system/build";
import { describe, expect, it } from "vitest";
import { APPS } from "./system.js";

/**
 * The design system file against the apps that draw the system: the package cannot see them
 * (D382 step 4c), so what the file says about their stylesheets and markup is checked here.
 */
const ROOT = APPS.root;
const system = buildSystem(APPS);
const allCss = [join(ROOT, "packages/design-system/styles"), ...APPS.styles]
  .flatMap((dir) =>
    readdirSync(dir)
      .filter((file) => file.endsWith(".css"))
      .map((file) => readFileSync(join(dir, file), "utf8")),
  )
  .join("\n");

describe("the design system file", () => {
  // Prevents an agent trusting a stale file: a token or part changed and tokens/system.json did not.
  it("matches the code it is built from (run npm run system when this fails)", () => {
    expect(readFileSync(SYSTEM_PATH, "utf8")).toBe(renderSystemJson(system));
    expect(readFileSync(LLMS_PATH, "utf8")).toBe(renderLlms(system));
  });

  // Prevents a part that names a class nothing styles, or a component that was renamed or deleted.
  it("names only classes with a stylesheet rule and files that exist", () => {
    const broken = system.parts.flatMap((part) => [
      ...(part.styles.length === 0
        ? [`${part.id}: no stylesheet rule starts with .${part.classes[0]}`]
        : []),
      ...part.classes
        .filter((name) => !new RegExp(`\\.${name}(?![\\w-])`).test(allCss))
        .map((name) => `${part.id}: .${name} is in no stylesheet`),
      ...(part.files ?? [])
        .filter((file) => !existsSync(join(ROOT, file)))
        .map((file) => `${part.id}: ${file} does not exist`),
    ]);
    expect(broken).toEqual([]);
  });

  // Prevents a dead part: an agent steered to a class the app no longer uses.
  it("lists only parts the app uses", () => {
    expect(system.parts.filter((part) => part.usedIn === 0).map((part) => part.id)).toEqual([]);
  });

  // Prevents a part keeping a class no markup writes: `usedIn` counts a part used when any one of its
  // classes is, so a dead class (filter-chips-scroll had a rule and no user) hid behind a live one.
  it("lists only classes the app writes", () => {
    const written = new Set(sourceFiles(APPS).flatMap((file) => [...file.tokens]));
    const owners = new Map<string, string[]>();
    for (const part of system.parts)
      for (const name of part.classes) owners.set(name, [...(owners.get(name) ?? []), part.id]);
    const dead = [...owners]
      .filter(([name, parts]) => parts.length === 1 && !written.has(name))
      .map(([name, parts]) => `${parts[0]}: .${name} is written by no markup`);
    expect(dead).toEqual([]);
  });

  // Prevents a shared control that no lookup can find: it is added to the style test's list and no part.
  it("covers every shared control class", () => {
    const text = readFileSync(APPS.bespoke, "utf8");
    const start = text.indexOf("const SHARED_CONTROLS");
    const block = text.slice(start, text.indexOf("];", start));
    const shared = [...block.matchAll(/"([a-z-]+)"/g)].map(([, name = ""]) => name);
    const covered = new Set(system.parts.flatMap((part) => part.classes));
    expect(shared.length).toBeGreaterThan(5);
    expect(shared.filter((name) => !covered.has(name))).toEqual([]);
  });

  // Prevents the bespoke list silently emptying if the style test's list changes shape.
  it("reads the bespoke controls from the style test", () => {
    expect(system.bespoke.length).toBeGreaterThan(20);
    expect(system.bespoke.every((item) => item.reason.length > 0)).toBe(true);
  });

  // Prevents telling an agent a part's own class is "not for reuse": the floating actions and toast
  // buttons are on the bespoke list and also belong to a part, which is how they are used.
  it("points a bespoke class that a part lists to that part", () => {
    const owned = system.bespoke.filter((item) => item.part);
    expect(owned.length).toBeGreaterThan(0);
    for (const item of owned)
      expect(system.parts.find((part) => part.id === item.part)?.classes).toContain(item.class);
    for (const item of system.bespoke.filter((entry) => !entry.part))
      expect(system.parts.flatMap((part) => part.classes)).not.toContain(item.class);
  });
});
