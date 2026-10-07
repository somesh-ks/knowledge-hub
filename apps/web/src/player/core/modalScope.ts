/**
 * What makes the open player modal. There is no focus trap: everything else in the document is
 * made `inert`, so Tab, clicks and assistive technology all stay with what is left.
 *
 * Every element this module touches is tagged with a marker attribute, and leaving finds them by
 * that marker. Nothing is remembered between the two calls, so a navigation that replaces the
 * body between them cannot leave a reference to a node that is gone, and a stale marker can always
 * be swept by a query.
 */

/** Set on each element the scope made inert, so it only ever undoes its own work. */
export const INERT_MARKER = "data-player-inert";

/** Never made inert: not rendered, or a live region that has to keep announcing. */
const LEAVE_ALONE = "script, style, template, link, meta, noscript, [aria-live]";
/**
 * A body child that holds one of these stays reachable: a live region (the player's announcer, the
 * router's), or a popover, which is how a toast gets above the player and must still be pressed.
 */
const HOLDS_SOMETHING_LIVE = "[aria-live], [popover]";

/** The slice of Element the scope uses, so a test can stand in a plain object. */
export interface ScopeElement {
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  matches(selectors: string): boolean;
  querySelector(selectors: string): unknown;
  contains(other: unknown): boolean;
  focus?(options?: { preventScroll?: boolean }): void;
}

export interface ScopeKeyEvent {
  key: string;
  defaultPrevented: boolean;
}

export interface ScopeDocument {
  body: { children: Iterable<ScopeElement> };
  activeElement: ScopeElement | null;
  querySelectorAll(selectors: string): Iterable<ScopeElement>;
  addEventListener(type: "keydown", listener: (event: ScopeKeyEvent) => void): void;
  removeEventListener(type: "keydown", listener: (event: ScopeKeyEvent) => void): void;
}

export interface ModalScope {
  /**
   * Makes the rest of the document inert, turns the page into a dialog and moves focus into it.
   * `surface` is the element that holds both the page and the bar; it is never made inert.
   */
  enter(target: { surface: ScopeElement; page: ScopeElement }, onEscape: () => void): void;
  /**
   * Gives the document back at once and returns focus to `focusTo` when focus would otherwise be
   * stranded in the page. Safe to call when the scope is not entered.
   */
  leave(target: { page: ScopeElement | null; focusTo: ScopeElement | null }): void;
  isEntered(): boolean;
}

export function createModalScope(getDocument: () => ScopeDocument): ModalScope {
  let entered = false;
  let onKeyDown: ((event: ScopeKeyEvent) => void) | null = null;

  /** Undoes every mark in the document, whoever made it and whenever. */
  function sweep(doc: ScopeDocument): void {
    for (const element of doc.querySelectorAll(`[${INERT_MARKER}]`)) {
      element.removeAttribute("inert");
      element.removeAttribute(INERT_MARKER);
    }
  }

  return {
    enter({ surface, page }, onEscape) {
      const doc = getDocument();
      // A second enter starts clean, so marks can never pile up.
      sweep(doc);
      for (const element of doc.body.children) {
        if (element.contains(surface) || element.matches(LEAVE_ALONE)) continue;
        if (element.querySelector(HOLDS_SOMETHING_LIVE) !== null) continue;
        // Already inert for someone else's reason (an open sheet): not ours to give back.
        if (element.hasAttribute("inert")) continue;
        element.setAttribute("inert", "");
        element.setAttribute(INERT_MARKER, "");
      }
      page.removeAttribute("inert");
      page.setAttribute("role", "dialog");
      page.setAttribute("aria-modal", "true");
      page.focus?.({ preventScroll: true });
      if (onKeyDown) doc.removeEventListener("keydown", onKeyDown);
      onKeyDown = (event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        // A sheet opened over the player owns its own Escape.
        const active = getDocument().activeElement;
        if (active && !surface.contains(active) && !active.matches("body")) return;
        onEscape();
      };
      doc.addEventListener("keydown", onKeyDown);
      entered = true;
    },
    leave({ page, focusTo }) {
      const doc = getDocument();
      sweep(doc);
      if (onKeyDown) doc.removeEventListener("keydown", onKeyDown);
      onKeyDown = null;
      const wasEntered = entered;
      entered = false;
      if (!page) return;
      page.removeAttribute("role");
      page.removeAttribute("aria-modal");
      if (!wasEntered) return;
      const active = doc.activeElement;
      // Focus goes back to the bar only when it would be left inside a page that is going away.
      if (!active || page.contains(active) || active.matches("body")) {
        focusTo?.focus?.({ preventScroll: true });
      }
    },
    isEntered: () => entered,
  };
}
