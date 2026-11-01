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
  hapticModule,
  hexFor,
  loadTokens,
  type Mode,
  parseTokens,
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
import { derivedColors, RAMP_STEPS, RAMPS, type RampName, rampStep } from "./colorRamp.js";
import { type SpringParams, springCurve } from "./springCurve.js";

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
  const surfaces = [
    "surface",
    "surface-sunken",
    "surface-container",
    "surface-raised",
    "surface-overlay",
  ];

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

  it.each(MODES)(
    "the reading ink is AAA on the page, 4.5:1 on every surface, and a step under the headline's (%s)",
    (mode) => {
      for (const surface of surfaces) {
        const background = colorOf(`semantic.color.${surface}`, mode);
        const reading = contrastRatio(
          colorOf("semantic.color.on-surface-reading", mode),
          background,
        );
        expect(reading, `on-surface-reading on ${surface} (${mode})`).toBeGreaterThanOrEqual(
          surface === "surface" ? 7 : 4.5,
        );
        expect(
          contrastRatio(colorOf("semantic.color.on-surface", mode), background),
          `the headline leads its summary on ${surface} (${mode})`,
        ).toBeGreaterThan(reading * 1.2);
      }
    },
  );

  it.each(MODES)("accent text and body text clear the accent tint (%s)", (mode) => {
    const tint = colorOf("semantic.color.accent-subtle", mode);
    for (const foreground of ["on-surface", "accent"]) {
      const ratio = contrastRatio(colorOf(`semantic.color.${foreground}`, mode), tint);
      expect(ratio, `${foreground} on accent-subtle (${mode})`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(MODES)("text on the accent container reaches 4.5:1 (%s)", (mode) => {
    const container = colorOf("semantic.color.accent-container", mode);
    for (const foreground of ["on-accent-container", "on-surface", "on-surface-muted"]) {
      const ratio = contrastRatio(colorOf(`semantic.color.${foreground}`, mode), container);
      expect(ratio, `${foreground} on accent-container (${mode})`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(MODES)(
    "text on the action tone reaches 4.5:1, and the tone sits further from the page than the selected one (%s)",
    (mode) => {
      const high = colorOf("semantic.color.accent-container-high", mode);
      const page = colorOf("semantic.color.surface", mode);
      const ratio = contrastRatio(colorOf("semantic.color.on-accent-container-high", mode), high);
      expect(
        ratio,
        `on-accent-container-high on accent-container-high (${mode})`,
      ).toBeGreaterThanOrEqual(4.5);
      const chosen = contrastRatio(colorOf("semantic.color.accent-container", mode), page);
      expect(
        contrastRatio(high, page),
        `the New episode button reads as an action, not a current place (${mode})`,
      ).toBeGreaterThan(chosen + 0.2);
      // The rail's Catch up: a shape at 3:1 on the page with no outline, its words at 4.5:1, and
      // further from the page than the current row, so it never reads as faded or as selected.
      const action = colorOf("semantic.color.accent-action", mode);
      expect(
        contrastRatio(colorOf("semantic.color.on-accent-action", mode), action),
        `on-accent-action on accent-action (${mode})`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(action, page),
        `accent-action on the page (${mode})`,
      ).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(MODES)("tonal containers read against the page without an outline (%s)", (mode) => {
    const page = colorOf("semantic.color.surface", mode);
    for (const [container, least] of [
      ["surface-container", 1.08],
      ["accent-container", 1.2],
    ] as const) {
      const ratio = contrastRatio(colorOf(`semantic.color.${container}`, mode), page);
      expect(ratio, `${container} on the page (${mode})`).toBeGreaterThanOrEqual(least);
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
      for (const role of [
        "surface",
        "surface-sunken",
        "surface-container",
        "on-surface",
        "on-surface-muted",
      ]) {
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

interface Tree {
  $value?: unknown;
  $extensions?: unknown;
  [key: string]: unknown;
}

/** The token document with one style's values laid over the base, as the page sees it under data-style. */
function documentUnder(style: string): TokenDocument {
  const base = JSON.parse(readFileSync(resolve(ROOT, "tokens/tokens.json"), "utf8"));
  const overlay = (into: Tree, from: Tree): void => {
    for (const [key, node] of Object.entries(from)) {
      if (key.startsWith("$")) continue;
      const child = node as Tree;
      if ("$value" in child) {
        into[key] = {
          ...(into[key] as Tree),
          $value: child.$value,
          ...(child.$extensions ? { $extensions: child.$extensions } : {}),
        };
      } else overlay(into[key] as Tree, child);
    }
  };
  overlay(base, base.styles[style]);
  return parseTokens({ ...base, styles: {} });
}

// D268 says the contrast tests cover a style's colours; they ran on the base only until D306 added a style
// whose palette is its own. Each style gets the base's text, action and graphic floors, in both modes.
describe.each(doc.styles.map((style) => style.name))("a style's colour contrast: %s", (name) => {
  const styled = documentUnder(name);
  const color = (role: string, mode: Mode): Rgb => {
    const literal = resolveLiteral(styled, `semantic.color.${role}`, mode);
    if (typeof literal !== "string") throw new Error(`${role} is not a color`);
    return oklchStringToRgb(literal);
  };
  const surfaces = [
    "surface",
    "surface-sunken",
    "surface-container",
    "surface-raised",
    "surface-overlay",
  ];

  // The reader's hue (D312) turns every coloured value of a style, so the floors must hold at each hue
  // the slider can reach, not only the one the style was designed at.
  const SHIFTS = Array.from({ length: 72 }, (_, i) => i * 5);
  const turn = (literal: string, shift: number): string =>
    literal.replace(
      /^oklch\(([\d.]+%?) ([\d.]+) (-?[\d.]+)(.*)\)$/,
      (_whole, l: string, c: string, h: string, rest: string) =>
        `oklch(${l} ${c} ${(Number(h) + (Number(c) === 0 ? 0 : shift)) % 360}${rest})`,
    );

  it.each(MODES)("holds the base's text, action and graphic floors (%s)", (mode) => {
    const floors: [foreground: string, background: string, least: number][] = [
      ...["on-surface", "on-surface-muted", "on-surface-subtle", "accent"].flatMap((fg) =>
        surfaces.map((bg): [string, string, number] => [fg, bg, 4.5]),
      ),
      ...surfaces.map((bg): [string, string, number] => [
        "on-surface-reading",
        bg,
        bg === "surface" ? 7 : 4.5,
      ]),
      ["on-surface", "accent-subtle", 4.5],
      ["accent", "accent-subtle", 4.5],
      ["on-accent-container", "accent-container", 4.5],
      ["on-surface", "accent-container", 4.5],
      ["on-surface-muted", "accent-container", 4.5],
      ["on-accent-container-high", "accent-container-high", 4.5],
      ["on-accent-action", "accent-action", 4.5],
      ["accent-action", "surface", 3],
      ["on-accent", "accent", 4.5],
      ["on-accent", "accent-hover", 4.5],
      ["on-accent", "accent-pressed", 4.5],
      ["on-surface-inverse", "surface-inverse", 4.5],
      ...["accent", "focus-ring"].flatMap((fg) =>
        ["surface", "surface-raised", "surface-overlay"].map((bg): [string, string, number] => [
          fg,
          bg,
          3,
        ]),
      ),
      ...["surface", "surface-raised", "surface-sunken"].map((bg): [string, string, number] => [
        "border-control",
        bg,
        3,
      ]),
    ];
    const turned = (role: string, shift: number): Rgb => {
      const literal = resolveLiteral(styled, `semantic.color.${role}`, mode);
      if (typeof literal !== "string") throw new Error(`${role} is not a color`);
      return oklchStringToRgb(turn(literal, shift));
    };
    const failures = SHIFTS.flatMap((shift) =>
      floors.flatMap(([foreground, background, least]) => {
        const ratio = contrastRatio(turned(foreground, shift), turned(background, shift));
        return ratio >= least
          ? []
          : [`hue +${shift}, ${foreground} on ${background}: ${ratio.toFixed(2)}, needs ${least}`];
      }),
    );
    expect(failures, `${name} (${mode})`).toEqual([]);
  });
});

describe("scales", () => {
  // A step named out of order gets picked for the wrong job: blue-875 once sat darker than blue-900.
  it("darkens every colour ramp as its step number rises", () => {
    const ramps = new Map<string, { step: number; l: number }[]>();
    for (const token of doc.tokens) {
      const [tier, group, ramp, step] = token.path;
      if (tier !== "primitive" || group !== "color" || !ramp || !/^\d+$/.test(step ?? "")) continue;
      const steps = ramps.get(ramp) ?? [];
      steps.push({ step: Number(step), l: parseOklch(String(token.value)).l });
      ramps.set(ramp, steps);
    }
    expect(ramps.size).toBeGreaterThan(1);
    for (const [ramp, steps] of ramps) {
      steps.sort((a, b) => a.step - b.step);
      for (let index = 1; index < steps.length; index += 1) {
        const [lighter, darker] = [steps[index - 1], steps[index]];
        expect(darker?.l, `${ramp}-${darker?.step} under ${ramp}-${lighter?.step}`).toBeLessThan(
          lighter?.l ?? 0,
        );
      }
    }
  });

  // Blue once had 14 hand-picked steps, grey 16 and the status colors 4, and no two agreed on what
  // "600" meant. Every color is a hue and a peak chroma on the one curve in scripts/colorRamp.ts.
  it("gives every color ramp the same ten steps, at the same lightness, inside sRGB", () => {
    for (const name of Object.keys(RAMPS) as RampName[]) {
      const steps = doc.tokens
        .filter((token) => token.dotPath.startsWith(`primitive.color.${name}.`))
        .map((token) => ({ step: Number(token.path[3]), color: parseOklch(String(token.value)) }));
      expect(
        steps.map((entry) => entry.step),
        name,
      ).toEqual([...RAMP_STEPS]);
      for (const { step, color } of steps) {
        expect(color.l, `${name}-${step} lightness`).toBeCloseTo(rampStep("blue", step as 50).l, 3);
        expect(
          oklchStringToRgb(String(doc.byPath.get(`primitive.color.${name}.${step}`)?.value))
            .inGamut,
        ).toBe(true);
      }
    }
  });

  it("matches tokens.json to the curve, so a hand edit to a ramp fails here", () => {
    const committed = Object.fromEntries(
      doc.tokens
        .filter((token) => token.path[0] === "primitive" && token.path[1] === "color")
        .map((token) => [token.path.slice(2).join("."), String(token.value)]),
    );
    const derived: Record<string, string> = {};
    for (const [group, node] of Object.entries(derivedColors())) {
      if (group.startsWith("$")) continue;
      if ("$value" in (node as object))
        derived[group] = String((node as { $value: string }).$value);
      else {
        for (const [key, leaf] of Object.entries(node as object)) {
          if (!key.startsWith("$"))
            derived[`${group}.${key}`] = String((leaf as { $value: string }).$value);
        }
      }
    }
    expect(committed).toEqual(derived);
  });

  it("keeps adjacent spacing steps at least 25 percent apart", () => {
    const steps = doc.tokens
      .filter((token) => token.path[1] === "space")
      .map((token) => Number.parseFloat(String(token.value)))
      .sort((a, b) => a - b);
    // The 8pt system: every step is a multiple of 8px, save one 4px step for the named fine cases.
    // A 12px or 2px step let near-equal gaps creep in between rows and under headings.
    expect(steps.filter((rem) => (rem * 16) % 8 !== 0)).toEqual([0.25]);
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
    expect(checked).toBeGreaterThanOrEqual(4);
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

  it("keeps durations inside the motion policy: UI, press feedback and stagger", () => {
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
    const ms = (name: string): number =>
      Number.parseFloat(String(doc.byPath.get(`primitive.duration.${name}`)?.value));
    expect(ms("press-in")).toBeGreaterThanOrEqual(100);
    expect(ms("press-out")).toBeLessThanOrEqual(160);
    expect(ms("press-in")).toBeLessThan(ms("press-out"));
    expect(ms("stagger")).toBeGreaterThanOrEqual(30);
    expect(ms("stagger")).toBeLessThanOrEqual(80);
  });

  it("never uses an ease-in; under reduced motion travel is zeroed and fades keep their timing", () => {
    for (const token of doc.tokens.filter((candidate) => candidate.path[1] === "ease")) {
      expect(String(token.value)).not.toMatch(/ease-in(?!-out)/);
    }
    const reduced = doc.tokens.filter((token) => token.reducedMotion !== undefined);
    expect(reduced.length).toBeGreaterThan(0);
    for (const token of reduced) {
      expect(["duration", "dimension", "number"]).toContain(token.type);
      if (token.type === "duration") expect(token.reducedMotion).toBe("0.01ms");
    }
    for (const travel of ["distance.micro", "distance.base", "distance.medium"]) {
      expect(doc.byPath.get(`primitive.${travel}`)?.reducedMotion).toBe("0px");
    }
    expect(doc.byPath.get("primitive.scale.enter")?.reducedMotion).toBe("1");
    for (const kept of [
      "enter",
      "exit",
      "stagger",
      "press-in",
      "press-out",
      "hover",
      "state",
      "progress",
      "theme",
    ]) {
      expect(doc.byPath.get(`primitive.duration.${kept}`)?.reducedMotion).toBeUndefined();
    }
  });
});

describe("expressive spring tokens", () => {
  const springs = doc.tokens.filter(
    (token) => token.path[1] === "ease" && typeof token.extensions.spring === "object",
  );

  it("draws each curve from the stiffness and damping its token records, so a hand edit cannot drift", () => {
    expect(springs.length).toBe(6);
    for (const token of springs) {
      const params = token.extensions.spring as SpringParams;
      const name = token.path.at(-1) ?? "";
      const samples = name.includes("spatial") ? 36 : 24;
      const curve = springCurve(params, samples);
      expect(token.value, name).toBe(curve.easing);
      const duration = doc.byPath.get(`primitive.duration.${name}`);
      expect(duration?.value, name).toBe(`${curve.durationMs}ms`);
    }
  });

  it("lets only spatial springs overshoot; an effects spring on a fade or a colour never flickers past its target", () => {
    for (const token of springs) {
      const peak = springCurve(token.extensions.spring as SpringParams, 24).peak;
      if (token.path.at(-1)?.includes("effects"))
        expect(peak, token.dotPath).toBeLessThanOrEqual(1);
    }
  });

  it("collapses spatial springs under reduced motion and keeps effects springs, which are fades", () => {
    for (const size of ["fast", "default", "slow"]) {
      const spatial = doc.byPath.get(`primitive.duration.spring-spatial-${size}`);
      const effects = doc.byPath.get(`primitive.duration.spring-effects-${size}`);
      expect(spatial?.reducedMotion).toBe("0.01ms");
      expect(effects?.reducedMotion).toBeUndefined();
    }
  });
});

describe("generated CSS", () => {
  const css = buildCss(doc);

  it("is deterministic", () => {
    expect(buildCss(loadTokens())).toBe(css);
  });

  it("emits the spatial spring reduced-motion overrides, so a travelling spring collapses to nothing", () => {
    const reduced =
      css.match(
        /@media \(prefers-reduced-motion: reduce\) \{\n {2}:root \{([\s\S]*?)\n {2}\}\n\}/,
      )?.[1] ?? "";
    for (const size of ["fast", "default", "slow"]) {
      expect(reduced).toContain(`--duration-spring-spatial-${size}: 0.01ms;`);
    }
  });

  it("matches the committed tokens.css", () => {
    expect(existsSync(TOKENS_CSS_PATH), "run npx tsx scripts/buildTokens.ts").toBe(true);
    expect(readFileSync(TOKENS_CSS_PATH, "utf8")).toBe(css);
  });

  it("contains no raw hex colors, because tokens are OKLCH", () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b/i);
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

describe("styles", () => {
  const raw = JSON.parse(readFileSync(resolve(ROOT, "tokens/tokens.json"), "utf8"));
  const withStyle = (style: unknown): TokenDocument =>
    parseTokens({ ...raw, styles: { bold: style } });
  const surface = (value: string, dark?: string) => ({
    $value: value,
    ...(dark ? { $extensions: { singularity: { mode: { dark } } } } : {}),
  });

  it("writes a style after the base's dark blocks, so at equal weight the style wins", () => {
    const css = buildCss(
      withStyle({
        semantic: { color: { surface: surface("oklch(99% 0 0)", "oklch(10% 0 0)") } },
        component: { card: { radius: { $value: "2.5rem" } } },
      }),
    );
    const at = (needle: string): number => css.indexOf(needle);
    expect(at(':root[data-style="bold"] {')).toBeGreaterThan(at(':root[data-theme="dark"] {'));
    expect(at(':root[data-style="bold"] {')).toBeLessThan(at("prefers-reduced-motion"));
    expect(css).toContain(':root:not([data-theme="light"])[data-style="bold"] {');
    expect(css).toContain(':root[data-theme="dark"][data-style="bold"] {');
    expect(css).toContain("--card-radius: 2.5rem;");
    const dark = css.slice(at(':root[data-theme="dark"][data-style="bold"] {'));
    const darkBody = dark.slice(0, dark.indexOf("}"));
    expect(darkBody).toContain("oklch(10% 0 0)");
    expect(darkBody).not.toContain("oklch(99% 0 0)");
  });

  // The reader's hue slider (D312) moves a style by `--hue-shift`; a colour written without it would
  // stay put while the rest of the palette turned, and nothing else would notice.
  it("turns every coloured value of a style with the reader's hue, and leaves greys", () => {
    const css = buildCss(
      withStyle({
        semantic: {
          color: {
            surface: surface("oklch(96% 0.02 292)", "oklch(19% 0.05 292)"),
            "on-surface": surface("oklch(20% 0 0)", "oklch(95% 0 0)"),
            accent: surface("{primitive.color.violet.600}", "{primitive.color.violet.300}"),
          },
        },
      }),
    );
    const block = css.slice(css.indexOf(':root[data-style="bold"] {'));
    const body = block.slice(0, block.indexOf("}"));
    expect(body).toContain("--color-surface: oklch(96% 0.02 calc(292 + var(--hue-shift, 0)));");
    expect(body).toContain("--color-on-surface: oklch(20% 0 0);");
    expect(body).toMatch(/--color-violet-600: oklch\([\d.]+% [\d.]+ calc\(292 \+ var\(--hue-shift/);
    expect(body).toMatch(/--color-violet-300: oklch\([\d.]+% [\d.]+ calc\(292 \+ var\(--hue-shift/);
    expect(body).not.toContain("--color-violet-500");
  });

  // Each of these would otherwise ship quietly: a light-only color lets the base's dark value show
  // through in dark mode, and a primitive shifts every ramp (and the reduced-motion rule) at once.
  it("refuses an override that would leak or outrank the base", () => {
    expect(() =>
      withStyle({ semantic: { color: { surface: surface("oklch(99% 0 0)") } } }),
    ).toThrow(/needs one too/);
    expect(() => withStyle({ component: { card: { radius: surface("1rem", "2rem") } } })).toThrow(
      /may not give one/,
    );
    expect(() => withStyle({ primitive: { duration: { "sheet-in": { $value: "1ms" } } } })).toThrow(
      /primitive/,
    );
    expect(() => withStyle({ component: { card: { nope: { $value: "1rem" } } } })).toThrow(
      /no such token/,
    );
    expect(() => parseTokens({ ...raw, styles: { default: {} } })).toThrow(/not "default"/);
    expect(() => withStyle({ semantic: { color: { surface: "oklch(99% 0 0)" } } })).toThrow(
      /expected a token or a group/,
    );
  });
});

describe("haptic tokens", () => {
  const raw = JSON.parse(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../tokens/tokens.json"), "utf8"),
  );
  const withPattern = (name: string, value: unknown) => {
    const copy = structuredClone(raw);
    copy.primitive.haptic[name] = { $value: value };
    return parseTokens(copy);
  };

  it("fails the build for a pattern that is silent on one phone, so a token never does nothing on one of them unannounced", () => {
    expect(() =>
      hapticModule(withPattern("android-only", { android: [10], ios: { ticks: 0, gap_ms: 0 } })),
    ).toThrow(/silent on one phone/);
    expect(() =>
      hapticModule(withPattern("ios-only", { android: [], ios: { ticks: 1, gap_ms: 0 } })),
    ).toThrow(/silent on one phone/);
  });

  it("fails the build for an intent that points at nothing", () => {
    const copy = structuredClone(raw);
    copy.semantic.haptic.open.$value = "{primitive.haptic.missing}";
    expect(() => hapticModule(parseTokens(copy))).toThrow(/must name a primitive.haptic pattern/);
  });

  it("keeps haptics out of the stylesheet, which no rule reads", () => {
    expect(buildCss(loadTokens())).not.toMatch(/haptic|--tick/);
  });
});
