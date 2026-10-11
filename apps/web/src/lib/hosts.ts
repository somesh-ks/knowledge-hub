/**
 * Who is speaking in an episode, as the transcript names them.
 *
 * A readout has one voice, so nobody is named. A discussion has two, and each is named after the
 * voice that reads it: the names are chosen when the episode is requested (the voice's gender is
 * known there) and stored with it. A discussion made before names were stored was written for the
 * pair it was told, Ada and Leo, so those are what its script says and what the transcript shows.
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

/**
 * The names an episode's transcript shows: none for one voice, the stored pair for two, and the
 * pair the script was written for when a discussion has no stored names.
 */
export function transcriptNames(
  turns: readonly { speaker: string }[],
  stored?: HostNames | null,
): HostNames | null {
  if (!turns.some((turn) => turn.speaker === "b")) return null;
  return stored ?? LEGACY_HOSTS;
}

/** A stored pair of names, or null when the value is not one: the page's JSON is not trusted. */
export function readHostNames(value: unknown): HostNames | null {
  if (typeof value !== "object" || value === null) return null;
  const { a, b } = value as Record<string, unknown>;
  if (typeof a !== "string" || typeof b !== "string") return null;
  return a.trim() !== "" && b.trim() !== "" ? { a: a.trim(), b: b.trim() } : null;
}

export function hostOf(speaker: string, names: HostNames | null): Host {
  const key: HostKey = speaker === "b" ? "b" : "a";
  return { key, name: names ? names[key] : null, tone: key === "b" ? "guest" : "lead" };
}
