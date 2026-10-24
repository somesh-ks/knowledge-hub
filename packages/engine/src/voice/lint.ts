import { VOICE_LIMITS } from "@singularity/core";
import { countSentences, countWords, longSentences } from "./sentences.js";
import type { VoiceConfig } from "./voice.js";

export const VOICE_FIELDS = ["headline", "summary", "why", "spoken"] as const;
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
  | "too_many_characters"
  | "too_many_sentences"
  | "too_few_words"
  | "too_few_sentences"
  | "sentence_too_long"
  | "spoken_style"
  /** A spoken text states a number the headline and summary do not (write/spokenCheck.ts). */
  | "ungrounded_number";

export interface Violation {
  field: VoiceField;
  rule: ViolationRule;
  /** Plain-language instruction. Also used as the problem list in a rewrite request. */
  message: string;
  /** The offending text, when there is one. */
  match?: string;
  index?: number;
}

/** A softer finding: it is shown to the owner but never rewrites, drops or fails anything. */
export interface Warning {
  field: VoiceField;
  rule: "changelog_headline";
  message: string;
  match: string;
}

export interface Linter {
  lint(field: VoiceField, text: string): Violation[];
  /** Style findings that do not block. Today: a headline shaped like a changelog line. */
  warnings(field: VoiceField, text: string): Warning[];
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MIN_STEM_FOR_INFLECTION = 4;

/** The word with the regular endings a writer might use: unlock, unlocks, unlocked, unlocking. */
function withEndings(word: string): string {
  if (word.endsWith("e")) {
    const stem = word.slice(0, -1);
    // A long stem drops its e (leverage, leveraging, massively). A short one only adds (huge,
    // hugely), so "hug" and "hugs" are not caught.
    return stem.length >= MIN_STEM_FOR_INFLECTION
      ? `${escapeRegex(stem)}(?:e|es|ed|d|ing|s|ely|ly)`
      : `${escapeRegex(word)}(?:s|d|ly)?`;
  }
  return `${escapeRegex(word)}(?:s|es|ed|ing|ly)?`;
}

/**
 * Whole-word, case-insensitive matcher for one banned entry. Spaces and hyphens inside an entry
 * match each other ("game-changer" also catches "game changer"), and the last word takes regular
 * endings, so "leveraging", "seamlessly" and "deep dives" cannot slip past "leverage",
 * "seamless" and "deep dive".
 */
function bannedWordRegex(entry: string): RegExp {
  const parts = entry
    .trim()
    .toLowerCase()
    .split(/[\s-]+/)
    .filter((part) => part.length > 0);
  const last = parts.pop();
  // An entry with no letters would otherwise match the empty string everywhere.
  if (last === undefined) return /(?!)/giu;
  const head = parts.map((part) => `${escapeRegex(part)}[-\\s]+`).join("");
  return new RegExp(`(?<![\\p{L}\\p{N}])${head}${withEndings(last)}(?![\\p{L}\\p{N}])`, "giu");
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

/**
 * A name and a version number, then one of these as the verb: "Springlet 2.0 released with spring
 * retargeting". It reads as a changelog entry, not as something a person would say. A dotted or
 * "v" version is the tell; a bare number ("Phone 3 launches with ...") is usually a product name,
 * so only "released" counts after one. This only warns, because a few real headlines have that
 * shape and still read well.
 */
const CHANGELOG_VERBS = "released|releases|ships|shipped|launches|launched|adds|added|introduces";
const CHANGELOG_HEADLINE = new RegExp(
  String.raw`^(?:\p{L}[\p{L}\p{N}.+#-]*\s+){1,3}(?:(?:v\d+(?:\.\d+)*|\d+(?:\.\d+)+)(?:-[a-z]+(?:\.\d+)?)?\s+(?:${CHANGELOG_VERBS})|\d+\s+(?:released|releases))\b`,
  "iu",
);

/**
 * Phrases a host would not say. The telling is about the product or the people who made it, never
 * about "we", and it never refers to itself as a story or an episode.
 */
const SPOKEN_STYLE: ReadonlyArray<{ regex: RegExp; message: string }> = [
  {
    regex: /\b(?:in this (?:story|episode|briefing|segment)|this story|this episode)\b/gi,
    message: "Do not refer to the telling itself; start with the news.",
  },
  {
    regex: /\b(?:we|we're|we've|we'll|our|ours|let's)\b/gi,
    message: "Do not speak as the product or the team; the host reports what happened.",
  },
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

interface FieldLimits {
  words: number;
  sentences: number | null;
  /** A ceiling in characters, for text that is spoken. */
  chars?: number;
  /** Lower bounds and the per-sentence cap. Only the summary and the spoken text have them. */
  minWords?: number;
  minSentences?: number;
  sentenceWords?: number;
}

function limitsFor(field: VoiceField): FieldLimits {
  switch (field) {
    case "headline":
      return { words: VOICE_LIMITS.headlineWords, sentences: null };
    case "summary":
      return {
        words: VOICE_LIMITS.summaryWords,
        sentences: VOICE_LIMITS.summarySentences,
        minWords: VOICE_LIMITS.summaryMinWords,
        minSentences: VOICE_LIMITS.summaryMinSentences,
        sentenceWords: VOICE_LIMITS.sentenceWords,
      };
    // Only digests written before the four-beat voice carry a why line.
    case "why":
      return { words: VOICE_LIMITS.whyWords, sentences: 1 };
    case "spoken":
      return {
        words: VOICE_LIMITS.spokenWords,
        chars: VOICE_LIMITS.spokenChars,
        sentences: VOICE_LIMITS.spokenSentences,
        minWords: VOICE_LIMITS.spokenMinWords,
        minSentences: VOICE_LIMITS.spokenMinSentences,
        sentenceWords: VOICE_LIMITS.sentenceWords,
      };
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
          // The matched text is not quoted here: it came from the source, and messages are prompt text.
          // It stays in `match`, and the rewrite request passes it as delimited data.
          add(
            "banned_pattern",
            `Rewrite the passage that matches the banned pattern ${source}.`,
            hit,
          );
        }
      }

      if (field === "spoken") {
        for (const { regex, message } of SPOKEN_STYLE) {
          for (const hit of hits(regex, text)) add("spoken_style", message, hit);
        }
      }

      const limits = limitsFor(field);
      const words = countWords(text);
      if (words > limits.words) {
        add("too_many_words", `The ${field} has ${words} words; the limit is ${limits.words}.`);
      }
      if (limits.chars !== undefined && text.length > limits.chars) {
        add(
          "too_many_characters",
          `The ${field} has ${text.length} characters; the limit is ${limits.chars}. Use shorter words or fewer of them.`,
        );
      }
      if (limits.minWords !== undefined && words < limits.minWords) {
        add(
          "too_few_words",
          `The ${field} has ${words} words; it needs at least ${limits.minWords}.`,
        );
      }
      if (limits.sentences !== null) {
        const sentences = countSentences(text);
        if (sentences > limits.sentences) {
          add(
            "too_many_sentences",
            `The ${field} has ${sentences} sentences; the limit is ${limits.sentences}.`,
          );
        }
        if (limits.minSentences !== undefined && sentences < limits.minSentences) {
          add(
            "too_few_sentences",
            `The ${field} has ${sentences} ${sentences === 1 ? "sentence" : "sentences"}; it needs at least ${limits.minSentences}.`,
          );
        }
      }
      if (limits.sentenceWords !== undefined) {
        // The sentence came from the source, so it stays out of the message and travels in `match`.
        for (const long of longSentences(text, limits.sentenceWords)) {
          found.push({
            field,
            rule: "sentence_too_long",
            message: `A sentence in the ${field} has ${long.words} words; split it so no sentence runs past ${limits.sentenceWords}.`,
            match: long.sentence,
          });
        }
      }
      return found;
    },
    warnings(field, rawText) {
      if (field !== "headline") return [];
      const text = normalizeQuotes(rawText).trim();
      const hit = CHANGELOG_HEADLINE.exec(text);
      if (!hit) return [];
      return [
        {
          field,
          rule: "changelog_headline",
          message:
            "The headline reads like a changelog line. Say what happened and why a reader would care, with a real verb.",
          match: hit[0],
        },
      ];
    },
  };
}

/** One-off lint. Prefer createLinter when linting many fields. */
export function lint(field: VoiceField, text: string, config: VoiceConfig): Violation[] {
  return createLinter(config).lint(field, text);
}
