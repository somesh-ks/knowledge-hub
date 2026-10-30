/** A component's name; `Name.part` points at one of its variants or tones, e.g. `Button.text`. */
export type ComponentName =
  | "Button"
  | "Icon button"
  | "FAB"
  | "Chip"
  | "Link"
  | "Switch"
  | "Slider"
  | "Field"
  | "Select"
  | "Menu"
  | "Banner";
export type ComponentRef = ComponentName | `${ComponentName}.${string}`;

export interface DontUse {
  /** The situation that looks like a fit and is not. */
  when: string;
  /** What to use there; absent when the answer is to change the design, not the component. */
  instead?: ComponentRef;
}

/**
 * What a design-system component, variant or tone says about itself, so that a person or an agent
 * can pick the right one without reading the stylesheet. Every one says when to use it and, naming
 * the alternative, when not to; designSystem.test.ts holds each to that.
 */
export interface Guidance {
  /** One line: what it is. */
  summary: string;
  /** Situations it is for. */
  useWhen: readonly string[];
  /** Situations that look like it and are not, each pointing at what to use instead. */
  dontUseWhen: readonly DontUse[];
}
