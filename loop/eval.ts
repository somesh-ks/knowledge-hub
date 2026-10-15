/**
 * Scores briefing episodes (daily and weekly) against loop/rubric.md and prints a pass/fail table.
 * Fixed after the baseline: do not edit (loop/NOTES.md).
 *
 *   npx tsx loop/eval.ts                 every fixture, each settings file
 *   npx tsx loop/eval.ts <fixture dir>   one fixture
 *
 * A fixture holds settings.json (and settings-variant.json), and the episode produced for each:
 * episode.md / episode.audio.json and episode-variant.md / episode-variant.audio.json. A missing
 * episode is reported as NOT GENERATED. The judge needs ANTHROPIC_API_KEY (JUDGE_MODEL picks the
 * model); without it importance and quality are BLOCKED.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type DigestItem,
  PODCAST_CHARS_PER_MINUTE,
  parseDigestFile,
} from "../packages/core/src/index.js";
import { buildSpokenText, itemBlock } from "../packages/engine/src/audio/spokenText.js";

const FIXTURES = join(import.meta.dirname, "fixtures");
const TOLERANCE = 0.1;
const MIN_SEGMENTS_PER_TOPIC = 1;
const MAX_UNSELECTED_SHARE = 0.2;
const MIN_MAJOR_SHARE = 0.8;
const MIN_QUALITY_MEAN = 4;
const MIN_QUALITY_SCORE = 3;
const WANTED_WEIGHT = 0.5;

interface Settings {
  kind: "regular" | "weekly";
  length_minutes: number;
  skip_topics: string[];
}

interface Segment {
  id: string;
  topic: string;
  text: string;
  chars: number;
}

type Verdict = "PASS" | "FAIL" | "BLOCKED" | "NOT GENERATED";

interface Row {
  episode: string;
  metric: string;
  value: string;
  verdict: Verdict;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

function selectedTopics(settings: Settings): { selected: Set<string>; known: Set<string> } {
  const topics = readJson<{ topics: Array<{ id: string; enabled: boolean }> }>(
    join(FIXTURES, "topics.json"),
  ).topics;
  const weights = readJson<{ weights: Record<string, number> }>(
    join(FIXTURES, "preferences.json"),
  ).weights;
  const selected = new Set(
    topics
      .filter((topic) => topic.enabled && !settings.skip_topics.includes(topic.id))
      .filter((topic) => (weights[topic.id] ?? 1) >= WANTED_WEIGHT)
      .map((topic) => topic.id),
  );
  return { selected, known: new Set(topics.map((topic) => topic.id)) };
}

function lengthRows(name: string, settings: Settings, text: string, audio: string): Row[] {
  const target = settings.length_minutes;
  const within = (minutes: number): Verdict =>
    Math.abs(minutes - target) <= target * TOLERANCE ? "PASS" : "FAIL";
  const script = text.length / PODCAST_CHARS_PER_MINUTE;
  const words = text.split(/\s+/).filter(Boolean).length;
  const rows: Row[] = [
    {
      episode: name,
      metric: "length (script)",
      value: `${script.toFixed(1)} of ${target} min (${words} words)`,
      verdict: within(script),
    },
  ];
  if (existsSync(audio)) {
    const minutes = readJson<{ duration_ms: number }>(audio).duration_ms / 60_000;
    rows.push({
      episode: name,
      metric: "length (audio)",
      value: `${minutes.toFixed(1)} of ${target} min`,
      verdict: within(minutes),
    });
  }
  return rows;
}

function topicRows(name: string, settings: Settings, segments: Segment[]): Row[] {
  const { selected } = selectedTopics(settings);
  const counts = new Map<string, number>();
  for (const segment of segments) counts.set(segment.topic, (counts.get(segment.topic) ?? 0) + 1);
  const missing = [...selected].filter(
    (topic) => (counts.get(topic) ?? 0) < MIN_SEGMENTS_PER_TOPIC,
  );
  const total = segments.reduce((sum, segment) => sum + segment.chars, 0);
  const off = segments
    .filter((segment) => !selected.has(segment.topic))
    .reduce((sum, segment) => sum + segment.chars, 0);
  const share = total === 0 ? 0 : off / total;
  return [
    {
      episode: name,
      metric: "topics covered",
      value: `${selected.size - missing.length} of ${selected.size}${missing.length > 0 ? `; missing ${missing.join(", ")}` : ""}`,
      verdict: missing.length === 0 ? "PASS" : "FAIL",
    },
    {
      episode: name,
      metric: "unselected airtime",
      value: `${Math.round(share * 100)}%`,
      verdict: share <= MAX_UNSELECTED_SHARE ? "PASS" : "FAIL",
    },
  ];
}

interface Judgement {
  labels: Record<string, "major" | "minor" | "changelog">;
  scores: { clarity: number; novelty: number; no_repetition: number; worth_listening: number };
}

async function judgeOnce(segments: Segment[], rubric: string): Promise<Judgement> {
  const prompt = [
    "You judge a news audio episode against this rubric.",
    rubric,
    "Segments, as JSON lines of {id, text}:",
    ...segments.map((segment) => JSON.stringify({ id: segment.id, text: segment.text })),
    'Answer with JSON only: {"labels": {"<id>": "major"|"minor"|"changelog"}, "scores": {"clarity": 1-5, "novelty": 1-5, "no_repetition": 1-5, "worth_listening": 1-5}}',
  ].join("\n\n");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.JUDGE_MODEL ?? "claude-sonnet-5-5",
      max_tokens: 2000,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`judge answered ${response.status}`);
  const body = (await response.json()) as { content: Array<{ text?: string }> };
  const text = body.content.map((part) => part.text ?? "").join("");
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as Judgement;
}

async function judgeRows(name: string, segments: Segment[]): Promise<Row[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return [
      { episode: name, metric: "importance", value: "no ANTHROPIC_API_KEY", verdict: "BLOCKED" },
      { episode: name, metric: "quality", value: "no ANTHROPIC_API_KEY", verdict: "BLOCKED" },
    ];
  }
  const rubric = readFileSync(join(import.meta.dirname, "rubric.md"), "utf8");
  const [first, second] = [await judgeOnce(segments, rubric), await judgeOnce(segments, rubric)];
  const agree = JSON.stringify(first) === JSON.stringify(second);
  const total = segments.reduce((sum, segment) => sum + segment.chars, 0);
  const major = segments
    .filter((segment) => first.labels[segment.id] === "major")
    .reduce((sum, segment) => sum + segment.chars, 0);
  const changelog = segments.filter((segment) => first.labels[segment.id] === "changelog").length;
  const share = total === 0 ? 0 : major / total;
  const scores = Object.values(first.scores);
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const disagree = agree ? "" : "; the two runs disagree";
  return [
    {
      episode: name,
      metric: "importance",
      value: `${Math.round(share * 100)}% major, ${changelog} changelog${disagree}`,
      verdict: agree && share >= MIN_MAJOR_SHARE && changelog === 0 ? "PASS" : "FAIL",
    },
    {
      episode: name,
      metric: "quality",
      value: `mean ${mean.toFixed(2)}, min ${Math.min(...scores)} ${JSON.stringify(first.scores)}${disagree}`,
      verdict:
        agree && mean >= MIN_QUALITY_MEAN && Math.min(...scores) >= MIN_QUALITY_SCORE
          ? "PASS"
          : "FAIL",
    },
  ];
}

async function scoreEpisode(dir: string, variant: boolean): Promise<Row[]> {
  const suffix = variant ? "-variant" : "";
  const name = `${dir.split("/").pop()}${suffix}`;
  const settingsPath = join(dir, `settings${suffix}.json`);
  if (!existsSync(settingsPath)) return [];
  const settings = readJson<Settings>(settingsPath);
  const episodePath = join(dir, `episode${suffix}.md`);
  if (!existsSync(episodePath)) {
    return [
      {
        episode: name,
        metric: "all",
        value: "no episode for these settings",
        verdict: "NOT GENERATED",
      },
    ];
  }
  const digest = parseDigestFile(readFileSync(episodePath, "utf8"));
  const segments: Segment[] = digest.items.map((item: DigestItem) => {
    const text = itemBlock(item);
    return { id: item.id, topic: item.category, text, chars: text.length };
  });
  const narration = buildSpokenText(digest).text;
  return [
    ...lengthRows(name, settings, narration, join(dir, `episode${suffix}.audio.json`)),
    ...topicRows(name, settings, segments),
    ...(await judgeRows(name, segments)),
  ];
}

async function main(): Promise<void> {
  const only = process.argv[2];
  const dirs = only
    ? [only]
    : readdirSync(FIXTURES, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(FIXTURES, entry.name));
  const rows: Row[] = [];
  for (const dir of dirs.sort()) {
    rows.push(...(await scoreEpisode(dir, false)), ...(await scoreEpisode(dir, true)));
  }
  console.log("| Episode | Metric | Value | Verdict |\n|---|---|---|---|");
  for (const row of rows)
    console.log(`| ${row.episode} | ${row.metric} | ${row.value} | ${row.verdict} |`);
  const passed = rows.filter((row) => row.verdict === "PASS").length;
  console.log(`\n${passed} of ${rows.length} pass.`);
  process.exitCode = passed === rows.length ? 0 : 1;
}

await main();
