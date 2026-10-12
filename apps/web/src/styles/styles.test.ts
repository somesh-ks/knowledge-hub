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

  it("takes spacing, type and radius from tokens, never a raw length", () => {
    // Space, type size, leading, tracking and corner radius each have a scale in tokens.css. A
    // literal length here is a value off that scale. Widths and heights are a component's own
    // dimensions and are not held to it.
    const scaled =
      /^(?:margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left|scroll-margin|scroll-padding|font-size|line-height|letter-spacing|border-radius|border-(?:start|end)-(?:start|end)-radius)(?:-[a-z-]+)?$/;
    const rawLength = /(?<![\w.-])-?\d*\.?\d+(?:px|rem|em)\b/;
    for (const file of OWN_FILES) {
      for (const [, property = "", value = ""] of withoutComments(read(file)).matchAll(
        /^\s*([a-z-]+)\s*:\s*([^;{}]+);/gm,
      )) {
        if (!scaled.test(property)) continue;
        // What a var() falls back to is not this file's choice of value.
        const own = value.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, "token");
        expect(rawLength.exec(own)?.[0], `${file}: ${property}: ${value.trim()}`).toBeUndefined();
      }
    }
  });

  it("reads no custom property that nothing defines", () => {
    // `var(--space-5)` with no --space-5 is not an error to the browser: the whole declaration is
    // dropped, silently. A property with a fallback is one that script or a library may set.
    const src = join(STYLES, "..");
    const sources = readdirSync(src, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(css|astro|tsx|ts)$/.test(file) && !/\.(test|spec)\.tsx?$/.test(file))
      .map((file) => readFileSync(join(src, file), "utf8"));
    const defined = new Set(
      sources.flatMap((text) =>
        [
          ...text.matchAll(/(--[a-z0-9-]+)\s*:/gi),
          ...text.matchAll(/@property\s+(--[a-z0-9-]+)/gi),
          ...text.matchAll(/["'`](--[a-z0-9-]+)["'`]/gi),
        ].map((match) => match[1]),
      ),
    );
    for (const file of [...OWN_FILES, "foundations.css"]) {
      for (const [, name] of withoutComments(read(file)).matchAll(
        /var\(\s*(--[a-z0-9-]+)\s*\)/gi,
      )) {
        expect(defined.has(name), `${file} reads ${name}, which nothing defines`).toBe(true);
      }
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

  it("lets the pointer through the view transition overlay", () => {
    // Without it the cursor flickers to the arrow over a link on every navigation, and a press
    // during the transition is lost.
    const css = withoutComments(read("view-transitions.css")).replace(/\s+/g, " ");
    expect(css).toMatch(/::view-transition \{ pointer-events: none; \}/);
  });

  it("keeps a pressable control the same size under the pointer", () => {
    // A control that shrinks while pressed can slip out from under the pointer at its edge: the
    // cursor flickers and the press is dropped. The press scale stays close to 1.
    const tokens = read("tokens.css");
    for (const name of ["--scale-press", "--scale-press-subtle"]) {
      const value = Number(new RegExp(`${name}:\\s*([0-9.]+)`).exec(tokens)?.[1]);
      expect(value, name).toBeGreaterThanOrEqual(0.94);
      expect(value, name).toBeLessThanOrEqual(1);
    }
  });

  it("writes a scroll timeline with the animation longhands, never the shorthand", () => {
    // The build's minifier folds `animation` and `animation-timeline` of one rule into a single
    // shorthand declaration, which Chrome rejects: the fade or the line then never runs.
    for (const file of OWN_FILES) {
      const css = withoutComments(read(file));
      for (const block of css.matchAll(/\{([^{}]*)\}/g)) {
        const body = block[1] ?? "";
        if (!/animation-timeline\s*:/.test(body)) continue;
        expect(body, `${file}: ${body.trim().slice(0, 60)}`).not.toMatch(
          /(?:^|[;\s])animation\s*:/,
        );
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

  it("takes layer elevation from tokens, never a raw integer z-index", () => {
    const rawZIndex = /^\s*z-index\s*:\s*-?\d+\s*;/m;
    for (const file of OWN_FILES) {
      const match = rawZIndex.exec(withoutComments(read(file)));
      expect(match?.[0], `${file} has a raw integer z-index`).toBeUndefined();
    }
  });

  // Import order is not enough: the build splits stylesheets into chunks and reorders them, and a
  // page's own stylesheet comes after the layout's. The rule carries an id's weight instead, and
  // e2e/hidden.spec.ts checks the result on every built page.
  it("gives the [hidden] rule more weight than any component rule", () => {
    expect(withoutComments(read("utilities.css")).trim()).toBe(
      "[hidden]:not(#shown) {\n  display: none;\n}",
    );
  });

  // Two weights, regular and medium. topics.css is another area's and is the one left to convert.
  it("uses no third weight", () => {
    const allowed = ["topics.css"];
    for (const file of OWN_FILES.filter((name) => !allowed.includes(name))) {
      expect(withoutComments(read(file)), file).not.toMatch(
        /--font-weight-(?:semibold|bold)|font-weight:\s*[6-9]00/,
      );
    }
  });

  // A state layer is 8% on hover and 12% on press, from the tokens, never a share of its own.
  it("mixes state layers from the state tokens", () => {
    for (const file of ["player.css", "sheets.css"]) {
      for (const [declaration = ""] of withoutComments(read(file)).matchAll(
        /^\s*background(?:-color)?\s*:[^;{}]*color-mix\([^;{}]*;/gm,
      )) {
        expect(declaration, file).not.toMatch(/\d%/);
      }
    }
  });
});

describe("player and shell geometry rules", () => {
  const player = withoutComments(read("player.css"));

  it("lists chapters in one column with no mark, at the reading size and weight", () => {
    expect(player).not.toContain("story-row-mark");
    expect(player).toMatch(/\.story-row \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/);
    expect(player).toMatch(
      /\.story-row-title \{[^}]*font-size: var\(--font-size-reading\);[^}]*font-weight: var\(--text-reading-weight\);/,
    );
    expect(player).toMatch(/\.script-text \{[^}]*font-weight: var\(--text-reading-weight\);/);
  });

  it("keeps focus in a scrolling list clear of its fades", () => {
    expect(player).toMatch(/\.list-scroll \{[^}]*scroll-padding-block: var\(--space-12\);/);
  });

  it("draws no hairline over the bar and no layer over the whole bar on hover", () => {
    expect(player).not.toMatch(/\.player-dock \{[^}]*--color-border-hairline/);
    expect(player).not.toMatch(/\.dock-open:hover::after/);
  });

  it("lifts a toast over the floating Play only when the Play shows", () => {
    const sheets = withoutComments(read("sheets.css")).replace(/\s+/g, "");
    const hidden = ":has(.hero-actions):not([data-hero-away])";
    expect(withoutComments(read("create-sheet.css"))).toContain(`html${hidden} .play-fab`);
    const lift = /(html\[data-fab\][^{]*)\{--toast-lift:calc\(var\(--run-room\)\+/.exec(sheets);
    expect(lift?.[1]).toContain(`:not(${hidden})`);
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
