/**
 * Remembers which fields the reader typed in, from the first moment of the page: an automatic
 * reload for a new deploy (serviceWorker.ts) must not throw that text away, and its update check
 * starts only after load. Trusted input events only, so a field the page filled in by script
 * (a restored filter) never counts as the reader's.
 */

const typedIn = new WeakSet<EventTarget>();

export function trackTyping(): void {
  document.addEventListener(
    "input",
    (event) => {
      if (event.isTrusted && event.target) typedIn.add(event.target);
    },
    { capture: true, passive: true },
  );
}

/** True when the reader typed in this field. */
export function wasTypedIn(target: EventTarget): boolean {
  return typedIn.has(target);
}
