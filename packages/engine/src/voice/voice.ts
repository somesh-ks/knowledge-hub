import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_FILES } from "@singularity/core";

export interface VoiceExample {
  weak: string;
  strong: string;
}

export interface BannedPattern {
  /** The text as written in config/voice.md. */
  source: string;
  regex: RegExp;
}

/** The parsed form of config/voice.md. The linter enforces the two banned lists. */
export interface VoiceConfig {
  principles: string[];
  limits: string[];
  examples: VoiceExample[];
  /** Headlines that read like a changelog, each beside the version a person would write. */
  headlineExamples: VoiceExample[];
  bannedWords: string[];
  bannedPatterns: BannedPattern[];
}

interface Sections {
  [heading: string]: string[];
}

function splitSections(markdown: string): Sections {
  const sections: Sections = {};
  let current: string | null = null;
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = (heading[1] as string).toLowerCase();
      sections[current] = [];
    } else if (current !== null) {
      (sections[current] as string[]).push(line);
    }
  }
  return sections;
}

function bullets(lines: readonly string[] | undefined): string[] {
  return (lines ?? [])
    .map((line) => /^\s*[-*]\s+(.*\S)\s*$/.exec(line)?.[1])
    .filter((text): text is string => text !== undefined);
}

/** Pattern lines may be wrapped in backticks for readability in Markdown. */
function unwrapCode(text: string): string {
  const match = /^`(.+)`$/.exec(text);
  return match ? (match[1] as string) : text;
}

function parseExamples(lines: readonly string[] | undefined): VoiceExample[] {
  const examples: VoiceExample[] = [];
  for (const line of lines ?? []) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
    const [weak, strong] = cells;
    if (weak === undefined || strong === undefined) continue;
    if (/^-+$/.test(weak) || weak.toLowerCase() === "weak") continue;
    examples.push({ weak, strong });
  }
  return examples;
}

function compilePattern(source: string): BannedPattern {
  try {
    return { source, regex: new RegExp(source, "i") };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid expression";
    throw new Error(`Invalid banned pattern "${source}" in ${CONFIG_FILES.voice}: ${reason}`);
  }
}

/** Parse the Markdown of config/voice.md. Throws when either banned list is missing or empty. */
export function parseVoice(markdown: string): VoiceConfig {
  const sections = splitSections(markdown);
  const bannedWords = bullets(sections["banned words"]);
  const bannedPatterns = bullets(sections["banned patterns"]).map((p) =>
    compilePattern(unwrapCode(p)),
  );
  if (bannedWords.length === 0) {
    throw new Error(`${CONFIG_FILES.voice} has no entries under "Banned words".`);
  }
  if (bannedPatterns.length === 0) {
    throw new Error(`${CONFIG_FILES.voice} has no entries under "Banned patterns".`);
  }
  return {
    principles: bullets(sections.principles),
    limits: bullets(sections.limits),
    examples: parseExamples(sections.examples),
    headlineExamples: parseExamples(sections["headline examples"]),
    bannedWords: bannedWords.map(unwrapCode),
    bannedPatterns,
  };
}

/** Load and parse config/voice.md from the repository root. */
export async function loadVoice(root: string): Promise<VoiceConfig> {
  const text = await readFile(join(root, CONFIG_FILES.voice), "utf8");
  return parseVoice(text);
}
