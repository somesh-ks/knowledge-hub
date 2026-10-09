/**
 * The Podcast page's profiles, loaded after the page is up so the first load stays small.
 */
import type { Voice } from "../lib/voices";

const LIST_TIMEOUT_MS = 10_000;

/**
 * The profile switch, the voice rows that follow the type, and the voices. The voice list is loaded
 * here, once the page is up, and fills every voice select; a failed load leaves the default and the
 * saved voice, which is all a person needs to keep what they have.
 */
export function mountProfiles(root: HTMLElement, changed: () => void): void {
  const profiles = root.querySelectorAll<HTMLElement>("[data-profile]");
  const showProfile = (id: string): void => {
    for (const profile of profiles) profile.hidden = profile.dataset.profile !== id;
  };
  const syncType = (profile: HTMLElement): void => {
    const format = profile.querySelector<HTMLInputElement>('input[data-f$=".format"]:checked');
    const discussion = format?.value === "discussion";
    const rows = profile.querySelectorAll<HTMLElement>("[data-voice-row]");
    rows[1]?.toggleAttribute("hidden", !discussion);
    rows.forEach((row) => {
      const label = row.querySelector<HTMLElement>("[data-voice-label]");
      const name = label?.dataset.name ?? "";
      if (label) label.textContent = discussion ? name : `Voice (${name})`;
    });
  };
  let voices: Voice[] = [];
  let audio: HTMLAudioElement | undefined;
  const previewOf = (select: HTMLSelectElement): string | null =>
    voices.find((voice) => voice.id === select.value)?.preview_url ?? null;
  const syncPreview = (select: HTMLSelectElement): void => {
    const button = select.closest(".podcast-voice")?.querySelector<HTMLElement>("[data-preview]");
    if (button) button.hidden = previewOf(select) === null;
  };

  root.addEventListener("change", (event) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.name === "profile") showProfile(target.value);
    const profile = target.closest<HTMLElement>("[data-profile]");
    if (profile && target.matches('input[data-f$=".format"]')) syncType(profile);
    if (target instanceof HTMLSelectElement && target.closest(".podcast-voice")) {
      audio?.pause();
      syncPreview(target);
    }
  });
  root.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-preview]");
    const select = button?.closest(".podcast-voice")?.querySelector("select");
    const url = select ? previewOf(select) : null;
    if (!button || !url) return;
    // The player is built on the first press, so the page loads no audio code up front.
    audio ??= new Audio();
    if (!audio.paused && audio.src === url) {
      audio.pause();
      return;
    }
    audio.src = url;
    void audio.play().catch(() => undefined);
  });

  void (async () => {
    try {
      const lib = await import("../lib/voices");
      const response = await fetch("/api/voices", { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
      voices = (response.ok ? lib.parseVoices(await response.json()) : null) ?? [];
      for (const select of root.querySelectorAll<HTMLSelectElement>(".podcast-voice select")) {
        lib.fillVoiceSelect(select, voices, select.value);
        syncPreview(select);
      }
    } catch {
      voices = [];
    }
    root.dataset.voices = "";
    changed();
  })();
}
