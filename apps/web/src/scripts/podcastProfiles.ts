/**
 * A podcast profile page's own parts (Daily, Weekly, Custom), loaded after the page is up so the
 * first load stays small.
 */

import type { Voice, VoiceDefaults } from "../lib/voices";
import type { ConfigOp } from "../types/contracts";

const LIST_TIMEOUT_MS = 10_000;

/** What the schedule controls hold, by field: "daily.hour", "weekly.day", "custom.voice_b". */
export type FieldValues = Record<string, string>;

const nullable = (value: string): string | null => (value === "" ? null : value);

/**
 * The schedule edit the controls stand for: every field whose value differs from `was`, in the
 * profile it belongs to. Topics are the ids left out, comma-separated, empty for none. Null when
 * nothing differs.
 */
export function scheduleOp(was: FieldValues, now: FieldValues): ConfigOp | null {
  // The daily fields sit at the top of the op; the weekly and custom ones in their own object.
  const top: Record<string, unknown> = {};
  const nested: Record<string, Record<string, unknown>> = { weekly: {}, custom: {} };
  const names: Record<string, string> = { cadence: "cadence_days", length: "length_minutes" };
  for (const [key, value] of Object.entries(now)) {
    if (was[key] === value) continue;
    const [profile = "", field = ""] = key.split(".");
    if (field === "skip") {
      (nested[profile] ?? top).skip_topics = value === "" ? [] : value.split(",");
      continue;
    }
    const name = names[field] ?? field;
    const number = ["hour", "day", "cadence", "length"].includes(field);
    const parsed = number
      ? Number(value)
      : field === "enabled"
        ? value === "true"
        : field.startsWith("voice")
          ? nullable(value)
          : value;
    const voice = field === "voice" ? "voice_id" : field === "voice_b" ? "voice_id_b" : name;
    (nested[profile] ?? top)[voice] = parsed;
  }
  const weekly = Object.keys(nested.weekly ?? {}).length > 0 ? { weekly: nested.weekly } : {};
  const custom = Object.keys(nested.custom ?? {}).length > 0 ? { custom: nested.custom } : {};
  if (Object.keys(top).length + Object.keys(weekly).length + Object.keys(custom).length === 0)
    return null;
  return { op: "schedule.set", ...top, ...weekly, ...custom } as ConfigOp;
}

/**
 * The voice rows that follow the type, and the voices. The voice list is loaded here, once the page
 * is up, and fills every voice select; a failed load leaves the default and the saved voice, which is
 * all a person needs to keep what they have.
 */
export function mountProfiles(root: HTMLElement, changed: () => void): void {
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
  /** The voices Default stands for, from /api/voices; null until the list is in. */
  let defaults: VoiceDefaults | null = null;
  let audio: HTMLAudioElement | undefined;
  /** The sample playing now, so a second press on its chip stops it. */
  let current = "";
  /** The sample chip whose voice is playing: it shows pause until the sample ends or stops. */
  let playing: HTMLButtonElement | null = null;
  const mark = (button: HTMLButtonElement | null): void => {
    if (playing && playing !== button) playing.setAttribute("aria-pressed", "false");
    playing = button;
    button?.setAttribute("aria-pressed", "true");
  };
  /** The voice a select stands for: its own, or for Default the one the engine reads with. */
  const voiceOf = (select: HTMLSelectElement): Voice | undefined => {
    const second = (select.dataset.f ?? "").endsWith("voice_b");
    const id = select.value || (second ? defaults?.voice_b : defaults?.voice) || "";
    return voices.find((voice) => voice.id === id);
  };
  /** Samples come through the site: the page may play audio only from its own address (CSP). */
  const sampleOf = (select: HTMLSelectElement): string | null => {
    const voice = voiceOf(select);
    return voice?.preview_url ? `/api/voice-sample?voice=${encodeURIComponent(voice.id)}` : null;
  };
  const chipOf = (select: HTMLSelectElement): HTMLButtonElement | null =>
    select.closest(".podcast-voice")?.querySelector<HTMLButtonElement>("[data-preview]") ?? null;
  const syncPreview = (select: HTMLSelectElement): void => {
    const chip = chipOf(select);
    if (chip) chip.hidden = sampleOf(select) === null;
  };
  /** Plays a sample, or stops it when `toggle` and it is the one playing. */
  const play = (chip: HTMLButtonElement, url: string, toggle: boolean): void => {
    // The player is built on the first press, so the page loads no audio code up front.
    if (!audio) {
      audio = new Audio();
      audio.addEventListener("pause", () => mark(null));
      audio.addEventListener("ended", () => mark(null));
      // A sample that cannot be played takes its chip with it, rather than failing in silence.
      audio.addEventListener("error", () => {
        if (playing) playing.hidden = true;
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
    const target = event.target as HTMLElement;
    const profile = target.closest<HTMLElement>("[data-profile]");
    if (profile && target.matches('input[data-f$=".format"]')) syncType(profile);
    // Choosing a voice plays it, as a phone's ringtone list does, so the list can be heard one
    // voice at a time; the chip plays it again or stops it.
    if (target instanceof HTMLSelectElement && target.closest(".podcast-voice")) {
      syncPreview(target);
      const chip = chipOf(target);
      const url = sampleOf(target);
      if (chip && url) play(chip, url, false);
      else audio?.pause();
    }
  });
  // The last ticked topic stays ticked: with none, the episode would have only Top picks. A click
  // has already toggled a checkbox when it is heard, and cancelling it puts the tick back before any
  // change is fired, so nothing is recorded.
  root.addEventListener(
    "click",
    (event) => {
      const box = event.target;
      if (!(box instanceof HTMLInputElement) || !box.matches('[data-f$=".skip"]')) return;
      if (!box.checked && !box.closest("fieldset")?.querySelector("input:checked")) {
        event.preventDefault();
      }
    },
    true,
  );
  root.addEventListener("click", (event) => {
    const chip = (event.target as Element).closest<HTMLButtonElement>("[data-preview]");
    const select = chip?.closest(".podcast-voice")?.querySelector("select");
    const url = select ? sampleOf(select) : null;
    if (chip && url) play(chip, url, true);
  });

  void (async () => {
    try {
      const lib = await import("../lib/voices");
      const response = await fetch("/api/voices", { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
      const body: unknown = response.ok ? await response.json() : null;
      voices = lib.parseVoices(body) ?? [];
      defaults = lib.parseVoiceDefaults(body);
      for (const select of root.querySelectorAll<HTMLSelectElement>(".podcast-voice select")) {
        const second = (select.dataset.f ?? "").endsWith("voice_b");
        const fallback = voices.find(
          (v) => v.id === (second ? defaults?.voice_b : defaults?.voice),
        );
        lib.fillVoiceSelect(select, voices, select.value, fallback);
        syncPreview(select);
      }
    } catch {
      voices = [];
    }
    root.dataset.voices = "";
    changed();
  })();
}
