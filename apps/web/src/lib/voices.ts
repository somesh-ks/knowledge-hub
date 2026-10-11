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

/**
 * The flag of a voice's accent, from its locale's region ("en-GB" gives the British flag), or "" when
 * the locale names no region. Two regional indicator letters make the flag emoji; a system without
 * flag emoji (Windows) shows the letters instead, which still name the accent.
 */
export function voiceFlag(language: string | null): string {
  const region = language?.split(/[-_]/)[1]?.toUpperCase() ?? "";
  if (!/^[A-Z]{2}$/.test(region)) return "";
  return String.fromCodePoint(...[...region].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

/** What an option reads: "🇺🇸 Sophia, female", the flag first so the accents line up in the list. */
export function voiceLabel(voice: Voice): string {
  const name = voice.gender ? `${voice.name}, ${voice.gender.toLowerCase()}` : voice.name;
  const flag = voiceFlag(voice.language);
  return flag ? `${flag} ${name}` : name;
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
  const add = (value: string, text: string): void => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    options.push(option);
  };
  const fallbackFlag = fallback ? voiceFlag(fallback.language) : "";
  add(
    "",
    fallback ? `${fallbackFlag ? `${fallbackFlag} ` : ""}Default (${fallback.name})` : "Default",
  );
  for (const voice of voices) add(voice.id, voiceLabel(voice));
  if (chosen !== "" && !voices.some((voice) => voice.id === chosen)) add(chosen, "Saved voice");
  select.replaceChildren(...options);
  select.value = chosen;
}
