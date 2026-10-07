import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  aliasTarget,
  buildCss,
  cssName,
  declarationsFor,
  fluidClamp,
  hexFor,
  loadTokens,
  type Mode,
  resolveLiteral,
  TOKENS_CSS_PATH,
  type Token,
  type TokenDocument,
} from "./buildTokens.js";
import {
  composite,
  contrastRatio,
  oklchStringToRgb,
  parseOklch,
  type Rgb,
  relativeLuminance,
} from "./colorMath.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const doc: TokenDocument = loadTokens();
const MODES: Mode[] = ["light", "dark"];

function colorOf(path: string, mode: Mode): Rgb {
  const literal = resolveLiteral(doc, path, mode);
  if (typeof literal !== "string") throw new Error(`${path} is not a color`);
  return oklchStringToRgb(literal);
}

/** Opaque version of a color as seen over a surface, for translucent tokens. */
function seenOver(path: string, surfacePath: string, mode: Mode): Rgb {
  return composite(colorOf(path, mode), colorOf(surfacePath, mode));
}

function allReferences(value: unknown, found: string[] = []): string[] {
  const target = aliasTarget(value);
  if (target) found.push(target);
  else if (Array.isArray(value)) for (const item of value) allReferences(item, found);
  else if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) allReferences(item, found);
  }
  return found;
}

describe("token structure", () => {
  it("has the three tiers and no token without a type", () => {
    const tiers = new Set(doc.tokens.map((token) => token.tier));
    expect([...tiers].sort()).toEqual(["component", "primitive", "semantic"]);
    for (const token of doc.tokens) expect(token.type, token.dotPath).not.toBe("");
  });

  it("resolves every reference, including dark values, without cycles", () => {
    for (const token of doc.tokens) {
      for (const value of [token.value, token.dark]) {
        for (const target of allReferences(value)) {
          expect(doc.byPath.has(target), `${token.dotPath} -> {${target}}`).toBe(true);
        }
      }
      for (const mode of MODES) {
        if (token.type === "typography") continue;
        expect(() => resolveLiteral(doc, token.dotPath, mode), token.dotPath).not.toThrow();
      }
    }
  });

  it("keeps primitives literal and components off primitive colors", () => {
    for (const token of doc.tokens) {
      if (token.tier === "primitive") {
        expect(allReferences(token.value), `${token.dotPath} must be literal`).toEqual([]);
      }
      if (token.tier === "component") {
        for (const target of allReferences(token.value)) {
          const referenced = doc.byPath.get(target);
          const isPrimitiveColor = referenced?.tier === "primitive" && referenced.type === "color";
          expect(isPrimitiveColor, `${token.dotPath} reads primitive color {${target}}`).toBe(
            false,
          );
        }
      }
    }
  });

  it("gives every semantic color an explicit dark value", () => {
    for (const token of doc.tokens) {
      if (token.tier === "semantic" && token.type === "color") {
        expect(token.dark, `${token.dotPath} lacks a dark value`).toBeDefined();
      }
    }
  });

  it("keeps dark values the same type as their light values", () => {
    for (const token of doc.tokens) {
      if (token.dark === undefined) continue;
      const target = aliasTarget(token.dark);
      if (target) expect(doc.byPath.get(target)?.type, token.dotPath).toBe(token.type);
    }
  });

  it("produces unique CSS custom property names", () => {
    const seen = new Map<string, string>();
    for (const token of doc.tokens) {
      for (const declaration of declarationsFor(token, token.value, doc)) {
        const owner = seen.get(declaration.name);
        expect(
          owner,
          `${declaration.name} from ${token.dotPath} collides with ${owner}`,
        ).toBeUndefined();
        seen.set(declaration.name, token.dotPath);
      }
    }
  });
});

describe("color contrast", () => {
  const surfaces = ["surface", "surface-sunken", "surface-raised", "surface-overlay"];

  it.each(MODES)("text roles reach 4.5:1 on every surface (%s)", (mode) => {
    for (const foreground of ["on-surface", "on-surface-muted", "on-surface-subtle", "accent"]) {
      for (const surface of surfaces) {
        const ratio = contrastRatio(
          colorOf(`semantic.color.${foreground}`, mode),
          colorOf(`semantic.color.${surface}`, mode),
        );
        expect(ratio, `${foreground} on ${surface} (${mode})`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(MODES)("accent text and body text clear the accent tint (%s)", (mode) => {
    const tint = colorOf("semantic.color.accent-subtle", mode);
    for (const foreground of ["on-surface", "accent"]) {
      const ratio = contrastRatio(colorOf(`semantic.color.${foreground}`, mode), tint);
      expect(ratio, `${foreground} on accent-subtle (${mode})`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(MODES)("filled controls keep 4.5:1 label contrast in every state (%s)", (mode) => {
    for (const fill of ["accent", "accent-hover", "accent-pressed"]) {
      const ratio = contrastRatio(
        colorOf("semantic.color.on-accent", mode),
        colorOf(`semantic.color.${fill}`, mode),
      );
      expect(ratio, `on-accent on ${fill} (${mode})`).toBeGreaterThanOrEqual(4.5);
    }
    const toast = contrastRatio(
      colorOf("semantic.color.on-surface-inverse", mode),
      colorOf("semantic.color.surface-inverse", mode),
    );
    expect(toast, `toast text (${mode})`).toBeGreaterThanOrEqual(4.5);
  });

  it.each(MODES)("status colors read as text on surface, raised and their tint (%s)", (mode) => {
    for (const status of ["success", "warning", "danger", "info"]) {
      const foreground = colorOf(`semantic.color.${status}`, mode);
      for (const background of ["surface", "surface-raised", `${status}-subtle`]) {
        const ratio = contrastRatio(foreground, colorOf(`semantic.color.${background}`, mode));
        expect(ratio, `${status} on ${background} (${mode})`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(MODES)("non-text identifiers reach 3:1 (%s)", (mode) => {
    for (const graphic of ["accent", "focus-ring"]) {
      for (const surface of ["surface", "surface-raised", "surface-overlay"]) {
        const ratio = contrastRatio(
          colorOf(`semantic.color.${graphic}`, mode),
          colorOf(`semantic.color.${surface}`, mode),
        );
        expect(ratio, `${graphic} on ${surface} (${mode})`).toBeGreaterThanOrEqual(3);
      }
    }
    for (const surface of ["surface", "surface-raised", "surface-sunken"]) {
      const ratio = contrastRatio(
        colorOf("semantic.color.border-control", mode),
        colorOf(`semantic.color.${surface}`, mode),
      );
      expect(ratio, `border-control on ${surface} (${mode})`).toBeGreaterThanOrEqual(3);
    }
  });

  it("orders dark surfaces by elevation, lightest on top", () => {
    const luminance = (name: string) =>
      relativeLuminance(colorOf(`semantic.color.${name}`, "dark"));
    expect(luminance("surface")).toBeLessThan(luminance("surface-sunken"));
    expect(luminance("surface-sunken")).toBeLessThan(luminance("surface-raised"));
    expect(luminance("surface-raised")).toBeLessThan(luminance("surface-overlay"));
  });

  it("keeps the scrim dark enough to separate a sheet from the page", () => {
    for (const mode of MODES) {
      const page = colorOf("semantic.color.surface", mode);
      const dimmed = seenOver("semantic.color.scrim", "semantic.color.surface", mode);
      expect(relativeLuminance(dimmed), `scrim over page (${mode})`).toBeLessThan(
        relativeLuminance(page) * 0.75,
      );
    }
  });

  it("keeps the accent blue in both modes, clear of violet and cyan", () => {
    for (const mode of MODES) {
      const hue = parseOklch(String(resolveLiteral(doc, "semantic.color.accent", mode))).h;
      expect(hue, `accent hue (${mode})`).toBeGreaterThanOrEqual(245);
      expect(hue, `accent hue (${mode})`).toBeLessThanOrEqual(270);
    }
  });

  it("keeps the neutrals neutral: no surface or text role carries visible chroma", () => {
    for (const mode of MODES) {
      for (const role of ["surface", "surface-sunken", "on-surface", "on-surface-muted"]) {
        const chroma = parseOklch(String(resolveLiteral(doc, `semantic.color.${role}`, mode))).c;
        expect(chroma, `${role} (${mode})`).toBeLessThanOrEqual(0.015);
      }
    }
  });

  it("keeps the focus ring legible against the accent button it surrounds", () => {
    for (const mode of MODES) {
      const ring = colorOf("semantic.color.focus-ring", mode);
      const gap = colorOf("semantic.color.focus-gap", mode);
      expect(contrastRatio(ring, gap), `ring on gap (${mode})`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("scales", () => {
  it("keeps adjacent spacing steps at least 25 percent apart", () => {
    const steps = doc.tokens
      .filter((token) => token.path[1] === "space")
      .map((token) => Number.parseFloat(String(token.value)))
      .sort((a, b) => a - b);
    for (let index = 1; index < steps.length; index += 1) {
      const ratio = (steps[index] ?? 0) / (steps[index - 1] ?? 1);
      expect(ratio, `${steps[index - 1]} to ${steps[index]}`).toBeGreaterThanOrEqual(1.25);
    }
  });

  it("holds the concentric radius rule where a token declares it", () => {
    const toRem = (reference: string): number => {
      const value = resolveLiteral(doc, reference, "light");
      return Number.parseFloat(String(value));
    };
    let checked = 0;
    for (const token of doc.tokens) {
      const rule = token.extensions.concentric;
      if (typeof rule !== "object" || rule === null) continue;
      const { inner, padding } = rule as { inner: string; padding: string };
      const innerTarget = aliasTarget(inner);
      const paddingTarget = aliasTarget(padding);
      if (!innerTarget || !paddingTarget)
        throw new Error(`Bad concentric rule on ${token.dotPath}`);
      const outer = toRem(token.dotPath);
      expect(outer, `${token.dotPath}: outer = inner + padding`).toBeCloseTo(
        toRem(innerTarget) + toRem(paddingTarget),
        4,
      );
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it("compiles fluid sizes to a clamp that hits both endpoints", () => {
    const css = fluidClamp("1rem", "1.25rem", "20rem", "80rem");
    expect(css).toBe("clamp(1rem, 0.9167rem + 0.4167vw, 1.25rem)");
    const slope = 0.25 / 60;
    const intercept = 1 - slope * 20;
    expect(intercept + slope * 20).toBeCloseTo(1, 4);
    expect(intercept + slope * 80).toBeCloseTo(1.25, 4);
  });

  it("only uses the weights the type system allows", () => {
    const weights = doc.tokens
      .filter((token) => token.path[1] === "font" && token.path[2] === "weight")
      .map((token) => Number(token.value))
      .sort();
    expect(weights).toEqual([400, 500, 600, 700]);
  });
});

describe("motion tokens", () => {
  const durationMs = (token: Token): number => {
    const perceptual = token.extensions.perceptualMs;
    if (typeof perceptual === "number") return perceptual;
    return Number.parseFloat(String(token.value));
  };

  it("keeps every UI duration at or under 300ms, except the full-height drawer", () => {
    for (const token of doc.tokens.filter((candidate) => candidate.type === "duration")) {
      const name = token.path.at(-1) ?? "";
      if (name === "drawer-full") {
        expect(durationMs(token), name).toBeLessThanOrEqual(500);
        continue;
      }
      if (name === "spin") continue;
      const limit = typeof token.extensions.perceptualMs === "number" ? 500 : 300;
      expect(durationMs(token), name).toBeLessThanOrEqual(limit);
    }
  });

  it("keeps press feedback inside 100 to 160ms and asymmetric", () => {
    const pressIn = Number.parseFloat(String(doc.byPath.get("primitive.duration.press-in")?.value));
    const pressOut = Number.parseFloat(
      String(doc.byPath.get("primitive.duration.press-out")?.value),
    );
    expect(pressIn).toBeGreaterThanOrEqual(100);
    expect(pressOut).toBeLessThanOrEqual(160);
    expect(pressIn).toBeLessThan(pressOut);
  });

  it("keeps stagger inside 30 to 80ms", () => {
    const stagger = Number.parseFloat(String(doc.byPath.get("primitive.duration.stagger")?.value));
    expect(stagger).toBeGreaterThanOrEqual(30);
    expect(stagger).toBeLessThanOrEqual(80);
  });

  it("uses the DESIGN.md curves and never an ease-in", () => {
    expect(doc.byPath.get("primitive.ease.out")?.value).toEqual([0.23, 1, 0.32, 1]);
    expect(doc.byPath.get("primitive.ease.in-out")?.value).toEqual([0.77, 0, 0.175, 1]);
    expect(doc.byPath.get("primitive.ease.drawer")?.value).toEqual([0.32, 0.72, 0, 1]);
    for (const token of doc.tokens.filter((candidate) => candidate.path[1] === "ease")) {
      expect(String(token.value)).not.toMatch(/ease-in(?!-out)/);
    }
  });

  it("remaps only movement durations under reduced motion", () => {
    const reduced = doc.tokens.filter((token) => token.reducedMotion !== undefined);
    expect(reduced.length).toBeGreaterThan(0);
    for (const token of reduced) {
      expect(token.type).toBe("duration");
      expect(token.reducedMotion).toBe("0.01ms");
    }
    for (const kept of ["press-in", "press-out", "hover", "state", "progress", "theme"]) {
      expect(doc.byPath.get(`primitive.duration.${kept}`)?.reducedMotion).toBeUndefined();
    }
  });
});

describe("generated CSS", () => {
  const css = buildCss(doc);

  it("is deterministic", () => {
    expect(buildCss(loadTokens())).toBe(css);
  });

  it("matches the committed tokens.css", () => {
    expect(existsSync(TOKENS_CSS_PATH), "run npx tsx scripts/buildTokens.ts").toBe(true);
    expect(readFileSync(TOKENS_CSS_PATH, "utf8")).toBe(css);
  });

  it("carries the do-not-edit header and both dark entry points", () => {
    expect(css).toContain("GENERATED FILE. Do not edit.");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(':root:not([data-theme="light"])');
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("keeps the tier chain visible through var() references", () => {
    expect(css).toMatch(/--color-surface: var\(--color-white\);/);
    expect(css).toMatch(/--mini-player-bg: var\(--color-surface-overlay\);/);
  });

  it("contains no raw hex colors, because tokens are OKLCH", () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("expands typography composites into five properties", () => {
    for (const suffix of ["family", "size", "weight", "tracking", "leading"]) {
      expect(css).toContain(`--text-display-${suffix}:`);
    }
  });

  it("derives sRGB values for theme-color", () => {
    expect(hexFor(doc, "semantic.color.surface", "light")).toMatch(/^#[0-9a-f]{6}$/);
    expect(hexFor(doc, "semantic.color.surface", "dark")).toMatch(/^#[0-9a-f]{6}$/);
    expect(css).toContain("theme-color and manifest background (surface): light #");
  });

  it("names every token it emits", () => {
    expect(cssName(["primitive", "color", "grey", "50"])).toBe("--color-grey-50");
    expect(cssName(["component", "mini-player", "radius"])).toBe("--mini-player-radius");
  });
});

describe("style sources", () => {
  const defined = new Set<string>();
  // Tokens plus the custom properties foundations.css declares for components to read.
  const foundationsPath = resolve(ROOT, "apps/web/src/styles/foundations.css");
  const declared = existsSync(foundationsPath) ? readFileSync(foundationsPath, "utf8") : "";
  for (const match of `${buildCss(doc)}\n${declared}`.matchAll(/(--[\w-]+)\s*:/g)) {
    defined.add(match[1] ?? "");
  }

  const strip = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "");

  function checkSource(relativePath: string, options: { strictLiterals: boolean }): void {
    const path = resolve(ROOT, relativePath);
    if (!existsSync(path)) return;
    const source = strip(readFileSync(path, "utf8"));
    const local = new Set(defined);
    for (const match of source.matchAll(/(--[\w-]+)\s*:/g)) local.add(match[1] ?? "");

    // A reference with a fallback, such as var(--i, 0), is an input set by the caller.
    for (const match of source.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
      expect(local.has(match[1] ?? ""), `${relativePath}: ${match[1]} is not defined`).toBe(true);
    }
    expect(source, `${relativePath}: !important`).not.toMatch(/!important/);
    expect(source, `${relativePath}: transition: all`).not.toMatch(/transition:\s*all\b/);
    expect(source, `${relativePath}: scale(0)`).not.toMatch(/scale\(\s*0\s*[),]/);
    expect(source, `${relativePath}: ease-in`).not.toMatch(/\bease-in\b(?!-out)/);
    if (options.strictLiterals) {
      const body = source.replace(/@media[^{]*\{/g, "{").replace(/\.sr-only\s*\{[^}]*\}/g, "");
      expect(body, `${relativePath}: raw color literal`).not.toMatch(
        /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\(/i,
      );
      const rawDimension = (body.match(/(?<![\w-])-?\d*\.?\d+(?:px|rem|ms)\b/g) ?? []).filter(
        (value) => Number.parseFloat(value) !== 0,
      );
      expect(rawDimension, `${relativePath}: raw dimensions`).toEqual([]);
    }
  }

  it("keeps foundations.css on token references only", () => {
    checkSource("apps/web/src/styles/foundations.css", { strictLiterals: true });
  });

  it("keeps the prototype stylesheet on defined tokens", () => {
    checkSource("scripts/prototype/ui-prototype.css", { strictLiterals: false });
    checkSource("scripts/soundLab/sound-lab.css", { strictLiterals: false });
  });
});
