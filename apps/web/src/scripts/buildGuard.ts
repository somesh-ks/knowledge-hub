/**
 * An in-app move swaps in the next page while this bundle keeps running (REL-12). When the next page
 * came from another deploy than the bundle, the new markup meets old scripts and old in-memory state,
 * so the move is made as a full load instead. The usual update check (serviceWorker.ts) catches a
 * deploy a minute later; this closes the gap between a deploy and that check. A full load stops the
 * audio, so while narration plays or buffers the move swaps in as before and the update check loads
 * the new deploy at the first moment nothing is playing (the worker module stays out of the first load).
 */

/** Whether a page named `incoming` must not be swapped under a bundle that loaded with `running`. */
export function isOtherBuild(running: string | undefined, incoming: string | null | undefined) {
  return Boolean(running) && Boolean(incoming) && running !== incoming;
}

/** Makes every in-app move to a page of another build a full load. */
export function loadOtherBuildsInFull(running: string | undefined): void {
  document.addEventListener("astro:before-swap", (event) => {
    const incoming = event.newDocument
      .querySelector('meta[name="singularity-build"]')
      ?.getAttribute("content");
    // Offline there is nothing newer to load: the worker's copy is what any load would show.
    if (!navigator.onLine || !isOtherBuild(running, incoming)) return;
    const state = document.documentElement.dataset.playerState;
    if (state === "playing" || state === "loading") return;
    event.swap = () => {};
    // Back to a URL that differs only by its fragment has already moved the address: assigning it
    // again would stay on the old page.
    if (event.to.href === location.href) location.reload();
    else location.assign(event.to.href);
  });
}
