/**
 * A control marked aria-disabled stays focusable so its reason can be read, which also means the
 * browser still delivers its clicks. This guard stops them in the capture phase, before any
 * delegated handler (the player's play hooks, for one) can act on a disabled control.
 */
export function installDisabledGuard(): void {
  document.addEventListener(
    "click",
    (event) => {
      if (event.target instanceof Element && event.target.closest('[aria-disabled="true"]')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { capture: true },
  );
}
