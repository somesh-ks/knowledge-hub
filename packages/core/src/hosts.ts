/**
 * The names of an episode's two hosts, worked out from the voices that read them, so a male voice is
 * never called by a woman's name or the other way round. A host takes the voice's own name when it
 * is one given name, and otherwise a name from the pool for the voice's gender, picked by a hash of
 * the voice id, so a voice keeps the same name on every episode and every screen.
 *
 * Pure and free of imports, so the site can call it on the server (it names the hosts when it asks
 * for an episode, because the engine cannot look voices up) and in the browser.
 */

/** A voice as the voice list describes it. Only the id picks a name; a name and a gender refine it. */
export type HostVoice = { id: string | null; name?: string | null; gender?: string | null };

/** The spoken names of the lead host ("a") and the second host ("b"). */
export interface HostNames {
  a: string;
  b: string;
}

export type HostGender = "female" | "male" | "neutral";

/**
 * Short, common names that any English voice says the same way, and no product's name. A voice whose
 * gender is unknown takes a neutral name, so nothing is assumed about it.
 *
 * A pick is the hash of the voice id modulo the pool's length, so reordering a pool or changing its
 * length renames the hosts of every voice from the next episode on. An episode keeps the names it
 * was written with in its request (host_names), so episodes already made never change.
 *
 * Without a voice id the lead takes a pool's first name and the second host its second, which keeps
 * the old pair for a female lead and a male second host: Ada and Leo.
 */
export const HOST_NAME_POOLS: Readonly<Record<HostGender, readonly string[]>> = {
  female: ["Ada", "Nora", "Clara", "Grace", "Emma", "Lucy", "Ivy", "June", "Rose", "Helen"],
  male: ["Owen", "Leo", "Ben", "Tom", "Paul", "Felix", "Jack", "Oscar", "Eli", "Mark"],
  neutral: [
    "Alex",
    "Sam",
    "Robin",
    "Jordan",
    "Riley",
    "Casey",
    "Quinn",
    "Taylor",
    "Jamie",
    "Morgan",
  ],
};

/** The pool index each host takes when its voice has no id. */
const SLOT_DEFAULT = { a: 0, b: 1 } as const;

const FEMALE: ReadonlySet<string> = new Set(["female", "f", "woman"]);
const MALE: ReadonlySet<string> = new Set(["male", "m", "man"]);

/** A voice list's gender, read loosely. Anything that is not plainly female or male is neutral. */
export function hostGender(gender: string | null | undefined): HostGender {
  const key = gender?.trim().toLowerCase() ?? "";
  if (FEMALE.has(key)) return "female";
  if (MALE.has(key)) return "male";
  return "neutral";
}

/** One given name: letters, with an apostrophe or a hyphen only between two letters. */
const GIVEN_NAME = /^\p{L}+(?:['’-]\p{L}+)*$/u;
const NAME_MIN_CHARS = 2;
const NAME_MAX_CHARS = 14;

/**
 * The voice's own name when it is one given name, with its first letter upper-cased. Null for
 * anything else ("Narrator Dan", "geffen_32", a full name), which then takes a name from the pool.
 */
function ownName(name: string | null | undefined): string | null {
  const trimmed = name?.normalize("NFC").trim() ?? "";
  const letters = [...trimmed];
  if (letters.length < NAME_MIN_CHARS || letters.length > NAME_MAX_CHARS) return null;
  if (!GIVEN_NAME.test(trimmed)) return null;
  const [first = "", ...rest] = letters;
  return `${first.toUpperCase()}${rest.join("")}`;
}

/** FNV-1a over the id's UTF-16 code units: the same number in every runtime, so a name never drifts. */
function hashOf(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The pool's entry at an index, counting round from the start. Every pool has names. */
function entry(pool: readonly string[], index: number): string {
  return pool[index % pool.length] ?? "";
}

const sameName = (one: string, other: string): boolean => one.toLowerCase() === other.toLowerCase();

interface Pick {
  name: string;
  pool: readonly string[];
  /** Where in the pool this voice's pick starts: its hash, or the host's default without an id. */
  start: number;
}

function pickFor(voice: HostVoice | null, slot: keyof HostNames): Pick {
  const pool = HOST_NAME_POOLS[hostGender(voice?.gender)];
  const start = voice?.id ? hashOf(voice.id) % pool.length : SLOT_DEFAULT[slot];
  return { name: ownName(voice?.name) ?? entry(pool, start), pool, start };
}

/**
 * The two hosts' names for these voices. Pure and deterministic: the same voices always give the
 * same names. Null or unknown voices give a gender-neutral pair. When both hosts would have the same
 * name (one voice reading both, or two voices with one display name), the second host takes the next
 * name in its pool that differs.
 */
export function hostNamesFor(a: HostVoice | null, b: HostVoice | null): HostNames {
  const lead = pickFor(a, "a");
  const second = pickFor(b, "b");
  if (!sameName(lead.name, second.name)) return { a: lead.name, b: second.name };
  for (let step = 0; step < second.pool.length; step += 1) {
    const name = entry(second.pool, second.start + step);
    if (!sameName(name, lead.name)) return { a: lead.name, b: name };
  }
  // Unreachable: every pool holds more than one name.
  return { a: lead.name, b: second.name };
}
