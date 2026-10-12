/**
 * A Play pressed before the player loaded. The inline script (scripts/bannersInit.js) keeps the pressed
 * `[data-play-digest]` control, shows it as preparing and unlocks an audio element inside the tap;
 * once the player's own click listener is in place, the press is made again so it is not lost.
 */
export interface EarlyPlay {
  chip: HTMLElement | null;
  /** The control's state before it was shown as preparing. */
  state: string | null | undefined;
  /** Played inside the tap, so a phone lets the player start it later without another tap. */
  audio: HTMLAudioElement | null;
  /** Removes the inline script's listener. */
  stop?: () => void;
}

interface EarlyScope {
  dispatchEarlyPlay?: EarlyPlay;
}

const scopeOf = (): EarlyScope =>
  typeof window === "undefined" ? {} : (window as unknown as EarlyScope);

/** The audio element the inline script unlocked, once. Null when nothing was pressed early. */
export function takeEarlyAudio(scope: EarlyScope = scopeOf()): HTMLAudioElement | null {
  const early = scope.dispatchEarlyPlay;
  const audio = early?.audio ?? null;
  if (early) early.audio = null;
  return audio;
}

/**
 * Stops the inline script's listener and presses the kept control again. Call it once the player's
 * click listener is attached. The control is put back as it was first, so the player's own handling
 * (play, or narrate and show it preparing) starts from the page's state.
 */
export function replayEarlyTap(scope: EarlyScope = scopeOf()): void {
  const early = scope.dispatchEarlyPlay;
  if (!early) return;
  early.stop?.();
  early.stop = undefined;
  const chip = early.chip;
  early.chip = null;
  if (!chip) return;
  chip.removeAttribute("aria-busy");
  if (chip.dataset.state === "preparing") {
    if (early.state) chip.dataset.state = early.state;
    else delete chip.dataset.state;
  }
  // A control gone with a navigation, or one the player has since disabled (offline), is not pressed.
  if (!chip.isConnected || chip.getAttribute("aria-disabled") === "true") return;
  chip.click();
}
