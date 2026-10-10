/**
 * Settings save themselves. A change waits until the controls have been still for a moment, so a
 * few quick changes go as one, then every pending edit is sent (managePageSave.ts, loaded with the
 * first change). The toast from ManageChrome says what is happening: Saving, Saved, or what went
 * wrong with a Retry. A removal waits longer, with an Undo in the toast, because it is the one change
 * that cannot be put back by changing it again. Hiding or leaving the page sends what is waiting.
 */
import type { Pending, SaveContext, SaveState } from "./managePageSave";

/** How long the controls must be still before a save. */
export const SETTLE_MS = 1200;
/** How long a removal waits, with Undo in the toast, before it is sent. */
export const UNDO_MS = 5000;
/** How long "Saved" stays before the toast goes. */
export const SAVED_MS = 4000;

export interface AutosaveOptions {
  /** What a pending removal is, for the toast that offers to undo it, or null when none is pending. */
  removing?(): string | null;
  /** Puts every pending removal back. */
  undo?(): void;
}

export interface Autosave {
  /** Something changed, or was put back: save once the controls are still. */
  changed(): void;
  /** Save what is waiting now. */
  now(): void;
}

/**
 * Wires the page's toast and the timers to `changes`. `settled` runs after each request that went
 * through: the page reads its controls again, so a change made meanwhile is still pending.
 */
export function mountAutosave(
  root: HTMLElement,
  changes: Map<string, Pending>,
  settled: () => void,
  options: AutosaveOptions = {},
): Autosave {
  const bar = root.querySelector<HTMLElement>("[data-bar]");
  const text = root.querySelector<HTMLElement>("[data-bar-text]");
  const live = root.querySelector<HTMLElement>("[data-live]");
  let still = 0;
  let linger = 0;

  /** The toast is a popover, so it sits above the bottom bar and the player like every toast. */
  const open = (shown: boolean): void => {
    if (!bar) return;
    if (typeof bar.showPopover !== "function") {
      bar.hidden = !shown;
      return;
    }
    if (shown && !bar.matches(":popover-open")) bar.showPopover();
    else if (!shown && bar.matches(":popover-open")) bar.hidePopover();
  };

  const show = (message: string, state: SaveState): void => {
    window.clearTimeout(linger);
    if (text) text.textContent = message;
    // The live region repeats it; an error is also an alert, so it is heard at once.
    if (live) live.textContent = message;
    if (bar) {
      bar.dataset.state = state;
      bar.setAttribute("role", state === "error" ? "alert" : "status");
    }
    open(true);
    if (state === "done") linger = window.setTimeout(() => open(false), SAVED_MS);
  };

  const context: SaveContext = { changes, show, dialog: root.querySelector("dialog"), settled };

  const now = (): void => {
    window.clearTimeout(still);
    if (changes.size === 0) return;
    void import("./managePageSave").then((module) => module.flush(context));
  };

  bar?.addEventListener("click", (event) => {
    const act = (event.target as Element).closest<HTMLButtonElement>("button")?.dataset.act;
    if (act === "retry") now();
    else if (act === "undo") options.undo?.();
    else if (act === "dismiss") open(false);
  });
  context.dialog?.addEventListener("click", (event) => {
    const act = (event.target as Element).closest<HTMLButtonElement>("button")?.dataset.act;
    if (act === "close") context.dialog?.close();
  });

  // Leaving or hiding the page sends what is waiting; a request on its way finishes with keepalive.
  const off = new AbortController();
  const leave = (): void => {
    if (changes.size > 0) now();
  };
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState === "hidden") leave();
    },
    { signal: off.signal },
  );
  window.addEventListener("pagehide", leave, { signal: off.signal });
  document.addEventListener("astro:before-preparation", leave, { signal: off.signal });
  document.addEventListener("astro:after-swap", () => off.abort(), { signal: off.signal });

  return {
    changed() {
      window.clearTimeout(still);
      const removal = changes.size > 0 ? (options.removing?.() ?? null) : null;
      if (removal) show(removal, "undo");
      else if (bar?.dataset.state === "undo") open(false);
      if (changes.size > 0) still = window.setTimeout(now, removal ? UNDO_MS : SETTLE_MS);
    },
    now,
  };
}
