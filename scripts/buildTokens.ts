/**
 * Compiles tokens/tokens.json (W3C DTCG) into apps/web/src/styles/tokens.css.
 *
 * Why a custom compiler instead of Style Dictionary: the system needs four things no stock
 * transform gives for free. Aliases stay as var() references so the three tiers remain visible in
 * DevTools. Dark values compile to both a media query and a [data-theme] override. Fluid type
 * compiles to clamp() from min and max. Reduced motion is expressed by remapping movement
 * durations, so no component needs its own media query and no !important is needed.
 *
 * Usage: npx tsx scripts/buildTokens.ts          write the CSS
 *        npx tsx scripts/buildTokens.ts --check  exit 1 when the committed CSS is stale
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { oklchStringToRgb, parseOklch, toHex } from "./colorMath.js";

export type Tier = "primitive" | "semantic" | "component";
export type Mode = "light" | "dark";

export type TokenValue = string | number | boolean | TokenValue[] | { [key: string]: TokenValue };

export interface Token {
  path: string[];
  dotPath: string;
  tier: Tier;
  type: string;
  value: TokenValue;
  dark?: TokenValue;
  reducedMotion?: string;
  description?: string;
  extensions: Record<string, unknown>;
}

/** One token a style replaces: the base token (for its type and path) and the style's values. */
export interface StyleOverride {
  token: Token;
  value: TokenValue;
  dark?: TokenValue;
}

/** A named look, a set of token overrides applied under `data-style="<name>"` (D268). */
export interface StyleDefinition {
  name: string;
  overrides: StyleOverride[];
}

export interface TokenDocument {
  tokens: Token[];
  byPath: Map<string, Token>;
  fluid: { minViewport: string; maxViewport: string };
  styles: StyleDefinition[];
}

const TIERS: readonly Tier[] = ["primitive", "semantic", "component"];
const GENERIC_FAMILIES = new Set([
  "system-ui",
  "-apple-system",
  "BlinkMacSystemFont",
  "sans-serif",
  "serif",
  "monospace",
  "ui-sans-serif",
  "ui-serif",
]);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const TOKENS_JSON_PATH = resolve(ROOT, "tokens/tokens.json");
export const TOKENS_CSS_PATH = resolve(ROOT, "apps/web/src/styles/tokens.css");
export const COVERS_JSON_PATH = resolve(ROOT, "tokens/covers.json");
export const HAPTICS_TS_PATH = resolve(ROOT, "apps/web/src/design-system/hapticTokens.ts");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTokenValue(value: unknown): value is TokenValue {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) return value.every(isTokenValue);
  if (isRecord(value)) return Object.values(value).every(isTokenValue);
  return false;
}

function singularityExtension(extensions: Record<string, unknown>): Record<string, unknown> {
  const own = extensions.singularity;
  return isRecord(own) ? own : {};
}

/** Walks the DTCG tree. `$type` inherits from the nearest group, as the spec requires. */
export function parseTokens(raw: unknown): TokenDocument {
  if (!isRecord(raw)) throw new Error("tokens.json must be an object");
  const tokens: Token[] = [];

  const visit = (node: Record<string, unknown>, path: string[], inheritedType: string): void => {
    const groupType = typeof node.$type === "string" ? node.$type : inheritedType;
    if ("$value" in node) {
      const value = node.$value;
      if (!isTokenValue(value)) throw new Error(`Invalid $value at ${path.join(".")}`);
      if (!groupType) throw new Error(`Token ${path.join(".")} has no $type`);
      const extensions = isRecord(node.$extensions) ? node.$extensions : {};
      const own = singularityExtension(extensions);
      const mode = isRecord(own.mode) ? own.mode : {};
      const dark = mode.dark;
      if (dark !== undefined && !isTokenValue(dark)) {
        throw new Error(`Invalid dark value at ${path.join(".")}`);
      }
      const tier = path[0];
      if (!TIERS.includes(tier as Tier)) throw new Error(`Unknown tier at ${path.join(".")}`);
      tokens.push({
        path,
        dotPath: path.join("."),
        tier: tier as Tier,
        type: groupType,
        value,
        ...(dark !== undefined ? { dark } : {}),
        ...(typeof own.reducedMotion === "string" ? { reducedMotion: own.reducedMotion } : {}),
        ...(typeof node.$description === "string" ? { description: node.$description } : {}),
        extensions: own,
      });
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$") || !isRecord(child)) continue;
      if (path.length === 0 && key === "styles") continue;
      visit(child, [...path, key], groupType);
    }
  };

  visit(raw, [], "");
  const byPath = new Map(tokens.map((token) => [token.dotPath, token]));
  const root = isRecord(raw.$extensions) ? singularityExtension(raw.$extensions) : {};
  const fluid = isRecord(root.fluid) ? root.fluid : {};
  return {
    tokens,
    byPath,
    styles: parseStyles(raw.styles, byPath),
    fluid: {
      minViewport: typeof fluid.minViewport === "string" ? fluid.minViewport : "20rem",
      maxViewport: typeof fluid.maxViewport === "string" ? fluid.maxViewport : "80rem",
    },
  };
}

/**
 * `styles` holds one group per style, each mirroring the token tree (`semantic.color.accent`, ...)
 * with a `$value` and, where the base token has a dark value, a `$extensions.singularity.mode.dark`.
 * The rules keep a style from leaking: it replaces existing tokens only, never a primitive (a ramp
 * would shift every color at once, and the reduced-motion rule sets primitives, which a heavier
 * style block would outrank), and it gives both modes wherever the base does, so the
 * base's dark value never shows through a light-only override.
 */
function parseStyles(raw: unknown, byPath: Map<string, Token>): StyleDefinition[] {
  if (raw === undefined) return [];
  if (!isRecord(raw)) throw new Error("styles must be an object");
  const styles: StyleDefinition[] = [];
  for (const [name, group] of Object.entries(raw)) {
    if (name.startsWith("$")) continue;
    // The same shape preferences.ts and themeInit.js accept, so a style a device can choose always loads.
    if (!/^[a-z][a-z-]{0,23}$/.test(name) || name === "default") {
      throw new Error(
        `Style name "${name}" must be lowercase kebab-case, at most 24 characters, and not "default"`,
      );
    }
    if (!isRecord(group)) throw new Error(`Style ${name} must be an object`);
    const overrides: StyleOverride[] = [];
    const visit = (node: Record<string, unknown>, path: string[]): void => {
      if ("$value" in node) {
        const dotPath = path.join(".");
        const where = `style ${name}, ${dotPath}`;
        const token = byPath.get(dotPath);
        if (!token) throw new Error(`${where}: no such token`);
        if (token.tier === "primitive")
          throw new Error(`${where}: a style may not replace a primitive`);
        const value = node.$value;
        if (!isTokenValue(value)) throw new Error(`${where}: invalid $value`);
        const extensions = isRecord(node.$extensions) ? node.$extensions : {};
        const mode = singularityExtension(extensions).mode;
        const dark = isRecord(mode) ? mode.dark : undefined;
        if (dark !== undefined && !isTokenValue(dark))
          throw new Error(`${where}: invalid dark value`);
        if ((token.dark !== undefined) !== (dark !== undefined)) {
          throw new Error(
            token.dark !== undefined
              ? `${where}: the base has a dark value, so the style needs one too`
              : `${where}: the base has no dark value, so the style may not give one`,
          );
        }
        overrides.push({ token, value, ...(dark !== undefined ? { dark } : {}) });
        return;
      }
      for (const [key, child] of Object.entries(node)) {
        if (key.startsWith("$")) continue;
        if (!isRecord(child)) {
          throw new Error(
            `style ${name}, ${[...path, key].join(".")}: expected a token or a group`,
          );
        }
        visit(child, [...path, key]);
      }
    };
    visit(group, []);
    styles.push({ name, overrides });
  }
  return styles;
}

export function loadTokens(path: string = TOKENS_JSON_PATH): TokenDocument {
  return parseTokens(JSON.parse(readFileSync(path, "utf8")));
}

const ALIAS = /^\{([^{}]+)\}$/;

export function aliasTarget(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = ALIAS.exec(value);
  return match?.[1] ?? null;
}

/** `primitive.color.fog.50` becomes `--color-fog-50`; a composite field appends its own suffix. */
export function cssName(path: string[]): string {
  return `--${path.slice(1).join("-")}`;
}

function remToNumber(value: string): number {
  const match = /^(-?[\d.]+)rem$/.exec(value);
  if (!match?.[1]) throw new Error(`Expected a rem value, got ${value}`);
  return Number(match[1]);
}

function trimNumber(value: number): string {
  return String(Number(value.toFixed(4)));
}

/** Utopia-style fluid clamp: linear between the two viewports, flat outside them. */
export function fluidClamp(
  min: string,
  max: string,
  minViewport: string,
  maxViewport: string,
): string {
  const minRem = remToNumber(min);
  const maxRem = remToNumber(max);
  const vMin = remToNumber(minViewport);
  const vMax = remToNumber(maxViewport);
  const slope = (maxRem - minRem) / (vMax - vMin);
  const intercept = minRem - slope * vMin;
  return `clamp(${min}, ${trimNumber(intercept)}rem + ${trimNumber(slope * 100)}vw, ${max})`;
}

function renderFamily(families: TokenValue[]): string {
  return families
    .map((family) => {
      const name = String(family);
      if (GENERIC_FAMILIES.has(name) || !/\s/.test(name)) return name;
      return `"${name}"`;
    })
    .join(", ");
}

function renderScalar(value: TokenValue, doc: TokenDocument): string {
  const target = aliasTarget(value);
  if (target) {
    const token = doc.byPath.get(target);
    if (!token) throw new Error(`Unknown reference {${target}}`);
    return `var(${cssName(token.path)})`;
  }
  return String(value);
}

function renderShadowLayer(layer: TokenValue, doc: TokenDocument): string {
  if (typeof layer !== "object" || layer === null || Array.isArray(layer)) {
    throw new Error("Shadow layer must be an object");
  }
  const field = (key: string): string => renderScalar(layer[key] ?? "0px", doc);
  const inset = layer.inset === true ? "inset " : "";
  const color = renderScalar(layer.color ?? "transparent", doc);
  return `${inset}${field("offsetX")} ${field("offsetY")} ${field("blur")} ${field("spread")} ${color}`;
}

const STATE_COLOR = "singularity-state-color";
const STATE_DIRECTIONS = ["darker", "lighter", "text", "inverse-text"] as const;
type StateDirection = (typeof STATE_DIRECTIONS)[number];

interface StateColor {
  from: string;
  step: "hover" | "hover-quiet" | "press";
  direction: StateDirection;
}

function stateColorOf(path: string, value: TokenValue): StateColor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path}: a state color needs {from, step, direction}`);
  }
  const { from, step, direction } = value;
  if (aliasTarget(from) === null) throw new Error(`${path}: "from" must be a {reference}`);
  if (step !== "hover" && step !== "hover-quiet" && step !== "press") {
    throw new Error(`${path}: step is hover, hover-quiet or press`);
  }
  if (typeof direction !== "string" || !STATE_DIRECTIONS.includes(direction as StateDirection)) {
    throw new Error(`${path}: direction is one of ${STATE_DIRECTIONS.join(", ")}`);
  }
  return { from: String(from), step, direction: direction as StateDirection };
}

/**
 * A state color is a fill moved in lightness only (D317): `oklch(from <fill> calc(l - step) c h)`,
 * so hue and chroma stay and no alpha or mix is involved. `darker` always lowers L and `lighter` always
 * raises it (for a mid-tone fill whose dark label would lose contrast if it deepened); `text` moves
 * toward the control's text (down in light, up in dark, by semantic.state.direction);
 * `inverse-text` is the same for a fill whose text is the other way round (the toast).
 */
function renderStateColor(path: string, value: TokenValue, doc: TokenDocument): string {
  const { from, step, direction } = stateColorOf(path, value);
  const source = renderValue("color", from, doc);
  const amount = `var(--state-step-${step})`;
  if (direction === "darker") return `oklch(from ${source} calc(l - ${amount}) c h)`;
  if (direction === "lighter") return `oklch(from ${source} calc(l + ${amount}) c h)`;
  const sign = direction === "text" ? "+" : "-";
  return `oklch(from ${source} calc(l ${sign} var(--state-direction) * ${amount}) c h)`;
}

/** The same move as a literal, for contrast tests and the system file: resolves the fill in `mode`. */
function resolveStateColor(
  doc: TokenDocument,
  path: string,
  value: TokenValue,
  mode: Mode,
): string {
  const { from, step, direction } = stateColorOf(path, value);
  const base = parseOklch(String(resolveLiteral(doc, aliasTarget(from) as string, mode)));
  const amount = Number(resolveLiteral(doc, `primitive.state.step-${step}`, mode));
  const way = Number(resolveLiteral(doc, "semantic.state.direction", mode));
  const delta =
    direction === "darker"
      ? -amount
      : direction === "lighter"
        ? amount
        : direction === "text"
          ? way * amount
          : -way * amount;
  const l = Math.min(1, Math.max(0, base.l + delta));
  const alpha = base.alpha < 1 ? ` / ${trimNumber(base.alpha)}` : "";
  return `oklch(${trimNumber(l * 100)}% ${trimNumber(base.c)} ${trimNumber(base.h)}${alpha})`;
}

/** Renders one token value as CSS. Aliases become var() so the tier chain survives in the output. */
export function renderValue(type: string, value: TokenValue, doc: TokenDocument): string {
  const target = aliasTarget(value);
  if (target) {
    const token = doc.byPath.get(target);
    if (!token) throw new Error(`Unknown reference {${target}}`);
    return `var(${cssName(token.path)})`;
  }
  switch (type) {
    case STATE_COLOR:
      return renderStateColor("state color", value, doc);
    case "color":
    case "dimension":
    case "duration":
    case "singularity-easing":
      return String(value);
    case "number":
    case "fontWeight":
      return String(value);
    case "cubicBezier": {
      if (!Array.isArray(value) || value.length !== 4)
        throw new Error("cubicBezier needs 4 numbers");
      return `cubic-bezier(${value.map(String).join(", ")})`;
    }
    case "fontFamily": {
      if (!Array.isArray(value)) throw new Error("fontFamily needs an array");
      return renderFamily(value);
    }
    case "shadow": {
      const layers = Array.isArray(value) ? value : [value];
      return layers.map((layer) => renderShadowLayer(layer, doc)).join(",\n    ");
    }
    case "singularity-fluid-dimension": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("fluid dimension needs {min, max}");
      }
      return fluidClamp(
        String(value.min),
        String(value.max),
        doc.fluid.minViewport,
        doc.fluid.maxViewport,
      );
    }
    default:
      throw new Error(`Cannot render $type ${type}`);
  }
}

const TYPOGRAPHY_FIELDS: ReadonlyArray<[string, string, string]> = [
  ["fontFamily", "family", "fontFamily"],
  ["fontSize", "size", "dimension"],
  ["fontWeight", "weight", "fontWeight"],
  ["letterSpacing", "tracking", "dimension"],
  ["lineHeight", "leading", "number"],
];

interface Declaration {
  name: string;
  value: string;
}

/** A token becomes one declaration, except typography composites, which become five. */
export function declarationsFor(
  token: Token,
  value: TokenValue,
  doc: TokenDocument,
): Declaration[] {
  const base = cssName(token.path);
  // A haptic is read by script, never by a stylesheet (hapticModule writes it out).
  if (token.type === HAPTIC_TYPE) return [];
  if (token.type === "typography") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Typography ${token.dotPath} needs an object`);
    }
    return TYPOGRAPHY_FIELDS.map(([field, suffix, fieldType]) => {
      const fieldValue = value[field];
      if (fieldValue === undefined) throw new Error(`Typography ${token.dotPath} lacks ${field}`);
      return { name: `${base}-${suffix}`, value: renderValue(fieldType, fieldValue, doc) };
    });
  }
  return [{ name: base, value: renderValue(token.type, value, doc) }];
}

function formatDeclaration(declaration: Declaration): string {
  return `  ${declaration.name}: ${declaration.value};`;
}

/** Follows aliases to a literal, preferring dark overrides when mode is dark. */
export function resolveLiteral(doc: TokenDocument, dotPath: string, mode: Mode): TokenValue {
  let current = dotPath;
  for (let depth = 0; depth < 16; depth += 1) {
    const token = doc.byPath.get(current);
    if (!token) throw new Error(`Unknown reference {${current}}`);
    const value = mode === "dark" && token.dark !== undefined ? token.dark : token.value;
    const target = aliasTarget(value);
    if (!target && token.type === STATE_COLOR) {
      return resolveStateColor(doc, token.dotPath, value, mode);
    }
    if (!target) return value;
    current = target;
  }
  throw new Error(`Reference cycle at ${dotPath}`);
}

const HEADER = `/* biome-ignore-all format: generated file, formatted by scripts/buildTokens.ts */
/*
 * GENERATED FILE. Do not edit.
 * Source: tokens/tokens.json. Build: npx tsx scripts/buildTokens.ts
 *
 * Tiers: primitive (raw scales), semantic (roles; the only color layer components may read),
 * component (sizes and bindings). Dark values apply under prefers-color-scheme: dark unless
 * data-theme="light" is set, and always under data-theme="dark".
 */
`;

function blockFor(
  tokens: Token[],
  pick: (token: Token) => TokenValue | undefined,
  doc: TokenDocument,
): string[] {
  const lines: string[] = [];
  for (const token of tokens) {
    const value = pick(token);
    if (value === undefined) continue;
    for (const declaration of declarationsFor(token, value, doc)) {
      lines.push(formatDeclaration(declaration));
    }
  }
  return lines;
}

function lowerIndent(lines: string[]): string[] {
  return lines.map((line) => `  ${line}`);
}

const OKLCH_LITERAL = /oklch\(([\d.]+%?) ([\d.]+) (-?[\d.]+)( \/ [\d.]+%?)?\)/g;

/**
 * A reader's hue (`--hue-shift`, degrees, set on the root; D315) turns a style's whole palette: every
 * coloured oklch literal a style writes gets the shift added to its hue. A grey (chroma 0) stays.
 * With no shift the sum is the hue as written, so a style looks as designed until the reader moves it.
 */
function turnHue(value: string): string {
  return value.replace(OKLCH_LITERAL, (whole, l: string, c: string, h: string, alpha = "") =>
    Number(c) === 0 ? whole : `oklch(${l} ${c} calc(${h} + var(--hue-shift, 0))${alpha})`,
  );
}

/**
 * A style that points at a coloured step of a primitive ramp (`var(--color-violet-600)`) keeps the
 * reference; the step itself is written again under the style with the shift on its hue, so every
 * use of the ramp in that style turns with the reader's hue. A ramp step has one value in both themes.
 */
function turnedRamps(lines: string[], doc: TokenDocument): string[] {
  const used = new Set<string>();
  for (const line of lines) {
    for (const match of line.matchAll(/var\((--color-[a-z]+-\d+)\)/g)) used.add(match[1] as string);
  }
  const out: string[] = [];
  for (const name of [...used].sort((a, b) => a.localeCompare(b, "en", { numeric: true }))) {
    const token = doc.tokens.find((t) => t.tier === "primitive" && cssName(t.path) === name);
    if (!token) continue;
    const [declaration] = declarationsFor(token, token.value, doc);
    const turned = declaration ? turnHue(declaration.value) : "";
    if (!declaration || turned === declaration.value) continue;
    if (token.dark !== undefined) {
      throw new Error(`${token.dotPath}: a primitive with a dark value cannot turn with a hue`);
    }
    out.push(formatDeclaration({ name, value: turned }));
  }
  return out;
}

/**
 * A style's blocks follow the base's, so at equal weight the style wins. The light block is one
 * attribute heavier than the base's light block; the two dark blocks are heavier than the base's
 * dark blocks, and a style gives dark values only for tokens that have them in the base.
 */
function styleBlocks(style: StyleDefinition, doc: TokenDocument): string[] {
  const lines = (pick: (override: StyleOverride) => TokenValue | undefined): string[] => {
    const out: string[] = [];
    for (const override of style.overrides) {
      const value = pick(override);
      if (value === undefined) continue;
      for (const declaration of declarationsFor(override.token, value, doc)) {
        out.push(formatDeclaration({ ...declaration, value: turnHue(declaration.value) }));
      }
    }
    return out;
  };
  const light = lines((override) => override.value);
  const dark = lines((override) => override.dark);
  const attr = `[data-style="${style.name}"]`;
  const ramps = turnedRamps([...light, ...dark], doc);
  const out = [`/* Style: ${style.name} */`, `:root${attr} {`, ...light, ...ramps, "}", ""];
  if (dark.length > 0) {
    out.push("@media (prefers-color-scheme: dark) {");
    out.push(`  :root:not([data-theme="light"])${attr} {`);
    out.push(...lowerIndent(dark));
    out.push("  }");
    out.push("}");
    out.push("");
    out.push(`:root[data-theme="dark"]${attr} {`);
    out.push(...dark);
    out.push("}");
    out.push("");
  }
  return out;
}

type CoverNode = { $value: unknown };
type CoverRuleJson = Record<string, CoverNode | Record<string, CoverNode>>;

const coverValue = (node: unknown, where: string): unknown => {
  if (typeof node !== "object" || node === null || !("$value" in node)) {
    throw new Error(`tokens/covers.json: style.${where} needs a $value`);
  }
  return (node as CoverNode).$value;
};

/**
 * How each style redraws an album cover (D314), as custom properties under the style's attribute.
 * A cover is a vector whose colours are CSS math over the month's base colours (cover.css), so a
 * style is only these numbers: a new style in `tokens/covers.json` needs no cover files, and a reader's
 * hue (`--hue-shift`) moves the one anchor, `--cover-hue`. The numbers are the rule's, read here so
 * the page and `packages/cover` (which holds the same formula for contrast tests) never part.
 */
export function coverStyleBlocks(
  raw: unknown = JSON.parse(readFileSync(COVERS_JSON_PATH, "utf8")),
): string[] {
  const rules = (raw as { style?: Record<string, unknown> }).style ?? {};
  const out: string[] = [
    "/* Album art per style (D314, tokens/covers.json): numbers for the cover math in cover.css. */",
  ];
  for (const [id, body] of Object.entries(rules)) {
    if (id.startsWith("$")) continue;
    const rule = body as CoverRuleJson;
    const num = (node: unknown, where: string): number => {
      const value = coverValue(node, `${id}.${where}`);
      if (typeof value !== "number")
        throw new Error(`tokens/covers.json: style.${id}.${where} must be a number`);
      return value;
    };
    const chroma = rule.chroma as Record<string, CoverNode>;
    const flip = rule.flip as Record<string, CoverNode> | undefined;
    const night = rule.night as Record<string, CoverNode> | undefined;
    const band = (mode: "light" | "dark"): [number, number] => {
      const value = flip ? coverValue(flip[mode], `${id}.flip.${mode}`) : [0, 1];
      if (!Array.isArray(value) || value.length !== 2) {
        throw new Error(`tokens/covers.json: style.${id}.flip.${mode} must be [low, high]`);
      }
      return [Number(value[0]), Number(value[1])];
    };
    const [lowLight, highLight] = band("light");
    const [lowDark, highDark] = band("dark");
    const lines = [
      `--cover-hue: ${num(rule.hue, "hue")};`,
      `--cover-keep: ${num(rule.keep, "keep")};`,
      `--cover-spread: ${num(rule.spread, "spread")};`,
      `--cover-cap: ${num(rule.cap, "cap")};`,
      `--cover-c-scale: ${num(chroma.scale, "chroma.scale")};`,
      `--cover-c-add: ${num(chroma.add, "chroma.add")};`,
      `--cover-c-max: ${num(chroma.max, "chroma.max")};`,
      `--cover-c-floor-below: ${num(chroma["floor-below"], "chroma.floor-below")};`,
      `--cover-c-floor: ${num(chroma.floor, "chroma.floor")};`,
      `--cover-flip: ${flip ? 1 : 0};`,
      `--cover-night-below: ${night ? num(night.below, "night.below") : 0};`,
      `--cover-night-hue: ${night ? num(night.hue, "night.hue") : 0};`,
      `--cover-night-c: ${night ? num(night.chroma, "night.chroma") : 0};`,
    ];
    const attr = `[data-style="${id}"]`;
    out.push(
      `:root${attr} {`,
      ...lowerIndent(lines),
      `  --cover-lo: ${lowLight};`,
      `  --cover-hi: ${highLight};`,
      "}",
      "",
    );
    if (flip) {
      const dark = [`--cover-lo: ${lowDark};`, `--cover-hi: ${highDark};`];
      out.push(
        "@media (prefers-color-scheme: dark) {",
        `  :root:not([data-theme="light"])${attr} {`,
      );
      out.push(...dark.map((line) => `    ${line}`), "  }", "}", "");
      out.push(`:root[data-theme="dark"]${attr} {`, ...lowerIndent(dark), "}", "");
    }
  }
  return out;
}

export function buildCss(doc: TokenDocument): string {
  const out: string[] = [HEADER];
  const sections: Array<[Tier, string]> = [
    ["primitive", "Primitive tokens"],
    ["semantic", "Semantic tokens, light"],
    ["component", "Component tokens"],
  ];

  out.push(":root {");
  for (const [tier, title] of sections) {
    const tierTokens = doc.tokens.filter((token) => token.tier === tier);
    out.push(`  /* ${title} */`);
    out.push(...blockFor(tierTokens, (token) => token.value, doc));
    out.push("");
  }
  out.push("  color-scheme: light;");
  out.push("}");
  out.push("");

  const darkTokens = doc.tokens.filter((token) => token.dark !== undefined);
  const darkLines = blockFor(darkTokens, (token) => token.dark, doc);
  out.push("@media (prefers-color-scheme: dark) {");
  out.push('  :root:not([data-theme="light"]) {');
  out.push(...lowerIndent(darkLines));
  out.push("    color-scheme: dark;");
  out.push("  }");
  out.push("}");
  out.push("");
  out.push(':root[data-theme="dark"] {');
  out.push(...darkLines);
  out.push("  color-scheme: dark;");
  out.push("}");
  out.push("");

  for (const style of doc.styles) out.push(...styleBlocks(style, doc));
  out.push(...coverStyleBlocks());

  const reduced = doc.tokens.filter((token) => token.reducedMotion !== undefined);
  out.push(
    "/* Reduced motion: movement durations collapse, fades and color changes keep their timing. */",
  );
  out.push("@media (prefers-reduced-motion: reduce) {");
  out.push("  :root {");
  for (const token of reduced) {
    out.push(`    ${cssName(token.path)}: ${token.reducedMotion};`);
  }
  out.push("  }");
  out.push("}");
  out.push("");

  out.push("/*");
  out.push(
    " * Derived sRGB values for places that cannot take OKLCH (theme-color meta, web manifest).",
  );
  for (const [label, dotPath] of DERIVED) {
    const light = hexFor(doc, dotPath, "light");
    const dark = hexFor(doc, dotPath, "dark");
    out.push(` * ${label}: light ${light}, dark ${dark}`);
  }
  out.push(" */");
  out.push("");
  return out.join("\n");
}

const DERIVED: ReadonlyArray<[string, string]> = [
  ["theme-color and manifest background (surface)", "semantic.color.surface"],
  ["accent", "semantic.color.accent"],
  ["on-surface", "semantic.color.on-surface"],
];

export function hexFor(doc: TokenDocument, dotPath: string, mode: Mode): string {
  const literal = resolveLiteral(doc, dotPath, mode);
  if (typeof literal !== "string") throw new Error(`${dotPath} is not a color`);
  return toHex(oklchStringToRgb(literal));
}

const HAPTIC_TYPE = "singularity-haptic";
/** What a phone's motor can be asked for in one pattern, in ms: a longer one is a notification, not a touch. */
const HAPTIC_MAX_MS = 250;

/**
 * The haptic tokens as a TypeScript module: the patterns, and the intents that point at them. A
 * pattern must give both phones something or neither, so a token never does nothing on one of them
 * without saying so (`none` is the one pattern with no beats), and an intent must name a pattern.
 */
export function hapticModule(doc: TokenDocument): string {
  const patterns: string[] = [];
  const beats = new Map<string, number>();
  for (const token of doc.tokens) {
    if (token.type !== HAPTIC_TYPE || token.tier !== "primitive") continue;
    const name = token.path[token.path.length - 1] as string;
    const value = token.value;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Haptic ${token.dotPath} needs {android, ios}`);
    }
    const android = value.android;
    const ios = value.ios;
    if (!Array.isArray(android) || !android.every((n) => typeof n === "number" && n >= 0)) {
      throw new Error(`Haptic ${token.dotPath} needs an android array of milliseconds`);
    }
    if (typeof ios !== "object" || ios === null || Array.isArray(ios)) {
      throw new Error(`Haptic ${token.dotPath} needs an ios {ticks, gap_ms}`);
    }
    const ticks = ios.ticks;
    const gap = ios.gap_ms;
    if (!Number.isInteger(ticks) || typeof ticks !== "number" || ticks < 0) {
      throw new Error(`Haptic ${token.dotPath} needs ios.ticks, a whole number`);
    }
    if (typeof gap !== "number" || gap < 0 || (ticks > 1 && gap === 0)) {
      throw new Error(`Haptic ${token.dotPath} needs ios.gap_ms above 0 for more than one tick`);
    }
    if ((android.length === 0) !== (ticks === 0)) {
      throw new Error(`Haptic ${token.dotPath} is silent on one phone and not the other`);
    }
    let total = 0;
    for (const n of android) total += n as number;
    if (total > HAPTIC_MAX_MS) {
      throw new Error(`Haptic ${token.dotPath} runs past ${HAPTIC_MAX_MS} ms`);
    }
    beats.set(name, ticks);
    patterns.push(
      `  ${JSON.stringify(name)}: { android: [${android.join(", ")}], ios: { ticks: ${ticks}, gap_ms: ${gap} } },`,
    );
  }
  const intents: string[] = [];
  for (const token of doc.tokens) {
    if (token.type !== HAPTIC_TYPE || token.tier !== "semantic") continue;
    const target = aliasTarget(token.value);
    const pattern = target?.startsWith("primitive.haptic.") ? target.slice(17) : undefined;
    if (!pattern || !beats.has(pattern)) {
      throw new Error(`Haptic intent ${token.dotPath} must name a primitive.haptic pattern`);
    }
    intents.push(
      `  ${JSON.stringify(token.path[token.path.length - 1])}: ${JSON.stringify(pattern)},`,
    );
  }
  return [
    "/* biome-ignore-all format: generated file, formatted by scripts/buildTokens.ts */",
    "/*",
    " * GENERATED FILE. Do not edit.",
    " * Source: tokens/tokens.json (primitive.haptic, semantic.haptic). Build: npx tsx scripts/buildTokens.ts",
    " * Android plays `android` through navigator.vibrate; iPhone plays `ios.ticks` ticks, `ios.gap_ms` apart.",
    " */",
    "",
    "export const HAPTIC_PATTERNS = {",
    ...patterns,
    "} as const;",
    "",
    "export type HapticPattern = keyof typeof HAPTIC_PATTERNS;",
    "",
    "/** What a control asks for. A call site names one of these and never a pattern. */",
    "export const HAPTIC_INTENTS = {",
    ...intents,
    "} as const satisfies Record<string, HapticPattern>;",
    "",
    "export type HapticIntent = keyof typeof HAPTIC_INTENTS;",
    "",
  ].join("\n");
}

export function buildTokensCss(): string {
  return buildCss(loadTokens());
}

function main(): void {
  const css = buildTokensCss();
  const haptics = hapticModule(loadTokens());
  const outputs: ReadonlyArray<[string, string]> = [
    [TOKENS_CSS_PATH, css],
    [HAPTICS_TS_PATH, haptics],
  ];
  if (process.argv.includes("--check")) {
    for (const [path, text] of outputs) {
      const current = existsSync(path) ? readFileSync(path, "utf8") : "";
      if (current !== text) {
        console.error(`${path} is stale. Run: npx tsx scripts/buildTokens.ts`);
        process.exit(1);
      }
    }
    console.log("tokens.css and hapticTokens.ts are up to date");
    return;
  }
  for (const [path, text] of outputs) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
    console.log(`Wrote ${path}`);
  }
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
