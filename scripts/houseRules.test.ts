import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
    "tokens",
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
      if (!/\.(ts|css|json|md|html)$/.test(file)) continue;
      // Generated pages inline fonts as base64, which cannot contain these characters.
      const text = readFileSync(file, "utf8");
      if (DASHES.test(text)) offenders.push(file.replace(ROOT, ""));
    }
    expect(offenders).toEqual([]);
  });
});
