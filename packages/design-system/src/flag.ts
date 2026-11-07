/**
 * The Flag: a country's flag drawn from the Flagpack art in public/flags/ (one file per ISO 3166-1
 * code, fetched only when a flag is drawn), the same on every system. Windows draws no flag emoji,
 * only two letters ("country flags are not rendered well on windows", owner, 2026-10-25), so a flag
 * is never left to the system's emoji font (D367): a region code, or text that holds a flag emoji (a
 * topic's emoji, a toast's words), goes through this file. The one place its classes are written;
 * Flag.astro renders from it and the rules are in styles/flag.css.
 */
import type { Guidance } from "./guidance";

export const FLAG: Guidance = {
  summary: "A country's flag, the same art on every system.",
  useWhen: [
    "A place or an accent is named and its country's flag stands beside it: a voice's accent.",
    "Text that may hold a flag emoji is drawn: a topic's emoji, a toast that names a place.",
  ],
  dontUseWhen: [
    {
      when: "The flag would stand alone, with no name or words beside it.",
    },
  ],
};

/** Every class the Flag draws, for the registry and its test. */
export const FLAG_CLASSES: string[] = ["flag-mark", "flag-inline", "flag-badge"];

/** Classes the Flag replaced; none may be written again, in any app that draws the system. */
export const FLAG_RETIRED: string[] = [];

/** Where a region's art is served ("SE" gives /flags/se.svg). */
export const flagSrc = (region: string): string => `/flags/${region.toLowerCase()}.svg`;

/** A flag's classes: in a row of controls it keeps the 16 by 12 box; in text it scales with the words. */
export const flagClass = (inText = false): string =>
  inText ? "flag-mark flag-inline" : "flag-mark";

/** The flag emoji Flagpack has no art for: drawn as the badge, never fetched (a 404 each). */
const NO_ART = new Set("AC BQ CP DG EA EU IC TA UN XK".split(" "));

/** Whether a region has art in public/flags/; one without shows the badge. */
export const hasFlagArt = (region: string): boolean => !NO_ART.has(region);

/** The classes of the badge drawn for a region without art: its two letters (data-code), small. */
export const flagBadgeClass = (inText = false): string => `${flagClass(inText)} flag-badge`;

/**
 * A region code without art shows a small badge of its two letters, never a broken image. Hidden
 * from assistive tech: the words beside a flag carry the meaning.
 */
function badge(region: string, inText: boolean): HTMLElement {
  const mark = document.createElement("span");
  mark.className = flagBadgeClass(inText);
  mark.dataset.code = region;
  mark.setAttribute("aria-hidden", "true");
  return mark;
}

/** A region's flag as an element. */
export function flagNode(region: string, inText = false): HTMLElement {
  if (!hasFlagArt(region)) return badge(region, inText);
  const image = document.createElement("img");
  image.className = flagClass(inText);
  image.src = flagSrc(region);
  image.alt = "";
  image.setAttribute("aria-hidden", "true");
  image.decoding = "async";
  // A list of flags (the emoji picker's) fetches only the ones scrolled near.
  image.loading = "lazy";
  image.addEventListener("error", () => image.replaceWith(badge(region, inText)), { once: true });
  return image;
}

const FLAG_EMOJI = /([\u{1F1E6}-\u{1F1FF}]{2})/u;

/** The region a flag emoji stands for ("🇸🇪" gives "SE"), or null for anything else. */
export function flagRegion(text: string): string | null {
  if (!/^[\u{1F1E6}-\u{1F1FF}]{2}$/u.test(text)) return null;
  return [...text]
    .map((char) => String.fromCharCode((char.codePointAt(0) ?? 0) - 0x1f1a5))
    .join("");
}

/**
 * Text split into its words and the flags it holds: "You're in India 🇮🇳" gives "You're in India"
 * and { region: "IN" }. A script or an island draws each part; a flag part is the Flag, never the
 * emoji. The space before a flag is dropped: flag.css sets that gap on the 8pt grid, where a word
 * space is the font's width (3px in Google Sans Flex, owner 2026-11-05).
 */
export function flagParts(text: string): Array<string | { region: string }> {
  const parts = text
    .split(FLAG_EMOJI)
    .filter(Boolean)
    .map((part) => {
      const region = flagRegion(part);
      return region ? { region } : part;
    });
  return parts
    .map((part, index) =>
      typeof part === "string" && typeof parts[index + 1] === "object" ? part.trimEnd() : part,
    )
    .filter((part) => part !== "");
}

/**
 * Draws text that may hold a flag emoji into an element, its flags as the Flag, and keeps the text
 * itself on the element (data-text) for whoever reads it back (the emoji picker's current pick).
 */
export function showText(element: HTMLElement, text: string): void {
  element.dataset.text = text;
  element.replaceChildren(
    ...flagParts(text).map((part) =>
      typeof part === "string" ? part : flagNode(part.region, true),
    ),
  );
}

/** The text an element shows, as showText (or the page) wrote it. */
export const shownText = (element: Element): string =>
  (element instanceof HTMLElement ? element.dataset.text : undefined) ??
  element.textContent?.trim() ??
  "";
