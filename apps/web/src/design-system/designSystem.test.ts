import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPONENTS } from "./registry";

/**
 * The guide shows the components the app uses, and only those (owner, 2026-10-29: "100% parity").
 * That holds only if a component's class is written in one place. Without these tests a page can
 * type `button-filled` by hand, copy a variant into its own stylesheet, or leave a class in the sheet
 * that no component draws, and the guide then shows something the app does not use.
 */

const SRC = join(import.meta.dirname, "..");
const STYLES = join(SRC, "styles");
/** Every app that draws the system: the admin app borrows the reader's stylesheets and components. */
const APPS = ["web", "admin", "design"]
  .map((app) => join(SRC, "..", "..", app, "src"))
  .filter((dir) => existsSync(dir));

/** Source files that draw markup: the app's pages, components, scripts and islands, not tests. */
function markupFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return ["e2e", "design-system", "fixtures", "testing"].includes(entry.name)
        ? []
        : markupFiles(path);
    }
    return /\.(astro|tsx?)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) ? [path] : [];
  });
}

const sheet = (name: string) => readFileSync(join(STYLES, name), "utf8");
const wholeClass = (name: string) => new RegExp(`(?<![\\w-])${name}(?![\\w-])`);
/** The text inside quotes, where a class is written; a variable named `btn` is not a class. */
const quoted = (text: string) =>
  [...text.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]).join("\n");

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

  it.each(COMPONENTS)(
    "$name: no page in any app writes its classes, or the ones it replaced, by hand",
    (c) => {
      const written = [...c.classes, ...c.retired];
      const offenders = APPS.flatMap((root) =>
        markupFiles(root).flatMap((file) => {
          const text = quoted(readFileSync(file, "utf8"));
          return written
            .filter((name) => wholeClass(name).test(text))
            .map((name) => `${relative(join(SRC, "..", "..", ".."), file)}: ${name}`);
        }),
      );
      expect(offenders, `draw it with ${c.name} (design-system/), never with its class`).toEqual(
        [],
      );
    },
  );
});

/**
 * The classes still written by hand in markup, which the system will absorb one family at a time
 * (docs/design-engineering-ledger.md). The list only shrinks: a family's PR moves its classes into
 * a component and deletes them from here; the test fails for a class that is no longer written, so
 * a stale entry cannot hide that the family is done.
 */
const NOT_YET_COMPONENTS = [
  "btn-action-tonal",
  "icon-btn",
  "icon-btn-tonal",
  "icon-btn-end",
  "chip",
  "filter-chip",
  "create-fab",
  "play-fab",
  "add-fab",
  "dock-btn",
  "transport-btn",
  "view-btn",
  "source-plus-btn",
  "text-link",
  "source-link",
  "player-source-link",
  "edit-address-link",
  "story-link",
  "aside-link",
  "skip-link",
  "card-link",
];

describe("the controls not yet components", () => {
  it("lists only classes a page still writes by hand", () => {
    const text = markupFiles(SRC)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const gone = NOT_YET_COMPONENTS.filter((name) => !wholeClass(name).test(text));
    expect(gone, "no longer written by hand: delete these entries").toEqual([]);
  });
});
