import type { Digest, DigestItem } from "@dispatch/core";
import { digestSections } from "@dispatch/core";
import { openingLine, rundownLine, sectionBridge, signOff, storyConnective } from "./hostFrame.js";

/**
 * Speechify accepts 20,000 characters per stream request. The plan fails closed at 19,000 instead
 * of splitting, so a single request always carries the whole digest and offsets stay global.
 */
export const MAX_SPOKEN_CHARS = 19_000;

/** Character range of one item inside the spoken string, end exclusive. */
export interface SpokenRange {
  id: string;
  /** A section id: built in, or one the owner added. */
  section: string;
  start: number;
  end: number;
}

export interface SpokenSectionStart {
  slug: string;
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

/** Terminal punctuation keeps the voice from running two fields together. */
function asSentence(text: string): string {
  // A field that trails off with a colon or comma still ends as a sentence, not as ":.".
  const trimmed = text.replace(/[:;,]+$/, "");
  return /[.!?]["')\]]*$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * Words of four letters or more, lowercased, possessive and plural "s" cut: what a headline and a
 * sentence have in common ("Figma's" is "figma", "systems" is "system").
 */
function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.'\u2019-]*/gu) ?? [])
    .map((word) => word.replace(/['\u2019]s$/, "").replace(/(?<=[^s])s$/, ""))
    .filter((word) => word.length >= 4);
}

/**
 * True when the summary's first sentence already says the headline ("ttok 1.0 defaults to GPT-5
 * tokenizer" then "ttok 1.0 defaults to the GPT-5 tokenizer family"): read aloud one after the
 * other, the listener hears the news twice.
 */
export function summaryRestatesHeadline(headline: string, summary: string): boolean {
  const words = contentWords(headline);
  if (words.length === 0) return false;
  const first = new Set(contentWords(summary.split(/(?<=[.!?])\s+/)[0] ?? ""));
  return words.filter((word) => first.has(word)).length / words.length >= 0.5;
}

/**
 * What the host says for one story. A digest written with a spoken version reads that alone: it
 * already has its own lead-in and carries the headline's news. Without one (an older digest, or a
 * telling the voice check removed) the host reads the headline and the summary, leaving out a
 * headline the summary opens by restating, and the why line of a digest that still has one.
 */
export function itemBlock(item: DigestItem): string {
  const headline = summaryRestatesHeadline(item.headline, item.summary) ? "" : item.headline;
  const fields = item.spoken ? [item.spoken] : [headline, item.summary, item.why ?? ""];
  const parts = fields
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
 * The host frame wraps the stories: an opening that names the product, the day and the count; a
 * short bridge when the section changes, which stands where the section starts; a light connective
 * before most stories that are not the first of their section, which is part of that story's own
 * range so a story and its lead-in play as one; and a sign-off, the only text after the last story.
 * Then each story as plain sentences. No "Why:" prefix, no URLs, no markdown. Items are narrated in
 * section order (the order the page shows them), keeping digest order inside a section. Ranges and
 * section starts index exactly into `text`, which is what Speechify receives as `input`.
 */
export function buildSpokenText(digest: Digest): SpokenText {
  const ranges: SpokenRange[] = [];
  const sectionStarts: SpokenSectionStart[] = [];
  // The digest's own sections, in its own order: a topic the owner added is read like any other.
  const groups = digestSections(digest)
    .map((entry) => ({
      entry,
      section: entry.id,
      items: digest.items.filter((item) => item.section === entry.id),
    }))
    .filter((group) => group.items.length > 0);

  let text = openingLine(digest, groups[0]?.entry);
  const rundown = rundownLine(
    digest,
    groups.flatMap((group) => group.items),
  );
  if (rundown) text += ` ${toSpeech(rundown)}`;
  let previousBridge: string | null = null;
  let previousConnective: string | null = null;

  for (const [groupIndex, { entry, section, items }] of groups.entries()) {
    text += "\n\n";
    if (groupIndex === 0) {
      // The opening already said where the briefing starts, so the first section needs no bridge.
      sectionStarts.push({ slug: section, start: text.length });
    } else {
      const bridge = sectionBridge({
        digestId: digest.id,
        section: entry,
        count: items.length,
        previous: previousBridge,
      });
      previousBridge = bridge;
      sectionStarts.push({ slug: section, start: text.length });
      text += `${toSpeech(bridge)}\n\n`;
    }
    previousConnective = null;
    for (const [itemIndex, item] of items.entries()) {
      if (itemIndex > 0) text += "\n\n";
      const start = text.length;
      if (itemIndex > 0) {
        const connective = storyConnective({
          itemId: item.id,
          kind: digest.kind,
          previous: previousConnective,
        });
        previousConnective = connective === "" ? null : connective;
        if (connective !== "") text += `${connective} `;
      }
      text += itemBlock(item);
      ranges.push({ id: item.id, section, start, end: text.length });
    }
  }

  text += `\n\n${signOff(digest.kind)}`;

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
