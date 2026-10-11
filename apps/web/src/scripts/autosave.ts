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
/** The air kept between the control just changed and the toast over the page. */
const CLEAR_PX = 12;

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
  const alert = root.querySelector<HTMLElement>("[data-alert]");
  let still = 0;
  let linger = 0;
  const controlOf = (target: EventTarget | null): Element | null => {
    const control = (target as Element | null)?.closest?.("input, select, textarea, button");
    return control && root.contains(control) && !bar?.contains(control) ? control : null;
  };
  /**
   * The control the owner last used, which the toast must not cover. It starts as the control that
   * has focus: a page can mount this during that control's first event (topicsPage.ts loads its
   * editor then), which has already passed the listeners below.
   */
  let touched: Element | null = controlOf(document.activeElement);
  const touch = (event: Event): void => {
    touched = controlOf(event.target) ?? touched;
  };
  root.addEventListener("change", touch);
  root.addEventListener("click", touch);

  /**
   * A button in the toast that is about to go (the toast hides, or its state hides the button) hands
   * focus to the control the toast is about, or to the page when that is gone, so the next Tab does
   * not start again from the top of the document.
   */
  const handBack = (): void => {
    if (!bar?.contains(document.activeElement)) return;
    if (touched instanceof HTMLElement && touched.isConnected) touched.focus();
    if (bar.contains(document.activeElement))
      document.querySelector<HTMLElement>("main")?.focus({ preventScroll: true });
  };

  /** The toast is a popover, so it sits above the bottom bar and the player like every toast. */
  const open = (shown: boolean): void => {
    if (!bar) return;
    if (!shown) handBack();
    if (typeof bar.showPopover !== "function") {
      bar.hidden = !shown;
      return;
    }
    if (shown && !bar.matches(":popover-open")) bar.showPopover();
    else if (!shown && bar.matches(":popover-open")) bar.hidePopover();
  };

  /**
   * The toast floats over the bottom of the page, where the control just changed may be. If it
   * lands on it, the page moves up by the overlap; manage.css keeps room under the last control
   * while the toast shows. A control in a dialog is above the page and needs nothing.
   */
  const reveal = (): void => {
    if (!bar?.matches(":popover-open") || !touched?.isConnected || touched.closest("dialog"))
      return;
    // Where the toast rests: its offset box, without the slide it enters with.
    const top =
      window.innerHeight - Number.parseFloat(getComputedStyle(bar).bottom) - bar.offsetHeight;
    const overlap = touched.getBoundingClientRect().bottom + CLEAR_PX - top;
    if (overlap <= 0) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollBy({ top: overlap, behavior: reduce ? "instant" : "smooth" });
  };

  const show = (message: string, state: SaveState): void => {
    window.clearTimeout(linger);
    if (text) text.textContent = message;
    // One live region speaks it, and an error is an alert, so it is heard at once. The toast itself
    // has no role: two regions would say the same words twice.
    if (live) live.textContent = state === "error" ? "" : message;
    if (alert) alert.textContent = state === "error" ? message : "";
    if (bar) bar.dataset.state = state;
    open(true);
    reveal();
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
    // Each one takes its own button away: Retry shows Saving, which has none.
    if (act) handBack();
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
