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

/** The regions public/flags.svg draws (Flagpack), as its symbol ids name them. */
export const FLAG_REGIONS: ReadonlySet<string> = new Set(
  "AE AR AU BR CA CL CN CO CZ DE DK ES FI FR GB GR IE IN IT JP KR MX NG NL NO NZ PE PH PL PT RU SE SG TR UA US ZA".split(
    " ",
  ),
);

/**
 * The region of a voice's accent, from its locale ("en-GB" gives "GB"), or "" when the locale names
 * none. The flag is drawn from it (flagNode); search and the accessible name read the words.
 */
export function voiceFlag(language: string | null): string {
  const region = language?.split(/[-_]/)[1]?.toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(region) ? region : "";
}

/** The sprite symbol id of a region's flag ("GB" gives "flag-gb"), or null when the sprite has none. */
export function flagSymbolId(region: string): string | null {
  return FLAG_REGIONS.has(region) ? `flag-${region.toLowerCase()}` : null;
}

/**
 * A region's flag as an SVG from the sprite, the same on every system (Windows draws no flag emoji).
 * A region the sprite lacks gets a small badge of its two letters. Hidden from assistive tech: the
 * option's words and its accent in the search keywords carry the meaning.
 */
export function flagNode(region: string): Element {
  const symbol = flagSymbolId(region);
  if (symbol === null) {
    const badge = document.createElement("span");
    badge.className = "flag flag-badge";
    badge.dataset.code = region;
    badge.setAttribute("aria-hidden", "true");
    return badge;
  }
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "flag");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(ns, "use");
  use.setAttribute("href", `/flags.svg#${symbol}`);
  svg.append(use);
  return svg;
}

/** What an option reads, as plain text: "Sophia, female". The accent's flag is drawn beside it. */
export function voiceLabel(voice: Voice): string {
  return voice.gender ? `${voice.name}, ${voice.gender.toLowerCase()}` : voice.name;
}

/**
 * What a voice's search also reads beyond its label: the accent in words and its locale, so
 * "british" and "en-GB" both find the British voices. Empty when the locale is unknown.
 */
export function voiceKeywords(voice: Voice): string {
  const code = voice.language ?? "";
  if (code === "") return "";
  let words = "";
  try {
    words = new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? "";
  } catch {
    // A locale code Intl cannot name: the code alone is searched.
  }
  return [words, code].filter((part) => part !== "").join(" ");
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
  const add = (value: string, text: string, keywords = "", region = ""): void => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    if (keywords !== "") option.dataset.keywords = keywords;
    // The picker draws this region's flag before the words.
    if (region !== "") option.dataset.region = region;
    options.push(option);
  };
  add(
    "",
    fallback ? `Default (${fallback.name})` : "Default",
    "",
    fallback ? voiceFlag(fallback.language) : "",
  );
  for (const voice of voices)
    add(voice.id, voiceLabel(voice), voiceKeywords(voice), voiceFlag(voice.language));
  if (chosen !== "" && !voices.some((voice) => voice.id === chosen)) add(chosen, "Saved voice");
  select.replaceChildren(...options);
  select.value = chosen;
  // A search list drawn over this select reads its options again.
  select.dispatchEvent(new Event("picker:sync"));
}
