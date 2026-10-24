/**
 * A podcast profile page's own parts (Daily, Weekly, Custom), loaded after the page is up so the
 * first load stays small.
 */

import type { Voice, VoiceDefaults } from "../lib/voices";
import type { ConfigOp } from "../types/contracts";
import { mountSamples } from "./voiceSamples";

const LIST_TIMEOUT_MS = 10_000;

/** Said in a voice list that could not be filled: the voice service did not answer, or has no voices. */
const VOICES_UNAVAILABLE = "Couldn't load the voice list. Default and your saved voice stay.";

/** What the schedule controls hold, by field: "daily.hour", "weekly.day", "weekly.voice_b". */
export type FieldValues = Record<string, string>;

const nullable = (value: string): string | null => (value === "" ? null : value);

/**
 * The schedule edit the controls stand for: every field whose value differs from `was`, in the
 * profile it belongs to. Null when nothing differs. Which topics a profile plays is each topic's
 * Scope (topic.scope, D69), never this op, so a stale page cannot bring a topic back.
 */
export function scheduleOp(was: FieldValues, now: FieldValues): ConfigOp | null {
  // The daily fields sit at the top of the op; the weekly and custom ones in their own object.
  const top: Record<string, unknown> = {};
  const nested: Record<string, Record<string, unknown>> = { weekly: {}, custom: {} };
  const names: Record<string, string> = { cadence: "cadence_days", length: "length_minutes" };
  for (const [key, value] of Object.entries(now)) {
    if (was[key] === value) continue;
    const [profile = "", field = ""] = key.split(".");
    // The time zone is one setting of the schedule, whichever profile shows it.
    if (field === "timezone") {
      top.timezone = value;
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
 * The voices. The voice list is loaded here, once the page is up, and fills every voice select; a
 * failed load leaves the default and the saved voice, which is all a person needs to keep what they
 * have, and the open list says why it is short. Both voices are always on the page: the second is
 * for discussions, and is set whatever the format is now. The time zones' offsets are worked out
 * again here, because the page was built at another time of year.
 */
export function mountProfiles(root: HTMLElement, changed: () => void): void {
  let voices: Voice[] = [];
  /** The voices Default stands for, from /api/voices; null until the list is in. */
  let defaults: VoiceDefaults | null = null;
  /** The voice a select stands for: its own, or for Default the one the engine reads with. */
  const voiceOf = (select: HTMLSelectElement): Voice | undefined => {
    const second = (select.dataset.f ?? "").endsWith("voice_b");
    const id = select.value || (second ? defaults?.voice_b : defaults?.voice) || "";
    return voices.find((voice) => voice.id === id);
  };
  const syncSample = mountSamples(root, ".podcast-voice", voiceOf);

  void import("@singularity/core/time").then(({ zoneLabel }) => {
    const now = new Date();
    for (const select of root.querySelectorAll<HTMLSelectElement>(
      'select[data-picker="time zone"]',
    )) {
      for (const option of select.options) {
        const place = option.dataset.place;
        if (place) option.textContent = zoneLabel({ value: option.value, label: place }, now);
      }
      select.dispatchEvent(new Event("picker:sync"));
    }
  });

  void (async () => {
    // What the list says when it is short: no list at all, or a list with nobody in it.
    let note = "";
    const selects = root.querySelectorAll<HTMLSelectElement>(".podcast-voice select");
    try {
      const lib = await import("../lib/voices");
      const response = await fetch("/api/voices", { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
      const body: unknown = response.ok ? await response.json() : null;
      voices = lib.parseVoices(body) ?? [];
      defaults = lib.parseVoiceDefaults(body);
      note = voices.length === 0 ? VOICES_UNAVAILABLE : "";
      for (const select of selects) {
        const second = (select.dataset.f ?? "").endsWith("voice_b");
        const fallback = voices.find(
          (voice) => voice.id === (second ? defaults?.voice_b : defaults?.voice),
        );
        lib.fillVoiceSelect(select, voices, select.value, fallback);
        syncSample(select);
      }
    } catch {
      voices = [];
      note = VOICES_UNAVAILABLE;
      for (const select of selects) syncSample(select);
    }
    for (const select of selects) {
      if (note) select.dataset.note = note;
      else delete select.dataset.note;
    }
    root.dataset.voices = "";
    changed();
  })();
}
