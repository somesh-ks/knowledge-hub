/** The shape of the machine-readable design system (tokens/system.json). */

export type PartKind =
  | "action"
  | "selection"
  | "navigation"
  | "feedback"
  | "container"
  | "field"
  | "layout";

/** What an author writes for a part: the judgment. The build derives the rest from the code. */
export interface PartSource {
  id: string;
  name: string;
  kind: PartKind;
  /** One line: what it is. */
  summary: string;
  /** CSS classes that make it. The first is the root. */
  classes: string[];
  /** Components, scripts and stores that belong to it, relative to apps/web/src. */
  files?: string[];
  /** Concrete situations where this is the part. Also what a lookup matches against. */
  when: string[];
  /** Situations that look like it and are not, each with the part to use instead. */
  not?: { when: string; use: string }[];
  /** Other words someone might use for it. */
  keywords?: string[];
  /** The smallest correct markup or call. */
  markup?: string;
  /** Rules the tests do not hold. */
  rules?: string[];
}

export interface Part extends PartSource {
  /** The stylesheets (under apps/web/src/styles) that define the classes. */
  styles: string[];
  /** The comment written over the root class, which is the owner's wording of its usage. */
  usage: string;
  /** Semantic and component tokens the part's rules read. */
  tokens: string[];
  /** Source files that name one of its classes. Zero would mean a dead part. Not written to system.json: it shifts with every UI edit and would make the file stale. */
  usedIn: number;
}

export interface SystemToken {
  /** The custom property: "--color-surface-container". */
  name: string;
  tier: "primitive" | "semantic" | "component";
  type: string;
  /** What it is for, in the owner's words. */
  role?: string;
  light: string;
  dark?: string;
  /** Hex of a color in each theme. */
  hex?: { light: string; dark: string };
  /** The value under prefers-reduced-motion. */
  reducedMotion?: string;
}

export interface BespokeControl {
  class: string;
  reason: string;
  /** The part that lists this class, when one does: the class is used through that part. */
  part?: string;
}

export interface System {
  /** Where the file comes from and how to refresh it. */
  generated: string;
  parts: Part[];
  /** Controls built for one place, each allowed with the reason it is not a shared part. */
  bespoke: BespokeControl[];
  tokens: SystemToken[];
}
