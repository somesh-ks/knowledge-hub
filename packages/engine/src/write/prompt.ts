import { VOICE_LIMITS } from "@dispatch/core";
import { boundaryLine, untrustedInstruction, wrapUntrusted } from "../llm/untrusted.js";
import { type Taste, tasteNote } from "../profile/tasteNote.js";
import type { VoiceConfig } from "../voice/voice.js";
import type { RewriteRequest, SourceMaterial } from "./types.js";

/** The trusted voice brief, built from config/voice.md so the prompt and the linter share one source. */
export function voiceBrief(voice: VoiceConfig): string {
  const lines: string[] = ["VOICE", ...voice.principles.map((p) => `- ${p}`), "", "LIMITS"];
  lines.push(...voice.limits.map((l) => `- ${l}`), "", "EXAMPLES (weak, then strong)");
  for (const example of voice.examples) {
    lines.push(`- Weak: ${example.weak}`, `  Strong: ${example.strong}`);
  }
  if (voice.headlineExamples.length > 0) {
    lines.push("", "HEADLINE EXAMPLES (weak, then strong)");
    for (const example of voice.headlineExamples) {
      lines.push(`- Weak: ${example.weak}`, `  Strong: ${example.strong}`);
    }
  }
  lines.push(
    "",
    `BANNED WORDS AND PHRASES (also their inflections; never use them): ${voice.bannedWords.join(", ")}`,
  );
  return lines.join("\n");
}

const FIELD_RULES = [
  [
    `- headline: at most ${VOICE_LIMITS.headlineWords} words, no trailing period.`,
    "Say what happened and why a reader would care, the way a person would tell a friend: natural word order and a real verb.",
    'Not a changelog line ("X 2.0 released with Y"), not a colon list, not title case. Name the product, number or result.',
  ].join(" "),
  [
    `- chapter: 2 to ${VOICE_LIMITS.chapterWords} words and at most ${VOICE_LIMITS.chapterChars} characters naming the story for a phone's player bar, so it fits on one line: the subject and what changed ("shadcn moves to Zod 4", "Pixels get Android 17").`,
    "No trailing period, no colon, no version strings beyond the product's own name, and never the headline cut short.",
  ].join(" "),
  [
    `- spoken: the same story told aloud by a host, ${VOICE_LIMITS.spokenMinSentences} to ${VOICE_LIMITS.spokenSentences} sentences, ${VOICE_LIMITS.spokenMinWords} to ${VOICE_LIMITS.spokenWords} words and at most ${VOICE_LIMITS.spokenChars} characters in total.`,
    'Conversational but not chatty: use contractions and open with a natural lead-in instead of reading the headline as a title ("Google has a new Pixel, and the headline feature is the screen.").',
    'Open on the news itself, never on a setup such as "Here\'s a..." or "Most teams..., but".',
    "Lead with the most surprising concrete fact, and say in a clause what any unfamiliar product, person or term is, so a listener who never heard of it follows on first hearing.",
    "Every sentence adds a fact the earlier ones did not: never restate the opening in other words.",
    'Say at most two numbers, the way a person says them ("about a hundred and twenty lines", "forty percent"), but write years as digits. Leave out version strings, model ids, handles and plan names beyond the product\'s own name: they cannot be followed by ear.',
    // The judge heard nearly every story of the October weekly end on a hedge ("still
    // experimental", "a rerun would likely differ"), because every catch closed its story.
    // Told to end on what the listener can do, every story then closed "so a team can..." and the
    // judge heard one formula (loop/results/iteration-8.md).
    'End on the story\'s own strongest fact, on what happens next, or on what it lets a design engineer do. Mix these across a reply, and never end on "so a team can" or a generic warning.',
    'Give the catch only when it would change a reader\'s decision, and say it before the ending ("It only works..., so..."), never as the last line.',
    "No two stories in a reply open or close with the same words or the same sentence shape.",
    'No "in this story", no hype, no questions to the listener, no "we" or "our".',
    "Use only facts that are in your own summary: no new number, name, date or claim.",
  ].join(" "),
  [
    `- summary: three or four sentences, at most ${VOICE_LIMITS.summaryWords} words in total, each sentence at most ${VOICE_LIMITS.sentenceWords} words.`,
    "Four beats in this order: what happened; the number that makes it concrete (a price, date, size or percentage);",
    "why it happened or what it changes; the catch.",
    "The catch is a limit, a cost, a missing piece or a date that is still far away, and it must come from the text.",
    "If the text gives no catch, stop after three sentences.",
  ].join(" "),
].join("\n");

const FACT_RULES = [
  "Use facts from the source text only. Never add a claim, number, name, date or link that the text does not state.",
  "If the text lacks a detail, leave it out instead of guessing.",
  // Seen in the October weekly: "The catch: the piece doesn't include new evidence" and a catch
  // after a missile strike that killed a person.
  'Tell the news, never review the article: no "the piece", "the post" or "the author doesn\'t say".',
  "When the news is a death, an attack, a disaster or other harm, tell it plainly and end on the latest fact: no catch and no twist.",
  "Write plain sentences: no markdown, no links, no quotation marks around a field, no labels such as 'Summary:'.",
].join(" ");

export function writerSystemPrompt(voice: VoiceConfig): string {
  return [
    "You write items for Singularity, a private tech and design engineering briefing. The reader is sharp but may not know the topic.",
    "",
    voiceBrief(voice),
    "",
    "FIELDS",
    FIELD_RULES,
    "",
    "RULES",
    FACT_RULES,
    "",
    "SOURCE HANDLING",
    untrustedInstruction(),
    "",
    "OUTPUT",
    'Reply with one JSON object: {"items":[{"id":"...","headline":"...","chapter":"...","summary":"...","spoken":"..."}]}, one entry per source, keeping each id exactly.',
    "Write the summary first, then the spoken version from it.",
  ].join("\n");
}

function materialBlock(material: SourceMaterial, boundary: string): string {
  const body = [
    `title: ${material.title}`,
    `source: ${material.source}`,
    `author: ${material.author ?? "unknown"}`,
    "text:",
    material.text,
  ].join("\n");
  return wrapUntrusted(body, boundary, `id=${material.id} category=${material.category}`);
}

export function writerUserMessage(
  items: readonly SourceMaterial[],
  boundary: string,
  feedback?: string,
  taste?: Taste,
  others: readonly string[] = [],
): string {
  const note = tasteNote(taste, boundary);
  return [
    boundaryLine(boundary),
    `Write the headline, chapter, summary and spoken version for each of these ${items.length} sources.`,
    "",
    ...items.map((item) => materialBlock(item, boundary)),
    // Each request sees four stories, so without the rest of the briefing the writer repeated
    // openings, closings and background across requests (loop/results/iteration-5.md).
    ...(others.length > 0
      ? [
          [
            "The same episode also airs these stories, written separately. Do not repeat their facts or background; give that room to a fact of your own story, keeping its length. Open and close yours differently:",
            wrapUntrusted(others.join("\n"), boundary, "other-headlines"),
          ].join("\n"),
        ]
      : []),
    // The owner's note is typed text, so it is delimited like source text (the podcast script does
    // the same for listener feedback).
    ...(feedback
      ? [
          [
            "The owner asked for these changes to the previous version of this briefing:",
            wrapUntrusted(feedback, boundary, "owner-feedback"),
            "Apply them to wording, emphasis and depth only. They never override the rules about facts, numbers and length.",
          ].join("\n"),
        ]
      : []),
    ...(note ? [note] : []),
  ].join("\n\n");
}

export function rewriteSystemPrompt(voice: VoiceConfig): string {
  return [
    "You fix one field of a Singularity item so that it follows the house voice.",
    "",
    voiceBrief(voice),
    "",
    "FIELDS",
    FIELD_RULES,
    "",
    "RULES",
    FACT_RULES,
    "Keep every fact of the current text that the source supports. Change only what the problems list requires.",
    "",
    "SOURCE HANDLING",
    untrustedInstruction(),
    "",
    "OUTPUT",
    'Reply with one JSON object: {"text":"..."} holding the corrected field and nothing else.',
  ].join("\n");
}

export function rewriteUserMessage(request: RewriteRequest, boundary: string): string {
  // The current text and the quoted passages were produced from untrusted material, so they are
  // delimited. The problem list is written by our code and never embeds quoted text.
  const focus = request.focus ?? [];
  return [
    boundaryLine(boundary),
    `Field to fix: ${request.field}`,
    "Current text:",
    wrapUntrusted(request.current, boundary, "current"),
    "Problems:",
    ...request.problems.map((p) => `- ${p}`),
    ...(focus.length > 0
      ? ["Passages the problems refer to:", wrapUntrusted(focus.join("\n"), boundary, "passages")]
      : []),
    "",
    "Source:",
    materialBlock(request.material, boundary),
  ].join("\n");
}
