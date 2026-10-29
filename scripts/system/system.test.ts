import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildSystem,
  classTokens,
  LLMS_PATH,
  readBespoke,
  renderLlms,
  renderSystemJson,
  SYSTEM_PATH,
} from "./build.js";
import { findParts, findTokens } from "./query.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const system = buildSystem();
const ids = new Set(system.parts.map((part) => part.id));
const STYLES = join(ROOT, "apps/web/src/styles");
const allCss = readdirSync(STYLES)
  .filter((file) => file.endsWith(".css"))
  .map((file) => readFileSync(join(STYLES, file), "utf8"))
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
        .filter((file) => !existsSync(join(ROOT, "apps/web/src", file)))
        .map((file) => `${part.id}: ${file} does not exist`),
    ]);
    expect(broken).toEqual([]);
  });

  // Prevents a dead part: an agent steered to a class the app no longer uses.
  it("lists only parts the app uses", () => {
    expect(system.parts.filter((part) => part.usedIn === 0).map((part) => part.id)).toEqual([]);
  });

  // Prevents a "not this, use that" pointing at a part that does not exist.
  it("points every alternative at a part", () => {
    const dangling = system.parts.flatMap((part) =>
      (part.not ?? [])
        .filter((item) => !ids.has(item.use) && !item.use.startsWith("nothing"))
        .map((item) => `${part.id} -> ${item.use}`),
    );
    expect(dangling).toEqual([]);
    expect(ids.size).toBe(system.parts.length);
  });

  // Prevents a shared control that no lookup can find: it is added to the style test's list and no part.
  it("covers every shared control class", () => {
    const text = readFileSync(join(ROOT, "apps/web/src/styles/styles.test.ts"), "utf8");
    const start = text.indexOf("const SHARED_CONTROLS");
    const block = text.slice(start, text.indexOf("];", start));
    const shared = [...block.matchAll(/"([a-z-]+)"/g)].map(([, name = ""]) => name);
    const covered = new Set(system.parts.flatMap((part) => part.classes));
    expect(shared.length).toBeGreaterThan(5);
    expect(shared.filter((name) => !covered.has(name))).toEqual([]);
  });

  // Prevents the bespoke list silently emptying if the style test's list changes shape.
  it("reads the bespoke controls from the style test", () => {
    expect(readBespoke().length).toBeGreaterThan(20);
    expect(system.bespoke.every((item) => item.reason.length > 0)).toBe(true);
  });

  // Prevents the index outgrowing its purpose: it is read whole, so each byte is paid for on every task.
  it("keeps llms.txt under 14 KB", () => {
    expect(Buffer.byteLength(renderLlms(system))).toBeLessThan(14 * 1024);
  });
});

describe("class detection", () => {
  // Prevents a dead class passing for a live part: role="switch" and the word in prose once made
  // `.switch` look used in 49 files while no markup wore it, and an agent was sent to it.
  it("counts only names written as classes", () => {
    const used = classTokens(
      `<input class="settings-switch x" role="switch" /> <a class:list={["a-b", cond && 'c-d']}> switch (mode) {} el.classList.add("e-f") iconBtnHtml({ className: "g-h i-j" })`,
    );
    expect([...used].sort()).toEqual(["a-b", "c-d", "e-f", "g-h", "i-j", "settings-switch", "x"]);
  });
});

describe("the lookup", () => {
  // Needs from the first lookup trial (14 tasks given to agents that had no tool): the part an
  // experienced person would pick must be the first answer, or the lookup costs more than it saves.
  const NEEDS: [need: string, part: string][] = [
    [
      "add a switcher between the Stories and Transcript views of the same episode",
      "segmented-nav",
    ],
    ["let the user choose a summary length: exactly one of 3, 5 or 10 minutes", "segmented-choice"],
    ["let the user tick several topics to include", "filter-chip"],
    ["a new bottom sheet needs a title and a close control in its header", "sheet"],
    ["a new form sheet needs one main Save button and a Cancel beside it", "btn-primary"],
    ["a new page has nothing to list yet and must say so", "empty-state"],
    ["tell the user, persistently at the top of a page, that a download failed", "banner"],
    ["after the user deletes an episode, show a brief message with an Undo action", "toast"],
    ["add a row that opens a sub-page when tapped", "row-action"],
    ["add a compact dropdown to sort a list by date or by title", "sort-field"],
  ];

  it.each(NEEDS)("answers %j with %s first", (need, part) => {
    expect(findParts(system, need, 3)[0]?.part.id).toBe(part);
  });

  // Prevents a token lookup that cannot find the tonal fill, the muted ink or the sheet's motion.
  it("finds a token by what it is for", () => {
    const names = (need: string) => findTokens(system, need, 5).map((hit) => hit.token.name);
    expect(names("quiet secondary text that still passes 4.5:1 contrast")).toContain(
      "--color-on-surface-muted",
    );
    expect(names("tonal background for a control sitting on the page")).toContain(
      "--color-surface-container",
    );
    expect(names("bottom sheet slide-in duration")).toContain("--duration-sheet-in");
    expect(names("round the top corners of a bottom sheet")).toContain("--sheet-radius");
  });

  it("answers nothing for a need no part covers", () => {
    expect(findParts(system, "xyzzy plugh", 3)).toEqual([]);
  });
});
