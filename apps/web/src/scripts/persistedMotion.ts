/**
 * The persisted islands (the player, the sheets) ride through a move between pages: Astro takes each
 * out of the leaving document and puts the same element into the arriving one. An element that is
 * put back starts every CSS animation it has again, so the dock's caption and the player's story
 * line faded in anew on every move, and the cover's glow lost its place in its breath. Here each
 * animation on a persisted element is read before the swap and given its own time back after it:
 * one that had finished stays finished, one that was running carries on.
 */

const PERSISTED = "[data-astro-transition-persist]";

interface Held {
  target: Element;
  name: string;
  pseudo: string;
  time: number;
}

function persistedAnimations(): Array<{
  animation: CSSAnimation;
  target: Element;
  pseudo: string;
}> {
  const found: Array<{ animation: CSSAnimation; target: Element; pseudo: string }> = [];
  for (const animation of document.getAnimations()) {
    if (!("animationName" in animation)) continue;
    const effect = animation.effect as KeyframeEffect | null;
    const target = effect?.target;
    if (target?.closest(PERSISTED)) {
      found.push({
        animation: animation as CSSAnimation,
        target,
        pseudo: effect?.pseudoElement ?? "",
      });
    }
  }
  return found;
}

export function installPersistedMotion(): void {
  let held: Held[] = [];

  document.addEventListener("astro:before-swap", () => {
    held = persistedAnimations().flatMap(({ animation, target, pseudo }) => {
      const time = Number(animation.currentTime ?? 0);
      return [{ target, name: animation.animationName, pseudo, time }];
    });
  });

  document.addEventListener("astro:after-swap", () => {
    const before = held;
    held = [];
    for (const { animation, target, pseudo } of persistedAnimations()) {
      const same = before.find(
        (entry) =>
          entry.target === target &&
          entry.name === animation.animationName &&
          entry.pseudo === pseudo,
      );
      if (same) {
        animation.currentTime = same.time;
      } else if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) {
        // It had run its course before the move; the put-back must not run it again.
        animation.finish();
      }
    }
  });
}
