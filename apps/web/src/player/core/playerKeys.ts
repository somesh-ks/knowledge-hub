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
