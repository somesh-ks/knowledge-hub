/**
 * The shape of a component spec (D220). Each shared part of the design system has one `*.design.ts`
 * beside it in apps/web; the style guide (apps/design, news.someshks.work/design) draws its page,
 * its card and its live state controls from the spec, and `designSpecs.test.ts` fails when a shared
 * class has none.
 *
 * A spec is plain data and a `render` that returns markup as a string, written with the shared
 * classes and nothing else, so one spec runs at build time (the page), in the browser (the state
 * controls re-render it) and in a unit test (the coverage check). The markup must follow the
 * component the app ships; when the component changes, its spec changes in the same PR.
 */
import { ICON_PATHS, ICON_VIEW_BOX, type IconName } from "./icons";

export type DesignLevel = "atom" | "molecule" | "organism";

/** The groups the style guide files a component under, in the order it lists them. */
export const DESIGN_CATEGORIES = [
  "Actions",
  "Inputs",
  "Navigation",
  "Lists",
  "Feedback",
  "Overlays",
] as const;
export type DesignCategory = (typeof DESIGN_CATEGORIES)[number];

export const DESIGN_LEVELS: readonly DesignLevel[] = ["atom", "molecule", "organism"];

export type DesignValue = string | boolean;
/** The current value of each control, by control id. */
export type DesignState = Record<string, DesignValue>;

interface ControlBase {
  /** The key `render` reads from the state. */
  id: string;
  label: string;
  /** The heading it sits under on the page, and the gallery row it makes: "Variant", "State", "Content". */
  group: string;
}

export interface ChoiceControl extends ControlBase {
  kind: "choice";
  options: readonly { value: string; label: string }[];
  value: string;
}
export interface ToggleControl extends ControlBase {
  kind: "toggle";
  value: boolean;
}
export interface TextControl extends ControlBase {
  kind: "text";
  value: string;
  /** Characters allowed, so a sample cannot outgrow its frame. */
  max?: number;
}
export type DesignControl = ChoiceControl | ToggleControl | TextControl;

/**
 * How the component sits in its frame: side by side at their own size ("row"), one per row at the
 * frame's full width ("stack"), or one per row in a column as wide as the part has where the app
 * puts it: a card's column ("narrow", 20rem) or a dialog ("wide", 28rem).
 */
export type DesignFrame = "row" | "stack" | "narrow" | "wide";

export interface DesignUsage {
  sheet: string;
  selector: string;
}

export interface DesignSpec {
  /** The page address under /design/components: lowercase kebab-case, unique. */
  id: string;
  title: string;
  level: DesignLevel;
  category: DesignCategory;
  /** One line for the card and the page head: what it is for. */
  summary: string;
  /**
   * Where the usage comment lives: the stylesheet in apps/web/src/styles and the selector whose
   * comment describes the component. The page prints it, so the words stay beside the rules.
   */
  usage?: DesignUsage | readonly DesignUsage[];
  /** Every shared class the spec draws, without the dot; the coverage test reads these. */
  classes: readonly string[];
  /** The decisions behind it ("D186"); shown on the page, no links. */
  decisions?: readonly string[];
  /** Short rules for its use: what it is for and what it is not. */
  guidance?: readonly string[];
  controls: readonly DesignControl[];
  /** The markup for a state, written with the shared classes only. */
  render: (state: DesignState) => string;
  /**
   * States the card steps through while it is hovered or focused, each merged over the defaults.
   * Left out, the style guide steps through the first choice control's options, or flips the first toggle.
   */
  demo?: readonly Partial<DesignState>[];
  frame?: DesignFrame;
}

export const defineSpec = (spec: DesignSpec): DesignSpec => spec;

/** The state a control set starts in. */
export const defaultState = (controls: readonly DesignControl[]): DesignState =>
  Object.fromEntries(controls.map((control) => [control.id, control.value]));

/**
 * What a card's thumbnail steps through while hovered, in order, looping; it settles back on the
 * defaults when the pointer leaves. A choice steps through its options starting after the default,
 * a toggle flips and flips back.
 */
export function demoStates(spec: DesignSpec): DesignState[] {
  const base = defaultState(spec.controls);
  if (spec.demo?.length) return spec.demo.map((step) => ({ ...base, ...step }) as DesignState);
  const choice = spec.controls.find((control) => control.kind === "choice");
  if (choice?.kind === "choice") {
    const at = Math.max(
      0,
      choice.options.findIndex((option) => option.value === choice.value),
    );
    const rotated = [...choice.options.slice(at + 1), ...choice.options.slice(0, at + 1)];
    return rotated.map((option) => ({ ...base, [choice.id]: option.value }));
  }
  const toggle = spec.controls.find((control) => control.kind === "toggle");
  if (toggle) return [{ ...base, [toggle.id]: !toggle.value }, base];
  return [base];
}

/** Escapes text for markup written in a template. */
export const esc = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** An icon as Icon.astro draws it, for a spec's markup. */
export const icon = (name: IconName, className = ""): string =>
  `<svg class="icon${className ? ` ${className}` : ""}" data-icon="${name}" viewBox="${ICON_VIEW_BOX}" aria-hidden="true" focusable="false"><path d="${ICON_PATHS[name]}"></path></svg>`;

/** A boolean attribute: present or absent. */
export const attr = (name: string, on: unknown): string => (on ? ` ${name}` : "");

/** A state value read as the string a choice holds. */
export const str = (value: DesignValue | undefined, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

/** A state value read as a toggle. */
export const on = (value: DesignValue | undefined): boolean => value === true;

/** Every spec in apps/web, in the order the style guide lists them: level, category, then title. */
export function sortSpecs(specs: readonly DesignSpec[]): DesignSpec[] {
  const categoryRank = (spec: DesignSpec) => DESIGN_CATEGORIES.indexOf(spec.category);
  const levelRank = (spec: DesignSpec) => DESIGN_LEVELS.indexOf(spec.level);
  return [...specs].sort(
    (a, b) =>
      levelRank(a) - levelRank(b) ||
      categoryRank(a) - categoryRank(b) ||
      a.title.localeCompare(b.title),
  );
}
