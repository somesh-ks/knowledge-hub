import { hostNamesFor } from "@dispatch/core/hosts";

/**
 * Who is speaking in an episode, as the transcript names them.
 *
 * A readout has one voice, so nobody is named. A discussion has two, and each is named after the
 * voice that reads it: the names are chosen when the episode is requested (the voice's gender is
 * known there) and stored with it. A discussion made before names were stored is named the way the
 * engine names one now, from the voices it is read with (hostNamesFor in core), unless its script
 * itself says the pair it was once written for, Ada and Leo.
 *
 * "a" leads the conversation; "b" joins it. The tone is a name for a colour: player.css maps it to
 * existing tokens.
 */
export type HostKey = "a" | "b";

export interface HostNames {
  a: string;
  b: string;
}

export interface Host {
  key: HostKey;
  /** What to show above the turn, or null when the episode has one voice and nobody to tell apart. */
  name: string | null;
  tone: "lead" | "guest";
}

/** The pair a discussion was written for before names followed the voices. */
export const LEGACY_HOSTS: HostNames = { a: "Ada", b: "Leo" };

/** A voice as /api/voices lists it: only what names a host. */
export interface HostVoiceInfo {
  id: string;
  name: string;
  gender: string | null;
}

/**
 * What the voice list says about an episode's voices. `ids` are the voices the episode asked for
 * (null for a host: the default), `list` and `defaults` come from /api/voices.
 */
export interface HostVoiceLookup {
  ids: { a: string | null; b: string | null } | null;
  list: readonly HostVoiceInfo[];
  defaults: { voice: string; voice_b: string } | null;
}

type Turn = { speaker: string; text?: string };

const LEGACY_SAID = /\b(?:Ada|Leo)\b/;

/** True when a discussion's script says the old pair's names, so they are what it was written for. */
function saysLegacyNames(turns: readonly Turn[]): boolean {
  return turns.some((turn) => LEGACY_SAID.test(turn.text ?? ""));
}

const hasTwoVoices = (turns: readonly Turn[]): boolean =>
  turns.some((turn) => turn.speaker === "b");

/** True when the hosts can only be named from the voice list: a discussion with nothing stored. */
export function needsVoiceList(turns: readonly Turn[], stored?: HostNames | null): boolean {
  return hasTwoVoices(turns) && !stored && !saysLegacyNames(turns);
}

/** The names the voices give, as the engine works them out: a voice the list lacks names nobody. */
function namesFromVoices(lookup: HostVoiceLookup): HostNames {
  const a = lookup.ids?.a ?? lookup.defaults?.voice ?? null;
  const b = lookup.ids?.b ?? lookup.defaults?.voice_b ?? null;
  const voiceA = lookup.list.find((voice) => voice.id === a);
  const voiceB = lookup.list.find((voice) => voice.id === b);
  if (!voiceA || !voiceB) return hostNamesFor(null, null);
  return hostNamesFor(voiceA, voiceB);
}

/**
 * The names an episode's transcript shows: none for one voice, the stored pair for two, the old
 * pair when the script says it, and otherwise the voices' names. `lookup` is undefined while the
 * voice list is on its way (no names yet: a wrong name would show and then change) and null when it
 * could not be read (a neutral pair, which fits any voice).
 */
export function transcriptNames(
  turns: readonly Turn[],
  stored?: HostNames | null,
  lookup?: HostVoiceLookup | null,
): HostNames | null {
  if (!hasTwoVoices(turns)) return null;
  if (stored) return stored;
  if (saysLegacyNames(turns)) return LEGACY_HOSTS;
  if (lookup === undefined) return null;
  return lookup === null ? hostNamesFor(null, null) : namesFromVoices(lookup);
}

/** A stored pair of names, or null when the value is not one: the page's JSON is not trusted. */
export function readHostNames(value: unknown): HostNames | null {
  if (typeof value !== "object" || value === null) return null;
  const { a, b } = value as Record<string, unknown>;
  if (typeof a !== "string" || typeof b !== "string") return null;
  return a.trim() !== "" && b.trim() !== "" ? { a: a.trim(), b: b.trim() } : null;
}

/** The voice ids an episode asked for, or null when the value is not that shape. */
export function readVoiceIds(value: unknown): { a: string | null; b: string | null } | null {
  if (typeof value !== "object" || value === null) return null;
  const { a, b } = value as Record<string, unknown>;
  const id = (entry: unknown): string | null =>
    typeof entry === "string" && entry !== "" ? entry : null;
  return { a: id(a), b: id(b) };
}

export function hostOf(speaker: string, names: HostNames | null): Host {
  const key: HostKey = speaker === "b" ? "b" : "a";
  return { key, name: names ? names[key] : null, tone: key === "b" ? "guest" : "lead" };
}
