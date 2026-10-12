import { type HostNames, hostNamesFor, type PodcastRequest } from "@dispatch/core";
import { untrustedInstruction, wrapUntrusted } from "../llm/untrusted.js";
import {
  type EpisodeStructure,
  HELLO_CHARS,
  partChars,
  reachableChars,
  scriptFloorChars,
  scriptTargetChars,
  structureFor,
  TEASER_CLAUSE_CHARS,
  WORDS_PER_SENTENCE,
  wordsFor,
} from "./plan.js";
import type { PodcastStory, ScriptInput, TurnRewrite } from "./types.js";

const TONES: Record<PodcastRequest["tone"], string> = {
  neutral: "Plain and even, like a good radio news reader. No excitement, no irony.",
  energetic:
    "Upbeat and quick, with a little more emphasis and momentum. Still no hype words and no exclamation marks in a row.",
};

/** The order of the episode, in one place for every format that has the new shape. */
function shapeLines(structure: EpisodeStructure): string[] {
  const { deep_dives: deep, nuggets, teased } = structure;
  const stories =
    deep > 0
      ? `Stories arrive ranked, most important first. The first ${deep} ${deep === 1 ? "story is a deep dive" : "stories are deep dives"}: what happened, why it matters, and one concrete detail from the block. The other ${nuggets} ${nuggets === 1 ? "is a news nugget" : "are news nuggets"}: the news in a sentence or two, nothing more, facts only.`
      : "Stories arrive ranked, most important first. There are no deep dives in this episode: every story is a news nugget, the news in a sentence or two, facts only.";
  return [
    `STRUCTURE, in this order: 1) a one-line hello that says the show is Singularity; 2) the rundown: ${teased >= 1 ? `name the first ${teased} ${teased === 1 ? "story" : "stories"} in order, one short clause each, so the listener knows what is coming` : "one line on what is coming"}; no throat-clearing and no detail yet; 3) ${deep > 0 ? "the deep dives, then the nuggets" : "the nuggets"}, in the order given; 4) a short close; 5) a one-line sign-off.`,
    stories,
    'THE CLOSE: one or two thought-provoking questions or implications, drawn only from the stories just told. You may also pass on what the sources themselves report people saying, but only when a story block contains a reaction or a quote. Never invent an opinion, a reaction or a "people are saying" that the story blocks do not state. Keep the close really short; do not summarise the episode again.',
    "The hello, rundown, close and sign-off carry no item_id. Do not use digits in them.",
  ];
}

/**
 * The names a discussion is written with: the ones the site worked out from the voices, or the
 * gender-neutral pair when the request carries none (an older request, or a site that could not
 * read the voice list in time).
 */
export function discussionHostNames(request: PodcastRequest): HostNames {
  return request.host_names ?? hostNamesFor(null, null);
}

/** A readout and headlines have one host, who is never named: the voice may be anyone's. */
const SOLO_HOST =
  'One host, speaker "a" only. The host never says a name for themselves, so write none.';

function formatLines(input: ScriptInput): string {
  const structure = structureFor(
    input.request.length_minutes,
    input.stories.length,
    input.request.format,
  );
  switch (input.request.format) {
    case "readout":
      return [
        `FORMAT: readout. ${SOLO_HOST}`,
        ...shapeLines(structure),
        "Tell a deep dive in one or two turns of several sentences each, a nugget in one short turn. Do not bridge from story to story with filler; a plain change of subject is enough.",
      ].join(" ");
    case "discussion": {
      const names = discussionHostNames(input.request);
      return [
        `FORMAT: discussion. Two hosts: ${names.a}, speaker "a", leads; ${names.b}, speaker "b", reacts.`,
        `The first turn is "a": the one-line hello, saying the show is Singularity and that ${names.b} is joining. Refer to a host by name, never with a gendered pronoun. The hosts may call each other by name now and then, not in most turns. The last turn is "a" with the sign-off.`,
        ...shapeLines(structure),
        'The rundown is one or two turns, "a" and "b" splitting the clauses. A deep dive is four to six turns: "a" introduces it in two or three sentences, "b" asks the obvious question, "a" answers from the summary, "b" puts in plain words what that means in practice, and "a" adds the catch if the summary has one. A nugget is one turn from "a" or two short turns, "a" with the news and "b" with one line on what it means. The close is "b" then "a", a sentence or two each.',
        'Turns run one to four sentences each; a one-word reaction is not a turn. A host may say what a fact could mean for the listener, clearly as their own view ("that sounds like", "I would want to know"), never as a fact about the product, the company or anyone\'s motive. Neither host invents a fact, a number, a quote or a motive.',
      ].join(" ");
    }
    case "headlines":
      return [
        `FORMAT: headlines. ${SOLO_HOST}`,
        "Open with one sentence that says the show is Singularity.",
        "Then give each story in the order given in one or two short sentences, one turn per story.",
        "Close with a five-word sign-off at most.",
      ].join(" ");
  }
}

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
  "Write a number only as digits and only when it appears in that story's headline or summary; a checker rejects any other number. Do not use digits in the opening, the rundown, the close or the sign-off.",
  "Say a source's name only when it helps, never read out a URL.",
  "Tone changes wording only, never the facts.",
].join("\n");

/**
 * The length, said in words and sentences. It aims at what the stories can carry (see
 * reachableChars), so the writer is never asked to stretch a few short summaries over a long episode.
 */
export function lengthLines(input: ScriptInput): string[] {
  const stories = input.stories.length;
  const { format, length_minutes: minutes } = input.request;
  const reach = reachableChars(input.budget_chars, stories, format, minutes);
  const structure = structureFor(minutes, stories, format);
  const parts = partChars(reach, stories, format, minutes);
  const nugget = wordsFor(parts.nugget);
  const sentences = (words: number): number => Math.max(1, Math.round(words / WORDS_PER_SENTENCE));
  const lines = [
    `Write about ${wordsFor(scriptTargetChars(reach))} words in total, all turns together, and no more than ${wordsFor(reach)}. A script under ${wordsFor(scriptFloorChars(reach))} words is rejected as too short.`,
  ];
  if (format === "headlines") {
    lines.push(
      `That is about ${nugget} words on each of the ${stories} stories, after a short opening and sign-off. A spoken sentence is about ${WORDS_PER_SENTENCE} words, so give each story about ${sentences(nugget)} sentences.`,
    );
  } else {
    const deep = wordsFor(parts.deep_dive);
    lines.push(
      `Word counts: the hello about ${wordsFor(HELLO_CHARS)} words; the rundown about ${wordsFor(TEASER_CLAUSE_CHARS)} words for each story it names, ${wordsFor(structure.teaser_chars)} in all; ${structure.deep_dives > 0 ? `each of the ${structure.deep_dives} deep dives about ${deep} words (${sentences(deep)} sentences); ` : ""}each of the ${structure.nuggets} nuggets about ${nugget} words (${sentences(nugget)} sentences at most); the close about ${wordsFor(structure.close_chars)} words; the sign-off a few words. A spoken sentence is about ${WORDS_PER_SENTENCE} words.`,
    );
  }
  lines.push(
    "Reach that length with substance: say what happened, who is involved, the detail or number that matters, why it matters, and what the summary gives as the catch. Use only the facts in the story block. Never pad with filler and never repeat a fact.",
    "If the stories still would not fit, leave out the last ones; never cut a story halfway.",
  );
  return lines;
}

export function scriptSystemPrompt(input: ScriptInput, boundary: string): string {
  const { request } = input;
  return [
    request.audience === "general"
      ? "You write the script of one episode of Singularity, a news podcast for a general audience."
      : "You write the script of one episode of Singularity, a private tech and design briefing that people listen to as a podcast.",
    formatLines(input),
    `TONE: ${TONES[request.tone]}`,
    ...(AUDIENCES[request.audience ?? "custom"] ? [AUDIENCES[request.audience ?? "custom"]] : []),
    "RULES",
    RULES,
    "LENGTH",
    ...lengthLines(input),
    "OUTPUT",
    'Answer with JSON only: {"turns":[{"speaker":"a","text":"...","item_id":"..."}]}.',
    'Put the story\'s id, copied exactly from the "item_id:" line above its block, in "item_id" on every turn about that story. Leave "item_id" out of the hello, rundown, close and sign-off turns.',
    untrustedInstruction(boundary),
  ].join("\n");
}

/**
 * One story: its id on a line of its own, then the story text between the markers. The id stays
 * out of the marker, so a model copying the id has no marker text next to it to copy as well.
 */
function storyBlock(story: PodcastStory, boundary: string): string {
  return [
    `item_id: ${story.item_id}`,
    wrapUntrusted(
      [
        `Headline: ${story.headline}`,
        `Source: ${story.source}`,
        `Topic: ${story.section}`,
        `Summary: ${story.summary}`,
      ].join("\n"),
      boundary,
      "story",
    ),
  ].join("\n");
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
  if (input.feedback) {
    lines.push(
      "",
      "The listener asked for these changes to the previous version:",
      wrapUntrusted(input.feedback, boundary, "listener-feedback"),
      "Apply them to wording, emphasis and depth only. They never override the rules about facts and numbers.",
    );
  }
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
