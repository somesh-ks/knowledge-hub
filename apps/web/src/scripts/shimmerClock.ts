/**
 * Every shimmer on the document's one clock. A band that runs from its own zero jumps whenever its
 * element is drawn again (a row moved in a list, a word the page swap put back, a dock that opened and
 * folded), and two words side by side were never at the same point of the cycle (owner, 2026-11-04:
 * "it restarts many times, which makes it look glitchy"). An animation's start time is set to the
 * timeline's origin as it starts, so its place in the cycle is the time and nothing else: a restart
 * lands where the band already was, and every shimmer on the page crosses together.
 */

/** The shimmering animations: the podcast queue's words (queue.css) and the sources list's loading rows (topics.css). */
const SHIMMERS: ReadonlySet<string> = new Set(["queue-sheen", "source-shimmer"]);

/**
 * Puts every running shimmer on the clock now. A word that goes live is drawn for the first time in the
 * next frame; the animationstart event arrives after that frame, so the band showed at its own zero for
 * one frame and then jumped to the clock (owner, 2026-11-05: "a glitch in the beginning"). Reading the
 * animations makes the browser create them at once, before that frame, and this puts them on the clock.
 */
export function syncShimmerClock(): void {
  onTheClock();
}

function onTheClock(): void {
  for (const animation of document.getAnimations()) {
    if (!(animation instanceof CSSAnimation) || !SHIMMERS.has(animation.animationName)) continue;
    if (animation.startTime !== 0 && animation.timeline?.currentTime != null) {
      animation.startTime = 0;
    }
  }
}

export function installShimmerClock(): void {
  // Capture: the event does not bubble from a pseudo-element's animation to every listener the same way.
  document.addEventListener(
    "animationstart",
    (event) => {
      if (SHIMMERS.has(event.animationName)) onTheClock();
    },
    true,
  );
  // A page swap puts persisted words back (persistedMotion.ts gives them their time); the clock wins after it.
  document.addEventListener("astro:after-swap", () => requestAnimationFrame(onTheClock));
}
