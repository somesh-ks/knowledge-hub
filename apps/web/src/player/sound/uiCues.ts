/**
 * Which interface sound a click or choice makes, decided by the KIND of action and never per
 * element. Pure functions over a plain description of the control, so a test needs no DOM.
 *
 * The map, quiet and few:
 * - navigate: moving between destinations (nav items, section tabs, Contents entries, story rows)
 *   is one very soft tick.
 * - select: chips, switches, checkboxes, radios, menu choices and the sort order are a soft tick,
 *   brighter for on than for off.
 * - open and close: a menu, a sheet or a dialog is a soft pair, the close lower than the open.
 * - tap: any other action button (Save, Delete, Skip, a toast's action) is a softer tick than
 *   navigate; its outcome, when the screen states one, adds success or failure on top.
 * - transport, success and failure keep the cues they already had (player events, Generate).
 *
 * Nothing sounds for hover, focus, scroll, typing or scrubbing. `data-sound="none"` opts a control out.
 */
import type { SoundName } from "@singularity/sound";
import type { Cue } from "./soundMap";

export type SoundKind = "navigate" | "select" | "open" | "close" | "tap" | "none";

export const SOUND_KINDS: readonly SoundKind[] = [
  "navigate",
  "select",
  "open",
  "close",
  "tap",
  "none",
];

/** A plain description of the control that was activated; the DOM reader fills it in. */
export interface ControlInfo {
  tag: string;
  role: string | null;
  inputType: string | null;
  /** The explicit `data-sound` value, when there is one. */
  dataSound: string | null;
  /** The state after the click: `aria-checked`, `aria-pressed`, `aria-selected` or `checked`. */
  on: boolean | null;
  /** `aria-expanded` after the click, or the opposite of a popover's state before it. */
  expanded: boolean | null;
  /** A story chip or row: it moves the player to another item. */
  playsItem: boolean;
  /** Closes a dialog (Cancel, the close button). */
  closesDialog: boolean;
  disabled: boolean;
}

const SELECT_ROLES = new Set([
  "switch",
  "checkbox",
  "radio",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
]);

const BUTTON_INPUTS = new Set(["button", "submit", "reset", "image"]);

export function isSoundKind(value: string | null): value is SoundKind {
  return value !== null && (SOUND_KINDS as readonly string[]).includes(value);
}

/** The default kind by role, or `none`. An explicit `data-sound` always wins. */
export function kindFor(info: ControlInfo): SoundKind {
  if (info.disabled) return "none";
  if (isSoundKind(info.dataSound)) return info.dataSound;
  if (info.role === "tab" || info.playsItem) return "navigate";
  if (info.tag === "a" || info.role === "link") return "navigate";
  if (info.expanded !== null) return info.expanded ? "open" : "close";
  if (info.closesDialog) return "close";
  if (info.role && SELECT_ROLES.has(info.role)) return "select";
  if (info.tag === "select") return "select";
  if (info.tag === "input" && (info.inputType === "checkbox" || info.inputType === "radio")) {
    return "select";
  }
  // A button that holds a state (a filter chip, a pin) is a toggle.
  if (info.on !== null) return "select";
  // Any other press is an action: a text field, a slider or a bare container stays silent.
  if (info.tag === "button" || info.role === "button" || info.role === "menuitem") return "tap";
  if (info.tag === "input" && BUTTON_INPUTS.has(info.inputType ?? "")) return "tap";
  return "none";
}

/** The one tick for moving somewhere: the scrub tick at a fixed, mid-ladder pitch, a touch softer. */
const NAVIGATE_CUE: Cue = { name: "scrubDetent", options: { position: 0.4, gain: 0.8 } };

/** An action button: the same tick again, higher and softer, so it never reads as a destination. */
const TAP_CUE: Cue = { name: "scrubDetent", options: { position: 0.7, gain: 0.55 } };

export function cueForKind(kind: SoundKind, on: boolean | null = true): Cue | null {
  switch (kind) {
    case "navigate":
      return NAVIGATE_CUE;
    case "tap":
      return TAP_CUE;
    case "select":
      return { name: (on === false ? "toggleOff" : "toggleOn") satisfies SoundName };
    case "open":
      return { name: "sheetOpen" };
    case "close":
      return { name: "sheetClose" };
    case "none":
      return null;
  }
}

/** Saved or copied sounds like a finished Generate run; a refusal like a failed one. */
export function cueForOutcome(kind: "success" | "failure"): Cue {
  return { name: kind === "success" ? "generateDone" : "error" };
}

/** Keeps a burst of taps from stacking: a cue inside the gap after the last one is dropped. */
export function createRateLimit(minGapMs: number): (now: number) => boolean {
  let last = Number.NEGATIVE_INFINITY;
  return (now) => {
    if (now - last < minGapMs) return false;
    last = now;
    return true;
  };
}
