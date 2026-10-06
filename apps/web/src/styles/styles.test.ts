import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * House rules for the shell's own CSS, checked on the files it owns. tokens.css and foundations.css
 * belong to the design system and have their own tests (scripts/buildTokens.test.ts).
 */

const STYLES = import.meta.dirname;
const OWN_FILES = readdirSync(STYLES).filter(
  (file) => file.endsWith(".css") && !["tokens.css", "foundations.css"].includes(file),
);
const read = (file: string) => readFileSync(join(STYLES, file), "utf8");

/** Comments and the generated-font header carry prose and commands, not styles. */
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("component stylesheets", () => {
  it("covers every stylesheet the layout or an island imports", () => {
    const src = join(STYLES, "..");
    const sources = readdirSync(src, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(astro|tsx)$/.test(file))
      .map((file) => readFileSync(join(src, file), "utf8"));
    const imported = sources.flatMap((text) =>
      [...text.matchAll(/styles\/([a-z-]+\.css)/g)].map((match) => match[1]),
    );
    for (const file of OWN_FILES) expect(imported, `${file} is never imported`).toContain(file);
  });

  it("names files in kebab-case", () => {
    for (const file of OWN_FILES) expect(file).toMatch(/^[a-z]+(-[a-z]+)*\.css$/);
  });

  it("uses tokens for color, never a raw value", () => {
    const rawColor = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/;
    for (const file of OWN_FILES) {
      const css = withoutComments(read(file));
      // `color-mix(in oklch, var(--x) 8%, ...)` mixes tokens; the ban is on literal color functions.
      // `oklch(from var(--x) ...)` derives a color from a token, which is not a raw value either.
      const stripped = css
        .replace(/color-mix\(in [a-z]+/g, "color-mix(")
        .replace(/oklch\(from (?:var\(|red )/g, "derive(");
      const match = rawColor.exec(stripped);
      expect(match?.[0], `${file} has a raw color`).toBeUndefined();
    }
  });

  it("uses only system colors that forced-colors mode defines", () => {
    const allowed = new Set(["GrayText", "Highlight", "CanvasText", "ButtonText"]);
    for (const file of OWN_FILES) {
      for (const match of withoutComments(read(file)).matchAll(
        /\b(Canvas|CanvasText|LinkText|GrayText|Highlight|ButtonText|ButtonFace|Field|Mark)\b/g,
      )) {
        expect(allowed.has(match[1] ?? ""), `${file}: ${match[1]}`).toBe(true);
      }
    }
  });

  it("never uses !important or transition: all", () => {
    for (const file of OWN_FILES) {
      const css = withoutComments(read(file));
      expect(css, file).not.toMatch(/!important/);
      expect(css, file).not.toMatch(/transition\s*:\s*all\b/);
      expect(css, file).not.toMatch(/transition-property\s*:\s*all\b/);
    }
  });

  it("reads durations and curves from tokens", () => {
    // A bare `0s` is not a timing choice: it flips `visibility` at the end of a transform transition.
    const literal =
      /transition[^;{]*\b(?!0m?s\b)\d+(?:\.\d+)?m?s\b|animation(?:-duration)?\s*:[^;{]*\b(?!0m?s\b)\d+(?:\.\d+)?m?s\b/;
    for (const file of OWN_FILES) {
      expect(
        literal.exec(withoutComments(read(file)))?.[0],
        `${file} has a literal duration`,
      ).toBeUndefined();
    }
  });

  it("gates hover to fine pointers", () => {
    for (const file of OWN_FILES) {
      const css = withoutComments(read(file));
      // Every :hover rule sits inside a (hover: hover) block.
      for (const hover of css.matchAll(/:hover/g)) {
        const before = css.slice(0, hover.index);
        const lastGate = before.lastIndexOf("@media (hover: hover)");
        const lastClose = before.lastIndexOf("\n}\n");
        expect(lastGate, `${file}: a :hover rule outside @media (hover: hover)`).toBeGreaterThan(
          -1,
        );
        expect(
          lastGate,
          `${file}: a :hover rule outside @media (hover: hover)`,
        ).toBeGreaterThanOrEqual(lastClose - 0);
      }
    }
  });

  it("imports the [hidden] rule last, so no component rule can override it", () => {
    const layout = readFileSync(join(STYLES, "..", "layouts", "BaseLayout.astro"), "utf8");
    const imports = [...layout.matchAll(/import "\.\.\/styles\/([a-z-]+\.css)"/g)].map(
      (match) => match[1],
    );
    expect(imports.at(-1)).toBe("utilities.css");
    expect(withoutComments(read("utilities.css")).trim()).toBe("[hidden] {\n  display: none;\n}");
  });
});

describe("source files", () => {
  const ROOT = join(STYLES, "..", "..");
  const SKIP = new Set(["node_modules", "dist", ".astro", ".vercel", "test-results"]);

  function files(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      if (SKIP.has(entry.name)) return [];
      const path = join(directory, entry.name);
      return entry.isDirectory() ? files(path) : [path];
    });
  }

  const TEXT = new Set([
    ".ts",
    ".tsx",
    ".astro",
    ".css",
    ".js",
    ".mjs",
    ".json",
    ".svg",
    ".txt",
    ".md",
  ]);

  it("has no em or en dashes anywhere, in code, copy or tests", () => {
    const dashes = new RegExp(`[${String.fromCharCode(0x2014)}${String.fromCharCode(0x2013)}]`);
    for (const file of files(ROOT).filter((path) => TEXT.has(extname(path)))) {
      expect(dashes.test(readFileSync(file, "utf8")), `${file} contains a dash`).toBe(false);
    }
  });

  it("has no placeholder text", () => {
    const placeholder = /\b(lorem ipsum|TODO|FIXME|XXX|placeholder text|coming soon)\b/i;
    for (const file of files(join(ROOT, "src")).filter(
      (path) => TEXT.has(extname(path)) && !path.endsWith(".test.ts"),
    )) {
      expect(placeholder.exec(readFileSync(file, "utf8"))?.[0], file).toBeUndefined();
    }
  });
});
