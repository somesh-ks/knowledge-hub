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
  type TokenValue,
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
      // A derived state color is a color to whoever reads it.
      const kind = (type: string | undefined) =>
        type === "singularity-state-color" ? "color" : type;
      if (target) expect(kind(doc.byPath.get(target)?.type), token.dotPath).toBe(kind(token.type));
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

describe("state direction (D317)", () => {
  // A state steps toward or away from its label by what the label's contrast allows. A hand-set flag
  // per style would need a new one for every new look; the build settles it from the style's own colours.
  it("is settled by the build from the label, so no style writes a state by hand", () => {
    const raw = JSON.parse(readFileSync(resolve(ROOT, "tokens/tokens.json"), "utf8"));
    expect(JSON.stringify(raw.styles)).not.toContain('"step"');
    const expressive = doc.styles.find((style) => style.name === "expressive");
    const settled = expressive?.overrides.map((override) => override.token.dotPath) ?? [];
    expect(settled).toContain("semantic.color.accent-container-high-pressed");
  });

  it("steps a mid-tone fill away from a dark label instead of into it", () => {
    const lightness = (path: string, mode: Mode): number =>
      parseOklch(String(resolveLiteral(doc, path, mode))).l;
    const fill = lightness("semantic.color.accent-action", "dark");
    expect(lightness("semantic.color.accent-action-pressed", "dark")).toBeGreaterThan(fill);
    expect(lightness("semantic.color.accent-action-pressed", "light")).toBeLessThan(
      lightness("semantic.color.accent-action", "light"),
    );
  });
});

// The base's text, action and graphic floors are the mood sweep's (below), Default among the moods;
// these are the relations between its colours that no floor states.
describe("color contrast", () => {
  const surfaces = [
    "surface",
    "surface-sunken",
    "surface-container",
    "surface-raised",
    "surface-overlay",
  ];

  it.each(MODES)(
    "keeps the reading ink a step under the headline's on every surface (%s)",
    (mode) => {
      for (const surface of surfaces) {
        const background = colorOf(`semantic.color.${surface}`, mode);
        const reading = contrastRatio(
          colorOf("semantic.color.on-surface-reading", mode),
          background,
        );
        expect(
          contrastRatio(colorOf("semantic.color.on-surface", mode), background),
          `the headline leads its summary on ${surface} (${mode})`,
        ).toBeGreaterThan(reading * 1.2);
      }
    },
  );

  it.each(MODES)(
    "sets the action tone further from the page than the selected one (%s)",
    (mode) => {
      const page = colorOf("semantic.color.surface", mode);
      const chosen = contrastRatio(colorOf("semantic.color.accent-container", mode), page);
      expect(
        contrastRatio(colorOf("semantic.color.accent-container-high", mode), page),
        `the New episode button reads as an action, not a current place (${mode})`,
      ).toBeGreaterThan(chosen + 0.2);
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
});

interface Tree {
  $value?: unknown;
  $extensions?: unknown;
  [key: string]: unknown;
}

const TOKENS_JSON = readFileSync(resolve(ROOT, "tokens/tokens.json"), "utf8");

/** An oklch literal with the reader's hue (D315) added, as tokens.css adds it; a grey stays. */
const turn = (literal: string, shift: number): string =>
  literal.replace(
    /^oklch\(([\d.]+%?) ([\d.]+) (-?[\d.]+)(.*)\)$/,
    (_whole, l: string, c: string, h: string, rest: string) =>
      `oklch(${l} ${c} ${(Number(h) + (Number(c) === 0 ? 0 : shift)) % 360}${rest})`,
  );

/**
 * The token document as the page sees it under data-mood, at a reader's hue (D315), turned the way
 * tokens.css turns it. The mood's own values (the colours its recipe writes, D319, and the states the
 * build settled for it among them) are laid over the base with each coloured literal turned, and so is
 * every ramp step they point at: the mood's block writes that step again turned, so each use of it
 * turns too. Every other colour keeps its hue, so a status colour on a ramp the mood never names stays
 * as it is (turning every literal measured colours no page shows). Default has no slider
 * (themeApply.ts), so it is the base.
 */
function documentAt(mood: string, shift = 0): TokenDocument {
  if (mood === "default") return doc;
  const style = doc.styles.find((candidate) => candidate.name === mood);
  if (!style) throw new Error(`No mood ${mood}`);
  const base = JSON.parse(TOKENS_JSON) as Tree;
  const node = (path: string[]): Tree => path.reduce((parent, key) => parent[key] as Tree, base);
  const steps = new Set(
    style.overrides
      .flatMap(({ token, value, dark }) =>
        (dark === undefined ? [value] : [value, dark]).flatMap((written) =>
          declarationsFor(token, written, doc),
        ),
      )
      .flatMap(({ value }) =>
        [...value.matchAll(/var\((--color-[a-z]+-\d+)\)/g)].map(([, name]) => name),
      ),
  );
  for (const token of doc.tokens) {
    if (token.tier === "primitive" && steps.has(cssName(token.path))) {
      node(token.path).$value = turn(String(token.value), shift);
    }
  }
  const turned = (value: TokenValue): TokenValue =>
    typeof value === "string" ? turn(value, shift) : value;
  for (const { token, value, dark } of style.overrides) {
    const target = node(token.path);
    target.$value = turned(value);
    if (dark !== undefined) {
      const extensions = (target.$extensions ?? {}) as { singularity?: Record<string, unknown> };
      target.$extensions = {
        ...extensions,
        singularity: { ...extensions.singularity, mode: { dark: turned(dark) } },
      };
    }
  }
  return parseTokens({ ...base, styles: {} });
}

const MOODS = ["default", ...doc.styles.map((style) => style.name)];

// D268 says the contrast tests cover a style's colours; they ran on the base only until D306 added a style
// whose palette is its own. Each style gets the base's text, action and graphic floors, in both modes.
// Default is swept with them (2026-11-04), so a floor written here holds in every mood.
describe.each(MOODS)("a mood's colour contrast: %s", (name) => {
  const surfaces = [
    "surface",
    "surface-sunken",
    "surface-container",
    "surface-raised",
    "surface-overlay",
  ];

  // The reader's hue (D315) turns every coloured value of a style, so the floors must hold at each hue
  // the slider can reach, not only the one the style was designed at. Default is seen at its own hue.
  const SHIFTS = name === "default" ? [0] : Array.from({ length: 72 }, (_, i) => i * 5);
  const documents = SHIFTS.map((shift) => [shift, documentAt(name, shift)] as const);

  it.each(MODES)("holds the text, action and graphic floors (%s)", (mode) => {
    // A floor names a semantic role (`on-surface`) or, dotted, a component's colour (`player.spoken`);
    // `a over b` is a translucent fill as it is seen over the ground under it.
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
      ...["hover", "pressed"].map((state): [string, string, number] => [
        "accent",
        `accent-subtle-${state}`,
        4.5,
      ]),
      // A chosen fill carries only its own ink, so the fill is free to stand off the surface under it
      // (D356); no page's text sits on it in another colour.
      ["on-accent-container", "accent-container", 4.5],
      ["on-accent-container-high", "accent-container-high", 4.5],
      // The rail's Catch up: a shape at 3:1 on the page with no outline, its words at 4.5:1, and
      // further from the page than the current row, so it never reads as faded or as selected.
      ["on-accent-action", "accent-action", 4.5],
      ["accent-action", "surface", 3],
      ["on-accent", "accent", 4.5],
      ["on-accent", "accent-hover", 4.5],
      ["on-accent", "accent-pressed", 4.5],
      ...["hover", "pressed"].flatMap((state): [string, string, number][] => [
        ["on-accent-container", `accent-container-${state}`, 4.5],
        ["on-accent-container-high", `accent-container-high-${state}`, 4.5],
        ["on-accent-action", `accent-action-${state}`, 4.5],
        ["on-surface", `surface-${state}`, 4.5],
        ["on-surface", `surface-container-${state}`, 4.5],
        ["on-surface", `surface-raised-${state}`, 4.5],
        ["on-surface", `surface-overlay-${state}`, 4.5],
        ["on-surface-inverse", `surface-inverse-${state}`, 4.5],
      ]),
      ["on-surface-inverse", "surface-inverse", 4.5],
      ...["hover", "pressed"].map((state): [string, string, number] => [
        "accent-on-inverse",
        `surface-inverse-action-${state}`,
        4.5,
      ]),
      // The focus ring holds 3:1 on what it touches. Drawn outside a control it sits on the surface,
      // past the gap that keeps it legible against an accent button; drawn inside a row (a menu's, the
      // current story's) it sits on the row's fill, at rest or under a pointer, as a muted word does.
      ...[
        ...surfaces,
        "focus-gap",
        ...["surface", "surface-container", "surface-raised", "surface-overlay"].map(
          (surface) => `${surface}-hover`,
        ),
        "accent-container",
        "accent-container-hover",
      ].map((bg): [string, string, number] => ["focus-ring", bg, 3]),
      // Danger is also words (an error line, a Delete), so it reads as text on every surface and on
      // its tint, the danger button's hover and press. Success, warning and info are only an icon (a
      // banner's, a chip's check, the queue's ring), so they hold 3:1. A banner's words are full ink
      // on its tint and on a strip's ground; a status fill carries the surface's colour as an icon (a
      // played mark, the queue's delete).
      ...[...surfaces, "danger-subtle"].map((bg): [string, string, number] => ["danger", bg, 4.5]),
      ...["success", "warning", "info"].flatMap((tone) =>
        [...surfaces, `${tone}-subtle`].map((bg): [string, string, number] => [tone, bg, 3]),
      ),
      // A favorite's filled heart is only an icon.
      ...surfaces.map((bg): [string, string, number] => ["favorite", bg, 3]),
      // A banner comes in success, warning and danger (the info tone went with its last use, the paused notice).
      ...["success", "warning", "danger"].flatMap((tone): [string, string, number][] => [
        [tone, `banner.strip-${tone}`, 3],
        ["on-surface", `${tone}-subtle`, 4.5],
        ["on-surface", `banner.strip-${tone}`, 4.5],
      ]),
      ...["success", "danger"].map((fill): [string, string, number] => ["surface", fill, 3]),
      ...["surface", "surface-raised", "surface-sunken"].map((bg): [string, string, number] => [
        "border-control",
        bg,
        3,
      ]),
      // The open story is one card on the chosen fill (StoryList.tsx): its quieter words (the names,
      // the turns not yet said) and the word being said, on the fill it takes there. Muted words are
      // held at rest and under a pointer; a press is a moment, and no muted word is held on one.
      // Before the first story the rundown's turns sit on the page, under the spoken word's tint.
      ...["accent-container", "accent-container-hover"].map((bg): [string, string, number] => [
        "player.story-fg-muted",
        bg,
        4.5,
      ]),
      ["on-accent-container", "player.spoken-chosen over accent-container", 4.5],
      ["on-surface", "player.spoken over surface", 4.5],
    ];
    const failures = documents.flatMap(([shift, seen]) => {
      const color = (role: string): Rgb => {
        const path = role.includes(".") ? `component.${role}` : `semantic.color.${role}`;
        const literal = resolveLiteral(seen, path, mode);
        if (typeof literal !== "string") throw new Error(`${role} is not a color`);
        return oklchStringToRgb(literal);
      };
      const ground = (layers: string): Rgb =>
        layers
          .split(" over ")
          .map(color)
          .reduceRight((under, top) => composite(top, under));
      return floors.flatMap(([foreground, background, least]) => {
        const ratio = contrastRatio(color(foreground), ground(background));
        return ratio >= least
          ? []
          : [`hue +${shift}, ${foreground} on ${background}: ${ratio.toFixed(2)}, needs ${least}`];
      });
    });
    expect(failures, `${name} (${mode})`).toEqual([]);
  });
});

// A chosen tab, chip or segment was proven against the page only, so in Default light the phone's
// current-tab pill sat 3 points of lightness from the nav bar under it and read as no pill at all
// (owner, 2026-11-03). Lightness carries a fill for every eye; a hue turn (D315) keeps it, so one check
// per mood holds at every hue.
describe("a chosen fill stands off every surface it sits on (D356)", () => {
  const FILL_FLOOR = 8;
  const surfaces = [
    "surface",
    "surface-sunken",
    "surface-container",
    "surface-raised",
    "surface-overlay",
  ];
  it.each(MOODS.flatMap((name) => MODES.map((mode) => [name, mode, documentAt(name)] as const)))(
    "%s, %s",
    (_name, mode, d) => {
      const points = (role: string): number =>
        parseOklch(String(resolveLiteral(d, `semantic.color.${role}`, mode))).l * 100;
      const near = ["accent-container", "accent-container-high"].flatMap((fill) =>
        surfaces.flatMap((surface) => {
          const gap = Math.abs(points(fill) - points(surface));
          return gap >= FILL_FLOOR ? [] : [`${fill} on ${surface}: ${gap.toFixed(1)} points`];
        }),
      );
      expect(near).toEqual([]);
    },
  );
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

  it("holds the concentric radius rule where a token declares it, in every mood", () => {
    const rules = doc.tokens.flatMap((token) => {
      const rule = token.extensions.concentric;
      if (typeof rule !== "object" || rule === null) return [];
      const { inner, padding } = rule as { inner: string; padding: string };
      const innerTarget = aliasTarget(inner);
      const paddingTarget = aliasTarget(padding);
      if (!innerTarget || !paddingTarget)
        throw new Error(`Bad concentric rule on ${token.dotPath}`);
      return [[token.dotPath, innerTarget, paddingTarget] as const];
    });
    expect(rules.length).toBeGreaterThanOrEqual(4);
    // The rule was held in the base only, so a mood that resized one of the three broke it unseen: in
    // Expressive the mini player's, the toast's, the archive row's and the segmented track's corners
    // came out 4 to 8px rounder than their content's corner and padding (2026-11-04).
    // In every mood a card's words sit its padding in and its content keeps the rest of the corner:
    // Expressive once padded 32px under a 40px corner with 16px content, so its rows sat 8px further
    // in than Default's (owner, 2026-11-03: "the padding on left and right is too much").
    for (const [name, d] of MOODS.map((mood) => [mood, documentAt(mood)] as const)) {
      const rem = (reference: string): number =>
        Number.parseFloat(String(resolveLiteral(d, reference, "light")));
      for (const [outer, inner, padding] of rules) {
        expect(rem(outer), `${name}: ${outer} = inner + padding`).toBeCloseTo(
          rem(inner) + rem(padding),
          4,
        );
      }
      expect(
        rem("component.card.radius"),
        `${name}: card radius = content radius + padding`,
      ).toBeCloseTo(rem("component.card.content-radius") + rem("component.card.padding"), 4);
    }
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
      // The avatar's reactions are a character playing, not an interface answering (D326): they run past the
      // UI limit, one at a time, and never under reduced motion.
      if (name === "spin" || name.startsWith("avatar-")) continue;
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
    expect(at(':root[data-mood="bold"] {')).toBeGreaterThan(at(':root[data-theme="dark"] {'));
    expect(at(':root[data-mood="bold"] {')).toBeLessThan(at("prefers-reduced-motion"));
    expect(css).toContain(':root:not([data-theme="light"])[data-mood="bold"] {');
    expect(css).toContain(':root[data-theme="dark"][data-mood="bold"] {');
    expect(css).toContain("--card-radius: 2.5rem;");
    const dark = css.slice(at(':root[data-theme="dark"][data-mood="bold"] {'));
    const darkBody = dark.slice(0, dark.indexOf("}"));
    expect(darkBody).toContain("oklch(10% 0 0)");
    expect(darkBody).not.toContain("oklch(99% 0 0)");
  });

  // The reader's hue slider (D315) moves a style by `--hue-shift`; a colour written without it would
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
    const block = css.slice(css.indexOf(':root[data-mood="bold"] {'));
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
