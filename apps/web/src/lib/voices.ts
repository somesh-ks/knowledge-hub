/**
 * The Speechify voices a podcast can use, as GET /api/voices sends them. Pure and small: the
 * Podcast settings page and the Create panel both load it, and neither at first paint.
 */

export interface Voice {
  id: string;
  name: string;
  gender: string | null;
  language: string | null;
  preview_url: string | null;
}

/** The list as the API sends it, or null when it is not in the expected shape. */
export function parseVoices(body: unknown): Voice[] | null {
  if (typeof body !== "object" || body === null) return null;
  const voices = (body as { voices?: unknown }).voices;
  if (!Array.isArray(voices)) return null;
  const rows: Voice[] = [];
  for (const entry of voices) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, name, gender, language, preview_url } = entry as Record<string, unknown>;
    if (typeof id !== "string" || id === "" || typeof name !== "string") continue;
    rows.push({
      id,
      name,
      gender: typeof gender === "string" ? gender : null,
      language: typeof language === "string" ? language : null,
      preview_url: typeof preview_url === "string" ? preview_url : null,
    });
  }
  return rows;
}

/** Why a voice list could not be read: the device has no connection, or the voice service did not answer. */
export type VoiceListFailure = "offline" | "unavailable";

/** What an open voice list says when it is short (the default and the saved voice always stay). */
export const VOICE_LIST_NOTES: Record<VoiceListFailure, string> = {
  offline: "You're offline. Default and your saved voice stay.",
  unavailable: "Couldn't load the voice list. Default and your saved voice stay.",
};

export const VOICE_LIST_TIMEOUT_MS = 10_000;
export const VOICE_LIST_RETRY_MS = 1500;

export interface VoiceListDeps {
  fetch: (url: string, init: { signal: AbortSignal }) => Promise<Pick<Response, "ok" | "json">>;
  online: () => boolean;
  wait: (ms: number) => Promise<void>;
}

/**
 * GET /api/voices, once more if the first try fails (2026-11-02: one weak moment emptied the picker
 * with nothing to retry). A device with no connection is not retried: it says so at once. After
 * two failures the answer is "offline" if the connection went while it tried, else "unavailable".
 */
export async function fetchVoiceList(
  deps: VoiceListDeps,
): Promise<{ body: unknown } | { failure: VoiceListFailure }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!deps.online()) return { failure: "offline" };
    try {
      const response = await deps.fetch("/api/voices", {
        signal: AbortSignal.timeout(VOICE_LIST_TIMEOUT_MS),
      });
      if (response.ok) return { body: await response.json() };
    } catch {
      // Falls through to the retry.
    }
    if (attempt === 0) await deps.wait(VOICE_LIST_RETRY_MS);
  }
  return { failure: deps.online() ? "unavailable" : "offline" };
}

/** The voices Default stands for in each host's place: what the engine reads with when none is set. */
export interface VoiceDefaults {
  voice: string;
  voice_b: string;
}

/** The defaults /api/voices sends beside the list, or null when they are missing. */
export function parseVoiceDefaults(body: unknown): VoiceDefaults | null {
  const defaults = (body as { defaults?: unknown } | null)?.defaults;
  if (typeof defaults !== "object" || defaults === null) return null;
  const { voice, voice_b: voiceB } = defaults as Record<string, unknown>;
  return typeof voice === "string" && typeof voiceB === "string"
    ? { voice, voice_b: voiceB }
    : null;
}

/**
 * The region of a voice's accent, from its locale ("en-GB" gives "GB"), or "" when the locale names
 * none. The flag is drawn from it (the design system's Flag); search and the accessible name read the words.
 */
export function voiceFlag(language: string | null): string {
  const region = language?.split(/[-_]/)[1]?.toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(region) ? region : "";
}

/** What an option reads, as plain text: "Sophia, female". The accent's flag is drawn beside it. */
export function voiceLabel(voice: Voice): string {
  return voice.gender ? `${voice.name}, ${voice.gender.toLowerCase()}` : voice.name;
}

let accentNames: Intl.DisplayNames | null | undefined;

/** The accent in words for a locale code ("British English" for en-GB), or "" when Intl cannot name it. */
function accentWords(code: string): string {
  if (accentNames === undefined) {
    try {
      accentNames = new Intl.DisplayNames(["en"], { type: "language" });
    } catch {
      accentNames = null;
    }
  }
  try {
    // Intl wants en-GB; the voice list may send en_GB, which the flag already reads.
    return accentNames?.of(code.replace(/_/g, "-")) ?? "";
  } catch {
    // A locale code Intl cannot name: no words, the code alone is searched.
    return "";
  }
}

/**
 * What a voice's search also reads beyond its label: the accent in words and its locale, so
 * "british" and "en-GB" both find the British voices. Empty when the locale is unknown.
 */
export function voiceKeywords(voice: Voice): string {
  const code = voice.language ?? "";
  if (code === "") return "";
  return [accentWords(code), code].filter((part) => part !== "").join(" ");
}

/** The accent in words ("British English" for en-GB), or "" when the locale has no name. */
export function voiceAccent(voice: Voice): string {
  const code = voice.language ?? "";
  if (code === "") return "";
  return accentWords(code);
}

/** The line under a voice's name in the list: its gender, then its accent, "Female, British English". */
export function voiceSubtitle(voice: Voice): string {
  const gender = voice.gender
    ? voice.gender.charAt(0).toUpperCase() + voice.gender.slice(1).toLowerCase()
    : "";
  return [gender, voiceAccent(voice)].filter((part) => part !== "").join(", ");
}

/**
 * Fills a voice select: the default first (value ""), named after `fallback` when it is known, then
 * the voices, then the saved voice when it is not among them, so a stored choice is never silently
 * swapped for another. Keeps `chosen`.
 */
export function fillVoiceSelect(
  select: HTMLSelectElement,
  voices: readonly Voice[],
  chosen: string,
  fallback?: Voice,
): void {
  const options: HTMLOptionElement[] = [];
  /**
   * `title` is what the list and the button draw as the voice's name; `sub` the line under it;
   * `sample` the id of the voice whose sample the list's play control plays, absent when it has none;
   * `lead` and `tail` wrap the Default's title ("Default (" Ada ")"). The option's own text stays the
   * long label ("Ada, female"): the native select, the search and a screen reader read it.
   */
  const add = (
    value: string,
    text: string,
    extra: {
      keywords?: string;
      region?: string;
      title?: string;
      sub?: string;
      sample?: string;
      lead?: string;
      tail?: string;
    } = {},
  ): void => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    if (extra.keywords) option.dataset.keywords = extra.keywords;
    // The picker draws this region's flag before the words.
    if (extra.region) option.dataset.region = extra.region;
    if (extra.title) option.dataset.title = extra.title;
    if (extra.sub) option.dataset.sub = extra.sub;
    if (extra.sample) option.dataset.sample = extra.sample;
    if (extra.lead) option.dataset.lead = extra.lead;
    if (extra.tail) option.dataset.tail = extra.tail;
    options.push(option);
  };
  add("", fallback ? `Default (${fallback.name})` : "Default", {
    region: fallback ? voiceFlag(fallback.language) : "",
    ...(fallback
      ? {
          title: fallback.name,
          lead: "Default (",
          tail: ")",
          sample: fallback.preview_url ? fallback.id : "",
        }
      : { title: "Default" }),
  });
  for (const voice of voices)
    add(voice.id, voiceLabel(voice), {
      keywords: voiceKeywords(voice),
      region: voiceFlag(voice.language),
      title: voice.name,
      sub: voiceSubtitle(voice),
      sample: voice.preview_url ? voice.id : "",
    });
  if (chosen !== "" && !voices.some((voice) => voice.id === chosen))
    add(chosen, "Saved voice", { title: "Saved voice" });
  select.replaceChildren(...options);
  select.value = chosen;
  // A search list drawn over this select reads its options again.
  select.dispatchEvent(new Event("picker:sync"));
}
