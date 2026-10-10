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

/** What an option reads: "Sophia, female". */
export function voiceLabel(voice: Voice): string {
  return voice.gender ? `${voice.name}, ${voice.gender.toLowerCase()}` : voice.name;
}

/**
 * Fills a voice select: the default first (value ""), then the voices, then the saved voice when it
 * is not among them, so a stored choice is never silently swapped for another. Keeps `chosen`.
 */
export function fillVoiceSelect(
  select: HTMLSelectElement,
  voices: readonly Voice[],
  chosen: string,
): void {
  const options: HTMLOptionElement[] = [];
  const add = (value: string, text: string): void => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    options.push(option);
  };
  add("", "Default");
  for (const voice of voices) add(voice.id, voiceLabel(voice));
  if (chosen !== "" && !voices.some((voice) => voice.id === chosen)) add(chosen, "Saved voice");
  select.replaceChildren(...options);
  select.value = chosen;
}
