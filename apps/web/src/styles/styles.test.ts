import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * House rules for the shell's own CSS, checked on the files it owns. tokens.css and foundations.css
 * belong to the design system and have their own tests (scripts/buildTokens.test.ts). Biome holds
 * the rules it can lint (`noImportantStyles` is an error in biome.json).
 */

const STYLES = import.meta.dirname;
const SRC = join(STYLES, "..");
const OWN_FILES = readdirSync(STYLES).filter(
  (file) => file.endsWith(".css") && !["tokens.css", "foundations.css"].includes(file),
);
const read = (file: string) => readFileSync(join(STYLES, file), "utf8");

/** Comments and the generated-font header carry prose and commands, not styles. */
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every own stylesheet without its comments, as [file, css]. */
const ownCss = () => OWN_FILES.map((file) => [file, withoutComments(read(file))] as const);

/** Source files under a directory (e2e excluded) with one of the extensions. */
function filesUnder(dir: string, extensions: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "e2e" ? [] : filesUnder(path, extensions);
    return extensions.some((extension) => path.endsWith(extension)) ? [path] : [];
  });
}

/**
 * The classes of controls whose face is words: a label on a track, a navigation item, the wordmark,
 * a text action, a card with a title. A press shows on their fill, their colour or an icon.
 */
const LABEL_CONTROLS = [
  "btn",
  "btn-primary",
  "btn-secondary",
  "source-main",
  "settings-segment",
  "segmented",
  "filter-chip",
  "chip",
  "app-nav-item",
  "app-nav-create",
  "wordmark",
  "toast-action",
  "card-link",
  "create-fab",
  "play-fab",
  "source-link",
  "hero-menu-item",
  "story-row",
  "player-upnext-row",
  "player-notice-action",
  "player-fallback-action",
  "script-back",
  "speed-btn",
  "speed-preset",
];

/** One house rule: its name and every place that breaks it. */
interface Rule {
  name: string;
  offenders: () => string[];
}

const RULES: Rule[] = [
  {
    name: "uses tokens for color, never a raw value",
    offenders: () =>
      ownCss().flatMap(([file, css]) => {
        // `color-mix(in oklch, var(--x) 8%, ...)` mixes tokens; the ban is on literal color functions.
        // `oklch(from var(--x) ...)` derives a color from a token, which is not a raw value either.
        const stripped = css
          .replace(/color-mix\(in [a-z]+/g, "color-mix(")
          .replace(/oklch\(from (?:var\(|red )/g, "derive(");
        const match =
          /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\(/.exec(
            stripped,
          );
        return match ? [`${file}: ${match[0]}`] : [];
      }),
  },
  {
    name: "the empty-state art holds no raw colour: every fill and stroke comes from a class",
    offenders: () => {
      const art = readFileSync(join(SRC, "components", "EmptyArt.astro"), "utf8");
      const match = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|style=|\bfill="|\bstroke="/.exec(art);
      return match ? [`EmptyArt.astro: ${match[0]}`] : [];
    },
  },
  {
    name: "takes spacing, type and radius from tokens, never a raw length",
    offenders: () => {
      // Space, type size, leading, tracking and corner radius each have a scale in tokens.css. A
      // literal length here is a value off that scale. Widths and heights are a component's own
      // dimensions and are not held to it.
      const scaled =
        /^(?:margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left|scroll-margin|scroll-padding|font-size|line-height|letter-spacing|border-radius|border-(?:start|end)-(?:start|end)-radius)(?:-[a-z-]+)?$/;
      const rawLength = /(?<![\w.-])-?\d*\.?\d+(?:px|rem|em)\b/;
      return ownCss().flatMap(([file, css]) =>
        [...css.matchAll(/^\s*([a-z-]+)\s*:\s*([^;{}]+);/gm)].flatMap(
          ([, property = "", value = ""]) => {
            if (!scaled.test(property)) return [];
            // What a var() falls back to is not this file's choice of value.
            const own = value.replace(/var\([^()]*(?:\([^()]*\)[^()]*)*\)/g, "token");
            return rawLength.test(own) ? [`${file}: ${property}: ${value.trim()}`] : [];
          },
        ),
      );
    },
  },
  {
    name: "uses only system colors that forced-colors mode defines",
    offenders: () => {
      const allowed = new Set(["GrayText", "Highlight", "CanvasText", "ButtonText"]);
      return ownCss().flatMap(([file, css]) =>
        [
          ...css.matchAll(
            /\b(Canvas|CanvasText|LinkText|GrayText|Highlight|ButtonText|ButtonFace|Field|Mark)\b/g,
          ),
        ]
          .filter((match) => !allowed.has(match[1] ?? ""))
          .map((match) => `${file}: ${match[1]}`),
      );
    },
  },
  {
    // A control that shrinks while pressed can slip out from under the pointer at its edge: the
    // cursor flickers and the press is dropped. The press scale stays close to 1.
    name: "keeps a pressable control the same size under the pointer",
    offenders: () => {
      const tokens = read("tokens.css");
      return ["--scale-press", "--scale-press-subtle"].filter((name) => {
        const value = Number(new RegExp(`${name}:\\s*([0-9.]+)`).exec(tokens)?.[1]);
        return !(value >= 0.94 && value <= 1);
      });
    },
  },
  {
    name: "never transitions all properties",
    offenders: () =>
      ownCss()
        .filter(([, css]) => /transition(?:-property)?\s*:\s*all\b/.test(css))
        .map(([file]) => file),
  },
  {
    // A bare `0s` is not a timing choice: it flips `visibility` at the end of a transform transition.
    name: "reads durations and curves from tokens",
    offenders: () => {
      const literal =
        /transition[^;{]*\b(?!0m?s\b)\d+(?:\.\d+)?m?s\b|animation(?:-duration)?\s*:[^;{]*\b(?!0m?s\b)\d+(?:\.\d+)?m?s\b/;
      return ownCss().flatMap(([file, css]) => {
        const match = literal.exec(css);
        return match ? [`${file}: ${match[0]}`] : [];
      });
    },
  },
  {
    // Every :hover rule sits inside a (hover: hover) block.
    name: "gates hover to fine pointers",
    offenders: () =>
      ownCss().flatMap(([file, css]) =>
        [...css.matchAll(/:hover/g)].flatMap((hover) => {
          const before = css.slice(0, hover.index);
          const lastGate = before.lastIndexOf("@media (hover: hover)");
          const lastClose = before.lastIndexOf("\n}\n");
          return lastGate === -1 || lastGate < lastClose
            ? [`${file}: a :hover rule outside @media (hover: hover) at ${hover.index}`]
            : [];
        }),
      ),
  },
  {
    name: "takes layer elevation from tokens, never a raw integer z-index",
    offenders: () =>
      ownCss()
        .filter(([, css]) => /^\s*z-index\s*:\s*-?\d+\s*;/m.test(css))
        .map(([file]) => file),
  },
  {
    // Two weights, regular and medium.
    name: "uses no third weight",
    offenders: () =>
      ownCss()
        .filter(([, css]) => /--font-weight-(?:semibold|bold)|font-weight:\s*[6-9]00/.test(css))
        .map(([file]) => file),
  },
  {
    // A state layer is 8% on hover and 12% on press, from the tokens, never a share of its own.
    name: "mixes state layers from the state tokens",
    offenders: () =>
      ["player.css", "sheets.css"].flatMap((file) =>
        [
          ...withoutComments(read(file)).matchAll(
            /^\s*background(?:-color)?\s*:[^;{}]*color-mix\([^;{}]*;/gm,
          ),
        ]
          .filter(([declaration = ""]) => /\d%/.test(declaration))
          .map(([declaration]) => `${file}: ${declaration.trim()}`),
      ),
  },
  {
    // Words never change size on a press. Scaling an element makes its text smaller for a moment
    // and draws its weight differently while it is scaled, which reads as a glitch. Controls whose
    // face is a label on a track (segments, chips, tabs) show a press on the thumb or the colour.
    name: "has no scale transform on the pressed state of a label control",
    offenders: () =>
      filesUnder(STYLES, [".css"]).flatMap((file) =>
        [...readFileSync(file, "utf8").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
          .filter(([, selector = "", body = ""]) => {
            if (!selector.includes(":active") || !/transform:\s*scale\(/.test(body)) return false;
            return LABEL_CONTROLS.some((name) => selector.includes(`.${name}`));
          })
          .map(([, selector = ""]) => `${file}: ${selector.trim()}`),
      ),
  },
  {
    name: "does not give a label control the press classes, which scale it",
    offenders: () =>
      filesUnder(SRC, [".astro", ".tsx"]).flatMap((file) => {
        const markup = readFileSync(file, "utf8");
        // A class attribute, or the string literals inside a class:list={[...]} array.
        const lists = [...markup.matchAll(/class:list=\{\[([^\]]*)\]\}/g)].flatMap((match) =>
          [...(match[1] ?? "").matchAll(/(["'`])((?:(?!\1).)*)\1/g)].map((literal) => literal[2]),
        );
        const attributes = [...markup.matchAll(/class(?:Name)?="([^"]*)"/g)].map(
          (match) => match[1],
        );
        return [...attributes, ...lists]
          .filter((value) => {
            const classes = (value ?? "").split(/\s+/);
            const label = classes.some((name) => LABEL_CONTROLS.includes(name));
            const press = classes.some((name) => name === "press" || name === "press-subtle");
            return label && press;
          })
          .map((value) => `${file}: ${value}`);
      }),
  },
];

describe("house rules", () => {
  it.each(RULES)("$name", ({ offenders }) => {
    expect(offenders()).toEqual([]);
  });
});

describe("component stylesheets", () => {
  it("covers every stylesheet the layout or an island imports", () => {
    const src = SRC;
    const sources = readdirSync(src, { recursive: true, encoding: "utf8" })
      .filter((file) => /\.(astro|tsx)$/.test(file))
      .map((file) => readFileSync(join(src, file), "utf8"));
    const imported = sources.flatMap((text) =>
      [...text.matchAll(/styles\/([a-z-]+\.css)/g)].map((match) => match[1]),
    );
    for (const file of OWN_FILES) expect(imported, `${file} is never imported`).toContain(file);
  });

  it("reads no custom property that nothing defines", () => {
    // `var(--space-5)` with no --space-5 is not an error to the browser: the whole declaration is
    // dropped, silently. A property with a fallback is one that script or a library may set.
    const src = SRC;
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
