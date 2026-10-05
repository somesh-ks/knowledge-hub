import { VOICE_LIMITS } from "@dispatch/core";
import { countSentences, countWords } from "./sentences.js";
import type { VoiceConfig } from "./voice.js";

export const VOICE_FIELDS = ["headline", "summary", "why"] as const;
export type VoiceField = (typeof VOICE_FIELDS)[number];

export type ViolationRule =
  | "empty"
  | "banned_word"
  | "banned_pattern"
  | "dash"
  | "exclamation"
  | "question"
  | "emoji"
  | "markdown"
  | "link"
  | "too_many_words"
  | "too_many_sentences";

export interface Violation {
  field: VoiceField;
  rule: ViolationRule;
  /** Plain-language instruction. Also used as the problem list in a rewrite request. */
  message: string;
  /** The offending text, when there is one. */
  match?: string;
  index?: number;
}

export interface Linter {
  lint(field: VoiceField, text: string): Violation[];
}

function escapeRegex(text: string): string {
  return text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
}

const MIN_STEM_FOR_INFLECTION = 4;

/**
 * Whole-word, case-insensitive matcher for one banned entry. A single word also matches its
 * regular inflections (unlock: unlocks, unlocked, unlocking), so "leveraging" cannot slip past
 * "leverage". Phrases and hyphenated entries match exactly.
 */
function bannedWordRegex(entry: string): RegExp {
  const phrase = entry.trim().toLowerCase();
  const body = phrase.split(/\s+/).map(escapeRegex).join("\\s+");
  let inflected = body;
  if (!/\s/.test(phrase) && !phrase.includes("-")) {
    const stem = phrase.slice(0, -1);
    if (phrase.endsWith("e") && stem.length >= MIN_STEM_FOR_INFLECTION) {
      inflected = `${escapeRegex(stem)}(?:e|es|ed|d|ing|s)`;
    } else if (!phrase.endsWith("e")) {
      inflected = `${body}(?:s|es|ed|ing)?`;
    }
  }
  return new RegExp(`(?<![\\p{L}\\p{N}])${inflected}(?![\\p{L}\\p{N}])`, "giu");
}

const DASH = /[\u2014\u2013]|\s--\s/g;
const EXCLAMATION = /!/g;
const QUESTION = /\?/g;
const EMOJI =
  /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3/gu;

interface MarkupRule {
  rule: "markdown" | "link";
  label: string;
  regex: RegExp;
}

const MARKUP_RULES: readonly MarkupRule[] = [
  { rule: "link", label: "a Markdown link", regex: /!?\[[^\]\n]*\]\([^)\n]*\)/g },
  { rule: "link", label: "a URL", regex: /\b(?:https?:\/\/|www\.)\S+/gi },
  { rule: "markdown", label: "inline code", regex: /`/g },
  { rule: "markdown", label: "bold", regex: /(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g },
  { rule: "markdown", label: "italics", regex: /(?<![*\w])\*(?!\s)[^*\n]+?(?<!\s)\*(?![*\w])/g },
  { rule: "markdown", label: "italics", regex: /(?<![\w])_(?!\s)[^_\n]+?(?<!\s)_(?![\w])/g },
  { rule: "markdown", label: "a heading", regex: /^\s{0,3}#{1,6}\s/gm },
  { rule: "markdown", label: "a list marker", regex: /^\s*(?:[-*+]|\d+[.)])\s+/gm },
  { rule: "markdown", label: "a quote marker", regex: /^\s*>\s/gm },
  { rule: "markdown", label: "an HTML tag", regex: /<\/?[a-z][^>]*>/gi },
];

function normalizeQuotes(text: string): string {
  return text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
}

interface Hit {
  match: string;
  index: number;
}

function hits(regex: RegExp, text: string): Hit[] {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const found: Hit[] = [];
  for (const m of text.matchAll(new RegExp(regex.source, flags))) {
    found.push({ match: m[0], index: m.index ?? 0 });
  }
  return found;
}

function limitsFor(field: VoiceField): { words: number; sentences: number | null } {
  switch (field) {
    case "headline":
      return { words: VOICE_LIMITS.headlineWords, sentences: null };
    case "summary":
      return { words: VOICE_LIMITS.summaryWords, sentences: VOICE_LIMITS.summarySentences };
    case "why":
      return { words: VOICE_LIMITS.whyWords, sentences: 1 };
    default: {
      const unreachable: never = field;
      throw new Error(`Unhandled voice field: ${String(unreachable)}`);
    }
  }
}

/** Compile the banned lists once and lint any number of fields. */
export function createLinter(config: VoiceConfig): Linter {
  const wordRegexes = config.bannedWords.map((entry) => ({ entry, regex: bannedWordRegex(entry) }));
  return {
    lint(field, rawText) {
      const text = normalizeQuotes(rawText);
      const found: Violation[] = [];
      const add = (rule: ViolationRule, message: string, hit?: Hit): void => {
        found.push({
          field,
          rule,
          message,
          ...(hit ? { match: hit.match, index: hit.index } : {}),
        });
      };

      if (text.trim().length === 0) {
        add("empty", `The ${field} is empty.`);
        return found;
      }

      for (const { regex } of wordRegexes) {
        for (const hit of hits(regex, text)) {
          add("banned_word", `Remove the banned word or phrase "${hit.match}".`, hit);
        }
      }
      for (const hit of hits(DASH, text)) {
        add("dash", "Remove the em or en dash; use a comma, colon or period.", hit);
      }
      for (const hit of hits(EXCLAMATION, text))
        add("exclamation", "Remove the exclamation mark.", hit);
      for (const hit of hits(QUESTION, text)) {
        add("question", "Do not ask a question; state the fact plainly.", hit);
      }
      for (const hit of hits(EMOJI, text)) add("emoji", "Remove the emoji.", hit);
      for (const { rule, label, regex } of MARKUP_RULES) {
        for (const hit of hits(regex, text)) {
          add(rule, `Remove ${label}; fields hold plain sentences only.`, hit);
        }
      }

      // Config patterns last, so a dash or "!" already reported by a dedicated rule is not repeated.
      for (const { source, regex } of config.bannedPatterns) {
        for (const hit of hits(regex, text)) {
          if (found.some((v) => v.index === hit.index && v.match === hit.match)) continue;
          add(
            "banned_pattern",
            `Rewrite the text "${hit.match.trim()}"; it matches the banned pattern ${source}.`,
            hit,
          );
        }
      }

      const limits = limitsFor(field);
      const words = countWords(text);
      if (words > limits.words) {
        add("too_many_words", `The ${field} has ${words} words; the limit is ${limits.words}.`);
      }
      if (limits.sentences !== null) {
        const sentences = countSentences(text);
        if (sentences > limits.sentences) {
          add(
            "too_many_sentences",
            `The ${field} has ${sentences} sentences; the limit is ${limits.sentences}.`,
          );
        }
      }
      return found;
    },
  };
}

/** One-off lint. Prefer createLinter when linting many fields. */
export function lint(field: VoiceField, text: string, config: VoiceConfig): Violation[] {
  return createLinter(config).lint(field, text);
}
