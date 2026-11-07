import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCss, loadTokens } from "@singularity/design-system/scripts/buildTokens";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// apps/web has its own dash rule (apps/web/src/styles/styles.test.ts); this one covers what lies outside it.
describe("house rules for authored files", () => {
  // Built from code points so this file does not contain the characters it forbids.
  const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

  const roots = [
    "docs/design",
    "docs/specs",
    "scripts",
    "packages/sound/src",
    "apps/web/src/styles",
    "packages/design-system",
    "docs/prototype/sound-lab.html",
    "docs/prototype/ui-prototype.html",
  ];

  function files(path: string): string[] {
    const full = resolve(ROOT, path);
    const stats = statSync(full);
    if (stats.isFile()) return [full];
    return readdirSync(full).flatMap((name) => {
      if (name === "node_modules" || name === "screenshots") return [];
      return files(join(path, name));
    });
  }

  it("contains no em dashes or en dashes", () => {
    const offenders: string[] = [];
    for (const file of roots.flatMap(files)) {
      if (!/\.(ts|astro|css|json|md|html)$/.test(file)) continue;
      // Generated pages inline fonts as base64, which cannot contain these characters.
      const text = readFileSync(file, "utf8");
      if (DASHES.test(text)) offenders.push(file.replace(ROOT, ""));
    }
    expect(offenders).toEqual([]);
  });
});

// The prototype and the sound lab draw with the system's tokens from outside its package, so a token
// the system removes is caught here (D378 folded --color-on-surface-subtle), not in the package.
describe("the prototype stylesheets", () => {
  const foundations = readFileSync(
    resolve(ROOT, "packages/design-system/styles/foundations.css"),
    "utf8",
  );
  const defined = new Set(
    [...`${buildCss(loadTokens())}\n${foundations}`.matchAll(/(--[\w-]+)\s*:/g)].map(
      (match) => match[1] ?? "",
    ),
  );

  it.each(["scripts/prototype/ui-prototype.css", "scripts/soundLab/sound-lab.css"])(
    "keeps %s on defined tokens",
    (file) => {
      const source = readFileSync(resolve(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const local = new Set(defined);
      for (const match of source.matchAll(/(--[\w-]+)\s*:/g)) local.add(match[1] ?? "");
      // A reference with a fallback, such as var(--i, 0), is an input set by the caller.
      for (const match of source.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
        expect(local.has(match[1] ?? ""), `${file}: ${match[1]} is not defined`).toBe(true);
      }
      expect(source, `${file}: !important`).not.toMatch(/!important/);
      expect(source, `${file}: transition: all`).not.toMatch(/transition:\s*all\b/);
      expect(source, `${file}: scale(0)`).not.toMatch(/scale\(\s*0\s*[),]/);
      expect(source, `${file}: ease-in`).not.toMatch(/\bease-in\b(?!-out)/);
    },
  );
});
