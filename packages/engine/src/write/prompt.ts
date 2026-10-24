import { BRIEFING_STORY_PROMPT } from "@dispatch/core";
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

/**
 * `rules` is the block's prompt (D177): the built-in fields and fact rules, or the owner's
 * replacement for the stories of one section. The voice, the source handling and the reply's
 * shape stay as they are, and the checks after writing still apply.
 */
export function writerSystemPrompt(voice: VoiceConfig, rules = BRIEFING_STORY_PROMPT): string {
  return [
    "You write items for Singularity, a private tech and design engineering briefing. The reader is sharp but may not know the topic.",
    "",
    voiceBrief(voice),
    "",
    rules,
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

export function rewriteSystemPrompt(voice: VoiceConfig, rules = BRIEFING_STORY_PROMPT): string {
  return [
    "You fix one field of a Singularity item so that it follows the house voice.",
    "",
    voiceBrief(voice),
    "",
    rules,
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
