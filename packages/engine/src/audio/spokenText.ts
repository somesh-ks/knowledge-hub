import type { Digest, DigestItem, Section } from "@dispatch/core";
import { longDate, SECTION_TITLES, SECTIONS } from "@dispatch/core";

/**
 * Speechify accepts 20,000 characters per stream request. The plan fails closed at 19,000 instead
 * of splitting, so a single request always carries the whole digest and offsets stay global.
 */
export const MAX_SPOKEN_CHARS = 19_000;

const COUNT_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
] as const;

/** Character range of one item inside the spoken string, end exclusive. */
export interface SpokenRange {
  id: string;
  section: Section;
  start: number;
  end: number;
}

export interface SpokenSectionStart {
  slug: Section;
  start: number;
}

export interface SpokenText {
  text: string;
  ranges: SpokenRange[];
  sectionStarts: SpokenSectionStart[];
}

export class SpokenTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpokenTextError";
  }
}

export class SpokenTextTooLongError extends SpokenTextError {
  readonly length: number;
  readonly limit: number;

  constructor(length: number, limit: number) {
    super(`Spoken text is ${length} characters, above the ${limit} character limit`);
    this.name = "SpokenTextTooLongError";
    this.length = length;
    this.limit = limit;
  }
}

/** The count as a word up to eighteen (the weekly cap), digits beyond that. */
function countWord(count: number): string {
  const word = COUNT_WORDS[count];
  return word ?? String(count);
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function openingLine(digest: Digest): string {
  const name = digest.kind === "weekly" ? "Dispatch weekly" : "Dispatch";
  const count = digest.items.length;
  const noun = count === 1 ? "item" : "items";
  return `${name}, ${longDate(digest.date)}. ${capitalize(countWord(count))} ${noun}.`;
}

/** Terminal punctuation keeps the voice from running two fields together. */
function asSentence(text: string): string {
  // A field that trails off with a colon or comma still ends as a sentence, not as ":.".
  const trimmed = text.replace(/[:;,]+$/, "");
  return /[.!?]["')\]]*$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function itemBlock(item: DigestItem): string {
  const parts = [item.headline, item.summary, item.why]
    .map((field) => toSpeech(field))
    .filter((field) => field.length > 0)
    .map(asSentence);
  if (parts.length === 0) {
    throw new SpokenTextError(`Item ${item.id} has no speakable text`);
  }
  return parts.join(" ");
}

/**
 * Assemble the narration from the digest fields with exact character ranges per item.
 *
 * Voice: one opening line, the section name as the only transition, then headline, summary and
 * why as plain sentences. No "Why:" prefix, no URLs, no markdown, no outro. Items are narrated in
 * section order (the order the page shows them), keeping digest order inside a section. Ranges and
 * section starts index exactly into `text`, which is what Speechify receives as `input`.
 */
export function buildSpokenText(digest: Digest): SpokenText {
  const ranges: SpokenRange[] = [];
  const sectionStarts: SpokenSectionStart[] = [];
  let text = openingLine(digest);

  for (const section of SECTIONS) {
    const items = digest.items.filter((item) => item.section === section);
    if (items.length === 0) continue;
    text += "\n\n";
    sectionStarts.push({ slug: section, start: text.length });
    text += `${toSpeech(SECTION_TITLES[section])}.`;
    for (const item of items) {
      text += "\n\n";
      const start = text.length;
      text += itemBlock(item);
      ranges.push({ id: item.id, section, start, end: text.length });
    }
  }

  if (text.length > MAX_SPOKEN_CHARS)
    throw new SpokenTextTooLongError(text.length, MAX_SPOKEN_CHARS);
  return { text, ranges, sectionStarts };
}

function stripMarkdown(input: string): string {
  return (
    input
      // Links and images keep their label; the URL is never spoken.
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Keep punctuation that trailed the URL so its sentence still pauses where it did.
      .replace(/\b(?:https?:\/\/|www\.)[^\s)\]>"']+/gi, (url) => url.match(/[.,;:!?]+$/)?.[0] ?? "")
      .replace(/\(\s*\)/g, "")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/(\*{1,3})(\S(?:[^*]*\S)?)\1/g, "$2")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/^\s*(?:#{1,6}|[-+]|\*)\s+/gm, "")
  );
}

function expandAbbreviations(input: string): string {
  return input
    .replace(/\be\.g\./gi, "for example")
    .replace(/\bi\.e\./gi, "that is")
    .replace(/\bvs\.?(?=\s)/gi, "versus")
    .replace(/\bw\/o\b/gi, "without")
    .replace(/\bw\/(?=\s)/gi, "with")
    .replace(/\bw\/(?=\w)/gi, "with ")
    .replace(/\bapprox\./gi, "approximately")
    .replace(/\betc\.(?=\s+[A-Z"'(]|\s*$)/g, "et cetera.")
    .replace(/\betc\./g, "et cetera");
}

/** "v4" becomes "version 4", and "1.2.3" is read with "point" between the parts. */
function expandVersions(input: string): string {
  return input
    .replace(/\bv(\d+(?:\.\d+)*)\b/g, "version $1")
    .replace(/\b\d+(?:\.\d+){2,}\b/g, (match) => match.split(".").join(" point "));
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function expandSlashes(input: string): string {
  return input
    .replace(/\band\/or\b/gi, "and or")
    .replace(/\s+\/\s+/g, " slash ")
    .replace(/(?<=[\p{L}\p{N}])\/(?=[\p{L}\p{N}])/gu, (match, offset: number, whole: string) =>
      // 24/7 and 10/12 stay as written; the voice already reads those.
      isDigit(whole[offset - 1]) && isDigit(whole[offset + 1]) ? match : " slash ",
    );
}

/**
 * Normalize one field for narration without changing what it says. Idempotent. Strips anything the
 * voice should never read aloud (markdown, URLs, emoji) and respells what a text-to-speech engine
 * tends to mangle (ampersands, slashes between words, version numbers, abbreviations).
 */
export function toSpeech(input: string): string {
  let out = input.normalize("NFC");
  out = out
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
  out = stripMarkdown(out);
  // Emoji and other astral characters are dropped so UTF-16 and code point offsets agree.
  out = out
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\u200D\uFE0F]/g, "")
    // Astral letters such as mathematical double-struck "X" fold to ASCII; the rest are dropped.
    .replace(/[\u{10000}-\u{10FFFF}]/gu, (char) => {
      const folded = char.normalize("NFKC");
      return /^[\x20-\x7E]+$/.test(folded) ? folded : "";
    });
  // An en dash between numbers is a range. Any other dash is a comma pause, or nothing straight
  // after a full stop; the voice rules ban dashes in copy anyway.
  out = out
    .replace(/(?<=\d[A-Za-z%]?)\s*\u2013\s*(?=[$\u00A3\u20AC]?\d)/g, " to ")
    .replace(/([.!?])\s*[\u2014\u2013]\s*/g, "$1 ")
    .replace(/\s*[\u2014\u2013]\s*/g, ", ");
  out = out.replace(/\s*(?:\u2192|->)\s*/g, " to ");
  out = expandAbbreviations(out);
  out = expandVersions(out);
  out = out.replace(/\s*&\s*/g, " and ");
  out = expandSlashes(out);
  // A bare angle bracket would be read as SSML markup by the API.
  out = out.replace(/\s*<\s*/g, " less than ").replace(/\s*>\s*/g, " greater than ");
  return out
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .trim();
}
