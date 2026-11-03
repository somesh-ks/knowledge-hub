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
/**
 * The text inside quotes, where a class is written; a variable named `btn` is not a class. Comments
 * go first (an apostrophe in one opens a string that swallows the code after it), and so does the
 * path of an import (`../design-system/avatar` is a module, not a class).
 */
const quoted = (text: string) =>
  [
    // One pass, left to right: a string is kept whole (so "image/*" is not a comment), a comment is dropped.
    ...text
      .replace(/\b(?:from|import)\s*\(?\s*(["'])[^"'\n]*\1/g, "")
      .matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1|\/\*[\s\S]*?\*\/|(?<![:/\w])\/\/[^\n]*/g),
  ]
    .filter((m) => m[1] !== undefined)
    .map((m) => m[2])
    .join("\n");

describe("quoted (the class guard's reader)", () => {
  it("keeps a class after raw URL text or a glob string, and drops real comments", () => {
    const page = [
      '<a href="x" accept="image/*">https://example.com <b class="button-filled">',
      '/* class="hidden-in-comment" */',
      '// class="also-hidden"',
    ].join("\n");
    const text = quoted(page);
    expect(text).toContain("button-filled");
    expect(text).not.toContain("hidden-in-comment");
    expect(text).not.toContain("also-hidden");
  });
});

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
 * A menu drawn as a bottom sheet carries its header (title, subtitle, Close) and its body (D329). The
 * header may be hidden only by menu.css, and only over one visible row; the markup always holds it.
 * 2026-11-03: the queue row's menu drew `menuListClass()` with bare rows, so a phone showed a sheet with
 * no title and no Close, and no check read it. This one reads every file that draws a sheet menu.
 * shortcut: the check is per file, so a file that draws two sheets passes if one of them has the header;
 * upgrade to a rendered check (every `.menu-sheet` has a `.sheet-head`) if a file ever holds two.
 */
describe("a menu drawn as a bottom sheet", () => {
  const HEADER = /<SheetHeader\b|sheetHeadClass\(|sheetHeadHtml\(/;
  const BODY = /menuBodyClass\(/;
  const SHEET_MENU = /menuListClass\(\s*(?:true\s*)?\)/;
  const drawing = APPS.flatMap((root) => markupFiles(root))
    .map((file) => ({ file, text: readFileSync(file, "utf8") }))
    .filter(({ text }) => SHEET_MENU.test(text));

  it("is found where the app draws one", () => {
    expect(drawing.length, "the check reads no sheet menu").toBeGreaterThan(0);
  });

  it("every one draws its header and its body", () => {
    const missing = drawing.flatMap(({ file, text }) => {
      const name = relative(join(SRC, "..", "..", ".."), file);
      // The emoji picker scrolls its own grid; every other sheet menu wraps its rows.
      const needsBody = !file.endsWith("EmojiPicker.astro");
      return [
        ...(HEADER.test(text) ? [] : [`${name}: no header (SheetHeader or sheetHeadHtml)`]),
        ...(!needsBody || BODY.test(text)
          ? []
          : [`${name}: no body (wrap the rows in menuBodyClass())`]),
      ];
    });
    expect(missing, "a sheet menu with no title and no Close, even over one row").toEqual([]);
  });

  // shortcut: the search picker (scripts/picker.ts, the Create and Topics category picker) is a
  // combobox popover of its own, not yet a DS part; fold it into Select and drop this entry.
  // shortcut: per file, like the header check: a file that draws a Menu passes with a second, hand-built
  // popover beside it; upgrade to a rendered check (every open [popover] is a .menu-list) if one appears.
  const BUILT_OWN = ["scripts/picker.ts"];
  // In a tag, a bare `popover` is auto too, and a script can set it.
  const AUTO_POPOVER =
    /<[A-Za-z][^<>]*\spopover(?:\s*=\s*(?:"(?:auto)?"|'(?:auto)?'|auto\b)|(?=[\s>/]))/;
  const SET_AUTO_POPOVER = /setAttribute\(\s*(["'])popover\1\s*,\s*(["'])auto\2/;

  it("is the only popover and dialog a page opens", () => {
    // A hand-built panel is how the queue menu lost its header; every surface is a DS one.
    const stray = APPS.flatMap((root) => markupFiles(root)).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      const name = relative(join(SRC, "..", "..", ".."), file);
      const popover =
        (AUTO_POPOVER.test(text) || SET_AUTO_POPOVER.test(text)) &&
        !/menuListClass\(/.test(text) &&
        !BUILT_OWN.some((own) => file.endsWith(own));
      const dialog =
        (/^\s*<dialog\b/m.test(text) || /createElement\(\s*(["'`])dialog\1/.test(text)) &&
        !/dialogClass\(|sheetHeadHtml\(|sheetHeadClass\(|<SheetHeader\b/.test(text);
      return [
        ...(popover ? [`${name}: an auto popover that is not menuListClass()`] : []),
        ...(dialog ? [`${name}: a dialog with neither dialogClass() nor a sheet header`] : []),
      ];
    });
    expect(stray, "draw it with Menu, Sheet or Dialog (design-system/)").toEqual([]);
  });
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
