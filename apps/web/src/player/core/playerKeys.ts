export type KeyTarget = "panel" | "slider" | "control" | "other";

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * Where inside the expanded player a key went, for the one shortcut the player owns. There is no
 * global Space shortcut: a bare Space scrolls the page, so it toggles playback only while focus is
 * inside the open player and not on something Space already activates.
 */
export function classifyKeyTarget(target: Element | null, currentTarget: Element): KeyTarget {
  if (!target) return "other";
  if (target === currentTarget) return "panel";
  if (target.closest('[role="slider"]')) return "slider";
  if (target.closest("button, a, input, select, textarea, summary, label, [role='button']")) {
    return "control";
  }
  return "other";
}

/**
 * K toggles from anywhere in the player, as in video players. Space toggles from the panel itself
 * and from the scrubber, where it has no job of its own; on a button it keeps activating the button.
 */
export function shouldToggleOnKey(event: KeyLike, target: KeyTarget): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  if (event.key === "k" || event.key === "K") return true;
  if (event.key === " " || event.key === "Spacebar") return target !== "control";
  return false;
}

/** Roles whose own job for Space (press, toggle, pick, drag) the page-wide shortcut must not take. */
const SPACE_ROLES = [
  "button",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "link",
  "combobox",
  "textbox",
  "searchbox",
  "spinbutton",
  "listbox",
  "treeitem",
];

/** Everything Space already does: type, press, pick, open. */
export const SPACE_OWNERS = [
  "input",
  "textarea",
  "select",
  "button",
  "a",
  "summary",
  "audio",
  "video",
  "[contenteditable]:not([contenteditable='false'])",
  ...SPACE_ROLES.map((role) => `[role='${role}']`),
].join(", ");

export interface PageSpaceEvent extends KeyLike {
  repeat: boolean;
  defaultPrevented: boolean;
  isComposing?: boolean;
}

/**
 * Space anywhere on the page, once the player has something loaded: play or pause, as in a video
 * player. It steps aside for everything Space already does, for a dialog or popover other than the
 * player, for any modifier, for a held key, and for a key something else has already handled.
 */
export function shouldToggleOnPageSpace(
  event: PageSpaceEvent,
  target: Element | null,
  context: { loaded: boolean; overlayOpen: boolean },
): boolean {
  if (event.key !== " " && event.key !== "Spacebar") return false;
  if (!context.loaded || context.overlayOpen) return false;
  if (event.repeat || event.defaultPrevented || event.isComposing) return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  return !target?.closest(SPACE_OWNERS);
}
