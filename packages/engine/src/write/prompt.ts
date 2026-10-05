import { VOICE_LIMITS } from "@dispatch/core";
import { untrustedInstruction, wrapUntrusted } from "../llm/untrusted.js";
import type { VoiceConfig } from "../voice/voice.js";
import type { RewriteRequest, SourceMaterial } from "./types.js";

/** The trusted voice brief, built from config/voice.md so the prompt and the linter share one source. */
export function voiceBrief(voice: VoiceConfig): string {
  const lines: string[] = ["VOICE", ...voice.principles.map((p) => `- ${p}`), "", "LIMITS"];
  lines.push(...voice.limits.map((l) => `- ${l}`), "", "EXAMPLES (weak, then strong)");
  for (const example of voice.examples) {
    lines.push(`- Weak: ${example.weak}`, `  Strong: ${example.strong}`);
  }
  lines.push(
    "",
    `BANNED WORDS AND PHRASES (also their inflections; never use them): ${voice.bannedWords.join(", ")}`,
  );
  return lines.join("\n");
}

const FIELD_RULES = [
  `- headline: at most ${VOICE_LIMITS.headlineWords} words. Name the technique, feature, number or result. No trailing period.`,
  `- summary: at most ${VOICE_LIMITS.summaryWords} words and at most ${VOICE_LIMITS.summarySentences} sentences. What it is, plus the most concrete detail the text gives.`,
  `- why: at most ${VOICE_LIMITS.whyWords} words, one sentence, no trailing period. What the reader can try, copy or watch for. Never say that something matters.`,
].join("\n");

const FACT_RULES = [
  "Use facts from the source text only. Never add a claim, number, name, date or link that the text does not state.",
  "If the text lacks a detail, leave it out instead of guessing.",
  "Write plain sentences: no markdown, no links, no quotation marks around a field, no labels such as 'Why:'.",
].join(" ");

export function writerSystemPrompt(voice: VoiceConfig, boundary: string): string {
  return [
    "You write items for Dispatch, a private news briefing read by a design engineer.",
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
    untrustedInstruction(boundary),
    "",
    "OUTPUT",
    'Reply with one JSON object: {"items":[{"id":"...","headline":"...","summary":"...","why":"..."}]}, one entry per source, keeping each id exactly.',
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

export function writerUserMessage(items: readonly SourceMaterial[], boundary: string): string {
  return [
    `Write the headline, summary and why for each of these ${items.length} sources.`,
    "",
    ...items.map((item) => materialBlock(item, boundary)),
  ].join("\n\n");
}

export function rewriteSystemPrompt(voice: VoiceConfig, boundary: string): string {
  return [
    "You fix one field of a Dispatch item so that it follows the house voice.",
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
    untrustedInstruction(boundary),
    "",
    "OUTPUT",
    'Reply with one JSON object: {"text":"..."} holding the corrected field and nothing else.',
  ].join("\n");
}

export function rewriteUserMessage(request: RewriteRequest, boundary: string): string {
  // The current text was itself produced from untrusted material, so it is delimited too.
  return [
    `Field to fix: ${request.field}`,
    "Current text:",
    wrapUntrusted(request.current, boundary, "current"),
    "Problems:",
    ...request.problems.map((p) => `- ${p}`),
    "",
    "Source:",
    materialBlock(request.material, boundary),
  ].join("\n");
}
