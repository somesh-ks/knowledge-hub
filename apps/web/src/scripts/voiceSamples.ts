import type { Voice } from "../lib/voices";

/**
 * The round button beside a voice select that plays the voice's sample, in Settings (Daily, Weekly)
 * and in the Create form. Choosing a voice plays its sample too, as a phone's ringtone list does, so
 * a long list can be heard one voice at a time; the button plays it again or stops it. The audio is
 * built on the first press, so the page loads none up front, and it stops when the page is left.
 *
 * Samples come through the site (/api/voice-sample): the page may play audio only from its own
 * address and the Blob store (the Content-Security-Policy), so a sample on Speechify's host would be
 * blocked. A voice with no sample, or a list not in yet, leaves the button dimmed and not pressable,
 * so the select never moves and each voice has its own.
 *
 * `rowSelector` is the box that holds a select and its button; `voiceOf` says which voice a select
 * stands for (its own, or for Default the one the engine reads with), once the list is in. Returns
 * the call that brings one select's button up to date after its list or value changed.
 */
export function mountSamples(
  root: HTMLElement,
  rowSelector: string,
  voiceOf: (select: HTMLSelectElement) => Voice | undefined,
): (select: HTMLSelectElement) => void {
  let audio: HTMLAudioElement | undefined;
  /** The sample playing now, so a second press on its button stops it. */
  let current = "";
  /** The button whose voice is playing: it shows pause until the sample ends or stops. */
  let playing: HTMLButtonElement | null = null;
  const mark = (button: HTMLButtonElement | null): void => {
    if (playing && playing !== button) playing.setAttribute("aria-pressed", "false");
    playing = button;
    button?.setAttribute("aria-pressed", "true");
  };
  const sampleOf = (select: HTMLSelectElement): string | null => {
    const voice = voiceOf(select);
    return voice?.preview_url ? `/api/voice-sample?voice=${encodeURIComponent(voice.id)}` : null;
  };
  const chipOf = (select: HTMLSelectElement): HTMLButtonElement | null =>
    select.closest(rowSelector)?.querySelector<HTMLButtonElement>("[data-preview]") ?? null;
  /** The button of a voice row: pressable while its voice has a sample, dimmed and saying so when not. */
  const sync = (select: HTMLSelectElement): void => {
    const chip = chipOf(select);
    if (!chip) return;
    const name = chip.dataset.sampleName ?? "voice";
    const has = sampleOf(select) !== null;
    chip.disabled = !has;
    chip.setAttribute(
      "aria-label",
      has ? `Play a sample of the ${name}` : `No sample for the ${name}`,
    );
  };
  /** Plays a sample, or stops it when `toggle` and it is the one playing. */
  const play = (chip: HTMLButtonElement, url: string, toggle: boolean): void => {
    if (!audio) {
      audio = new Audio();
      audio.addEventListener("pause", () => mark(null));
      audio.addEventListener("ended", () => mark(null));
      // A sample that cannot be played dims its button and says so, rather than failing in silence.
      audio.addEventListener("error", () => {
        if (playing) {
          playing.disabled = true;
          playing.setAttribute("aria-label", "The sample could not be played");
        }
        mark(null);
      });
    }
    if (toggle && !audio.paused && current === url) {
      audio.pause();
      return;
    }
    current = url;
    audio.src = url;
    mark(chip);
    void audio.play().catch(() => mark(null));
  };

  root.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || !target.closest(rowSelector)) return;
    sync(target);
    const chip = chipOf(target);
    const url = sampleOf(target);
    if (chip && url) play(chip, url, false);
    else audio?.pause();
  });
  root.addEventListener("click", (event) => {
    const chip = (event.target as Element).closest<HTMLButtonElement>("[data-preview]");
    const select = chip?.closest(rowSelector)?.querySelector("select");
    const url = select ? sampleOf(select) : null;
    if (chip && url) play(chip, url, true);
  });
  // A sample stops when the page is left, by a link in the app (the page swaps in place, so the
  // audio would play on over the next one) or by closing or leaving the tab.
  const stop = (): void => audio?.pause();
  const leave = (): void => {
    stop();
    removeEventListener("pagehide", stop);
  };
  document.addEventListener("astro:before-swap", leave, { once: true });
  addEventListener("pagehide", stop);
  return sync;
}
