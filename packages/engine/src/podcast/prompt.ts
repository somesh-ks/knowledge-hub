import type { PodcastFormat, PodcastRequest } from "@dispatch/core";
import { untrustedInstruction, wrapUntrusted } from "../llm/untrusted.js";
import {
  perStoryChars,
  reachableChars,
  scriptFloorChars,
  scriptTargetChars,
  WORDS_PER_SENTENCE,
  wordsFor,
} from "./plan.js";
import type { PodcastStory, ScriptInput, TurnRewrite } from "./types.js";

const TONES: Record<PodcastRequest["tone"], string> = {
  neutral: "Plain and even, like a good radio news reader. No excitement, no irony.",
  energetic:
    "Upbeat and quick, with a little more emphasis and momentum. Still no hype words and no exclamation marks in a row.",
  dry: "Understated and deadpan. Humor, if any, comes from restraint. Never sarcastic about the facts.",
};

const FORMATS: Record<PodcastFormat, string> = {
  readout: [
    'FORMAT: readout. One host, speaker "a" only.',
    "Open with one or two sentences that say the show is Singularity and what today's episode covers.",
    "Then tell each story in the order given, in a natural spoken voice, in one or two turns of several sentences each: what happened, the detail or number that matters, why it matters to the listener, and the catch or what to watch next, each only as far as the block supports. End a story with a short bridge into the next.",
    "Close with one short sign-off sentence.",
  ].join(" "),
  discussion: [
    'FORMAT: discussion. Two hosts. Speaker "a" leads, speaker "b" reacts.',
    'The first turn is "a" and says the show is Singularity. The last turn is "a" with a short sign-off.',
    'For each story, in the order given, six to eight turns: "a" introduces it in two or three sentences, "b" reacts and asks the obvious question, "a" answers from the summary in two or three sentences, "b" puts in plain words what that means in practice, "a" adds the catch if the summary has one, and "b" closes the story with a short thought that leads on.',
    'Turns alternate between "a" and "b" and run two to four sentences each; a one-word or one-line reaction is not a turn.',
    'A host may say what a fact could mean for the listener, clearly as their own view ("that sounds like", "I would want to know"), never as a fact about the product, the company or anyone\'s motive. Neither host invents a fact, a number, a quote or a motive.',
  ].join(" "),
  headlines: [
    'FORMAT: headlines. One host, speaker "a" only.',
    "Open with one sentence that says the show is Singularity.",
    "Then give each story in the order given in one or two short sentences, one turn per story.",
    "Close with a five-word sign-off at most.",
  ].join(" "),
};

/**
 * Who the script is for. "custom" is the owner, a design engineer, and is today's behaviour: the
 * prompt says nothing more. "general" is anyone, so a term is explained the first time it is used
 * and insider shorthand is left out.
 */
export const AUDIENCES: Record<NonNullable<PodcastRequest["audience"]>, string> = {
  custom: "",
  general:
    "AUDIENCE: a general listener with no background in design or software. Explain any technical term, product name or acronym the first time you use it, in a few plain words. Leave out insider shorthand and jargon. Never talk down to the listener, and add no fact the story blocks do not state, even to explain a term: explain by describing what the thing does, not by adding claims about it.",
};

const RULES = [
  "The listener hears this script read aloud, so write for the ear: short sentences, contractions allowed, no markdown, no lists, no links, no stage directions, no emoji, no em dashes.",
  "Use facts from the story blocks only. Never add a claim, number, name, date, quote or link that a block does not state. If a block lacks a detail, leave it out.",
  "Write a number only as digits and only when it appears in that story's headline or summary; a checker rejects any other number. Do not use digits in the opening or the sign-off.",
  "Say a source's name only when it helps, never read out a URL.",
  "Tone changes wording only, never the facts.",
].join("\n");

/**
 * The length, said in words and sentences. It aims at what the stories can carry (see
 * reachableChars), so the writer is never asked to stretch a few short summaries over a long episode.
 */
export function lengthLines(input: ScriptInput): string[] {
  const stories = input.stories.length;
  const reach = reachableChars(input.budget_chars, stories, input.request.format);
  const perStory = wordsFor(perStoryChars(reach, stories));
  const sentences = Math.max(1, Math.round(perStory / WORDS_PER_SENTENCE));
  return [
    `Write about ${wordsFor(scriptTargetChars(reach))} words in total, all turns together, and no more than ${wordsFor(reach)}. A script under ${wordsFor(scriptFloorChars(reach))} words is rejected as too short.`,
    `That is about ${perStory} words on each of the ${stories} stories, after a short opening and sign-off. A spoken sentence is about ${WORDS_PER_SENTENCE} words, so give each story about ${sentences} sentences.`,
    "Reach that length with substance: say what happened, who is involved, the detail or number that matters, why it matters, and what the summary gives as the catch. Use only the facts in the story block. Never pad with filler and never repeat a fact.",
    "If the stories still would not fit, leave out the last ones; never cut a story halfway.",
  ];
}

export function scriptSystemPrompt(input: ScriptInput, boundary: string): string {
  const { request } = input;
  return [
    request.audience === "general"
      ? "You write the script of one episode of Singularity, a news podcast for a general audience."
      : "You write the script of one episode of Singularity, a private tech and design briefing that people listen to as a podcast.",
    FORMATS[request.format],
    `TONE: ${TONES[request.tone]}`,
    ...(AUDIENCES[request.audience ?? "custom"] ? [AUDIENCES[request.audience ?? "custom"]] : []),
    "RULES",
    RULES,
    "LENGTH",
    ...lengthLines(input),
    "OUTPUT",
    'Answer with JSON only: {"turns":[{"speaker":"a","text":"...","item_id":"..."}]}.',
    'Put the story\'s id, copied exactly from its block, in "item_id" on every turn about that story. Leave "item_id" out of the opening and sign-off turns.',
    untrustedInstruction(boundary),
  ].join("\n");
}

function storyBlock(story: PodcastStory, boundary: string): string {
  return wrapUntrusted(
    [
      `Headline: ${story.headline}`,
      `Source: ${story.source}`,
      `Topic: ${story.section}`,
      `Summary: ${story.summary}`,
    ].join("\n"),
    boundary,
    story.item_id,
  );
}

export function scriptUserMessage(
  input: ScriptInput,
  boundary: string,
  problems: readonly string[],
): string {
  const lines = [
    `Episode: ${input.request.title ?? "untitled"}. ${input.request.length_minutes} minutes, ${input.stories.length} stories.`,
    "",
    ...input.stories.map((story) => storyBlock(story, boundary)),
  ];
  if (problems.length > 0) {
    lines.push(
      "",
      "Your previous reply was rejected. Fix these problems and answer again with the whole script:",
      ...problems.map((problem) => `- ${problem}`),
    );
  }
  return lines.join("\n");
}

export function rewriteSystemPrompt(boundary: string): string {
  return [
    "You rewrite one line of a podcast script so that it keeps to the facts of its story.",
    RULES,
    'Keep the line\'s meaning, its voice and about its length. Answer with JSON only: {"text":"..."}.',
    untrustedInstruction(boundary),
  ].join("\n");
}

export function rewriteUserMessage(input: TurnRewrite, boundary: string): string {
  const facts = input.story
    ? [storyBlock(input.story, boundary)]
    : input.stories.map((story) => storyBlock(story, boundary));
  return [...facts, "", `Line to rewrite: ${input.text}`, `Problem: ${input.problem}`].join("\n");
}
