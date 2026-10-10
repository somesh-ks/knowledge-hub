/**
 * The Podcast page's profiles, loaded after the page is up so the first load stays small.
 */

import type { Voice } from "../lib/voices";
import type { ConfigOp } from "../types/contracts";

const LIST_TIMEOUT_MS = 10_000;

/** What the schedule controls hold, by field: "daily.hour", "weekly.day", "custom.voice_b". */
export type FieldValues = Record<string, string>;

const nullable = (value: string): string | null => (value === "" ? null : value);

/**
 * The schedule edit the controls stand for: every field whose value differs from `was`, in the
 * profile it belongs to. The topics a briefing covers are not chosen here, so they are left out and
 * keep what the file holds. Null when nothing differs.
 */
export function scheduleOp(was: FieldValues, now: FieldValues): ConfigOp | null {
  // The daily fields sit at the top of the op; the weekly and custom ones in their own object.
  const top: Record<string, unknown> = {};
  const nested: Record<string, Record<string, unknown>> = { weekly: {}, custom: {} };
  const names: Record<string, string> = { cadence: "cadence_days", length: "length_minutes" };
  for (const [key, value] of Object.entries(now)) {
    if (was[key] === value) continue;
    const [profile = "", field = ""] = key.split(".");
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
