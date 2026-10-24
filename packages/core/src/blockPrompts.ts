import { VOICE_LIMITS } from "./digest.js";
import type { StructureBlock, StructureKind } from "./structure.js";

/**
 * The built-in prompt of each block a model writes (D177), which the owner may replace in full per
 * kind on the Preferences page. The engine reads these same strings, so what the page shows as
 * the default is exactly what the writer is told. The output format and the handling of source
 * text stay in code: they are how the reply is read, not how a story is told.
 */

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
  'A block headed "Alexandria facts" is sourced records from a data provider. A fact taken from it must name that provider in the sentence ("per <provider>").',
  // Seen in the October weekly: "The catch: the piece doesn't include new evidence" and a catch
  // after a missile strike that killed a person.
  'Tell the news, never review the article: no "the piece", "the post" or "the author doesn\'t say".',
  "When the news is a death, an attack, a disaster or other harm, tell it plainly and end on the latest fact: no catch and no twist.",
  "Write plain sentences: no markdown, no links, no quotation marks around a field, no labels such as 'Summary:'.",
].join(" ");

/**
 * How a daily or weekly story is written: the fields and the rules on facts. The voice comes from
 * config/voice.md and is kept apart, as is the reply's JSON shape.
 */
export const BRIEFING_STORY_PROMPT = ["FIELDS", FIELD_RULES, "", "RULES", FACT_RULES].join("\n");

/** How Catch up tells a story block: the two tellings the planner chooses between. */
export const CATCH_UP_STORY_PROMPT =
  "A deep dive is what happened, why it matters, and one concrete detail from the block. A nugget is the news in a sentence or two, nothing more, facts only.";

export const CATCH_UP_HELLO_PROMPT = "A one-line hello that says the show is Singularity.";

export const CATCH_UP_RUNDOWN_PROMPT =
  "Name the stories it leads with in order, one short clause each, so the listener knows what is coming. No throat-clearing and no detail yet.";

export const CATCH_UP_CLOSE_PROMPT =
  'One or two thought-provoking questions or implications, drawn only from the stories just told. You may also pass on what the sources themselves report people saying, but only when a story block contains a reaction or a quote. Never invent an opinion, a reaction or a "people are saying" that the story blocks do not state. Do not summarise the episode again.';

export const CATCH_UP_SIGN_OFF_PROMPT = "A one-line sign-off.";

/** Most characters a block's prompt may hold: the built-in story prompt with room to spare. */
export const BLOCK_PROMPT_MAX = 6000;

/** The name a block's prompt is kept under: its type, or `section:<id>` for a section. */
export function blockPromptKey(block: StructureBlock): string {
  return block.type === "section" ? `section:${block.id}` : block.type;
}

const STORY_BLOCKS: readonly StructureBlock["type"][] = [
  "section",
  "top_picks",
  "trending",
  "release_news",
];

/**
 * The block's built-in prompt in this kind, or null when no model writes it: in a daily or weekly
 * episode the hello, rundown and sign-off are spoken by code, and an owner block's brief is its
 * prompt.
 */
export function defaultBlockPrompt(kind: StructureKind, block: StructureBlock): string | null {
  if (block.type === "custom") return null;
  if (kind !== "catch_up") return STORY_BLOCKS.includes(block.type) ? BRIEFING_STORY_PROMPT : null;
  switch (block.type) {
    case "hello":
      return CATCH_UP_HELLO_PROMPT;
    case "rundown":
      return CATCH_UP_RUNDOWN_PROMPT;
    case "close":
      return CATCH_UP_CLOSE_PROMPT;
    case "sign_off":
      return CATCH_UP_SIGN_OFF_PROMPT;
    default:
      return CATCH_UP_STORY_PROMPT;
  }
}
