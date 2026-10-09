import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Words never change size on a press. Scaling an element makes its text smaller for a moment and
 * draws its weight differently while it is scaled, which reads as a glitch. Controls whose face is a
 * label on a track (segments, chips, tabs) show a press on the thumb or the colour instead.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The classes of controls that carry a label on a track. */
const LABEL_CONTROLS = ["settings-segment", "segmented", "create-chip", "podcast-tab"];

function filesUnder(dir: string, extensions: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "e2e" ? [] : filesUnder(path, extensions);
    return extensions.some((extension) => path.endsWith(extension)) ? [path] : [];
  });
}

describe("a press never scales words", () => {
  it("has no scale transform on the pressed state of a label control", () => {
    const offenders: string[] = [];
    for (const file of filesUnder(join(SRC, "styles"), [".css"])) {
      const css = readFileSync(file, "utf8");
      for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = match[1] ?? "";
        const body = match[2] ?? "";
        if (!selector.includes(":active") || !/transform:\s*scale\(/.test(body)) continue;
        if (LABEL_CONTROLS.some((name) => selector.includes(`.${name}`))) {
          offenders.push(`${file}: ${selector.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not give a label control the press classes, which scale it", () => {
    const offenders: string[] = [];
    for (const file of filesUnder(SRC, [".astro", ".tsx"])) {
      const markup = readFileSync(file, "utf8");
      for (const match of markup.matchAll(/class(?:Name)?="([^"]*)"/g)) {
        const classes = (match[1] ?? "").split(/\s+/);
        const label = classes.some((name) => LABEL_CONTROLS.includes(name));
        const press = classes.some((name) => name === "press" || name === "press-subtle");
        if (label && press) offenders.push(`${file}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
