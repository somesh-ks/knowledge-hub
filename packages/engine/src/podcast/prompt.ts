import type { PodcastFormat, PodcastRequest } from "@dispatch/core";
import { untrustedInstruction, wrapUntrusted } from "../llm/untrusted.js";
import { STORY_CHARS } from "./plan.js";
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
    "Then tell each story in the order given, in a natural spoken voice, in one or two turns, with a short bridge into the next story.",
    "Close with one short sign-off sentence.",
  ].join(" "),
  discussion: [
    'FORMAT: discussion. Two hosts. Speaker "a" leads, speaker "b" reacts.',
    'The first turn is "a" and says the show is Singularity. The last turn is "a" with a short sign-off.',
    'For each story, in the order given: "a" introduces it, "b" reacts and asks the obvious question, "a" answers from the summary, "b" adds the catch if the summary has one.',
    'Turns alternate between "a" and "b" and run one to three sentences each.',
    '"b" may only react to, question or restate what the summary supports. Neither host invents a fact, a number, a quote or a motive.',
  ].join(" "),
  headlines: [
    'FORMAT: headlines. One host, speaker "a" only.',
    "Open with one sentence that says the show is Singularity.",
    "Then give each story in the order given in one or two short sentences, one turn per story.",
    "Close with a five-word sign-off at most.",
  ].join(" "),
};

const RULES = [
  "The listener hears this script read aloud, so write for the ear: short sentences, contractions allowed, no markdown, no lists, no links, no stage directions, no emoji, no em dashes.",
  "Use facts from the story blocks only. Never add a claim, number, name, date, quote or link that a block does not state. If a block lacks a detail, leave it out.",
  "Write a number only as digits and only when it appears in that story's headline or summary; a checker rejects any other number. Do not use digits in the opening or the sign-off.",
  "Say a source's name only when it helps, never read out a URL.",
  "Tone changes wording only, never the facts.",
].join("\n");

export function scriptSystemPrompt(input: ScriptInput, boundary: string): string {
  const { request } = input;
  const perStory = STORY_CHARS[request.format];
  return [
    "You write the script of one episode of Singularity, a private tech and design briefing that people listen to as a podcast.",
    FORMATS[request.format],
    `TONE: ${TONES[request.tone]}`,
    "RULES",
    RULES,
    "LENGTH",
    `The whole script, all turns together, must stay under ${input.budget_chars} characters. Aim for about ${perStory} characters per story. You may leave out the last stories if they would not fit; never cut a story halfway.`,
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
