import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  deriveSourceFormat,
  SOURCE_FORMATS,
  type Source,
  type SourceFormat,
} from "@singularity/core";
import { type CommandRun, redact, secretsFromEnv } from "../context.js";
import { parseFeed } from "../fetch/feedParser.js";
import { createHttpClient } from "../http.js";
import { createJevClient } from "../judge/jevClient.js";
import { mapConcurrent } from "../llm/concurrency.js";
import { FormatClassifier } from "../sources/classifyFormat.js";
import {
  loadSourcesRaw,
  loadUserSources,
  saveSources,
  saveUserSources,
} from "../sources/registry.js";

const USAGE = `Usage: singularity classify-formats [--out <dir>] [--apply <formats.json>]

  (no flag)         Ask Jev for the format of every source and write format-review.md and
                    formats.json to --out (default: the system temp folder). Changes no config.
  --apply <file>    Write the formats in a reviewed formats.json (id to format) into
                    config/sources.json and config/sources.user.json.`;

interface Row {
  id: string;
  name: string;
  type: string;
  url: string;
  rule: SourceFormat;
  jev: SourceFormat | null;
  chosen: SourceFormat;
  note: string;
}

/** A type that decides its format on its own; for any other type Jev's answer is the format. */
function ruleDecides(type: Source["type"]): boolean {
  return deriveSourceFormat(type) !== "blog";
}

function table(rows: readonly Row[]): string {
  const cell = (text: string): string => text.replace(/\|/g, "/");
  const lines = [
    "| Source | Type | Rule | Jev | Chosen | Note |",
    "| :--- | :--- | :--- | :--- | :--- | :--- |",
    ...rows.map(
      (row) =>
        `| ${cell(row.name)} (${row.id}) | ${row.type} | ${row.rule} | ${row.jev ?? "none"} | ${row.chosen} | ${row.note} |`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}

async function applyFormats(file: string, root: string): Promise<number> {
  const formats = JSON.parse(await readFile(resolve(file), "utf8")) as Record<string, string>;
  for (const [id, format] of Object.entries(formats)) {
    if (!(SOURCE_FORMATS as readonly string[]).includes(format)) {
      throw new Error(`${id}: "${format}" is not a format.`);
    }
  }
  const seed = await loadSourcesRaw(root);
  const user = await loadUserSources(root);
  const set = (source: Source): void => {
    const format = formats[source.id];
    if (format) source.format = format as SourceFormat;
  };
  seed.sources.forEach(set);
  user.added.forEach(set);
  await saveSources(root, seed);
  await saveUserSources(root, user);
  process.stdout.write(`applied ${Object.keys(formats).length} formats\n`);
  return 0;
}

/** `singularity classify-formats`: backfills `format` for every source, with a review table first. */
export const run: CommandRun = async (argv, ctx) => {
  try {
    const { values } = parseArgs({
      args: argv,
      options: { out: { type: "string" }, apply: { type: "string" } },
      strict: true,
    });
    if (values.apply) return await applyFormats(values.apply, ctx.root);

    const client = createJevClient(ctx.env);
    const failures: string[] = [];
    const classifier = new FormatClassifier({
      client,
      secrets: secretsFromEnv(ctx.env),
      onFailure: (reason) => failures.push(reason),
    });
    const http = createHttpClient({ retries: 0, timeoutMs: 8_000 });
    const seed = await loadSourcesRaw(ctx.root);
    const user = await loadUserSources(ctx.root);
    const sources = [...seed.sources, ...user.added];

    const rows = await mapConcurrent(sources, 6, async (source): Promise<Row> => {
      let titles: string[] = [];
      if (source.feed_url && source.type === "rss") {
        try {
          const response = await http.fetchText(source.feed_url);
          titles = parseFeed(response.text, source.feed_url)
            .entries.map((entry) => entry.title ?? "")
            .filter((title) => title !== "")
            .slice(0, 5);
        } catch {
          // A feed that will not load only means Jev sees less.
        }
      }
      const jev = await classifier.classify({
        name: source.name,
        url: source.url,
        type: source.type,
        titles,
      });
      const rule = deriveSourceFormat(source.type);
      let chosen: SourceFormat = rule;
      let note = "";
      if (jev === null) note = "Jev gave no answer; rule kept";
      else if (ruleDecides(source.type)) {
        if (jev !== rule) note = `CONTRADICTS the type rule (Jev says ${jev}); rule kept`;
      } else chosen = jev;
      return {
        id: source.id,
        name: source.name,
        type: source.type,
        url: source.url,
        rule,
        jev,
        chosen,
        note,
      };
    });

    const out = resolve(values.out ?? join(tmpdir(), "singularity-format-review"));
    await mkdir(out, { recursive: true });
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.chosen] = (counts[row.chosen] ?? 0) + 1;
    const flagged = rows.filter((row) => row.note.startsWith("CONTRADICTS"));
    const head = `# Source formats\n\n${rows.length} sources. Counts: ${JSON.stringify(counts)}. Contradicting the rule: ${flagged.length}. No Jev answer: ${rows.filter((row) => row.jev === null).length}.\n\n`;
    await writeFile(join(out, "format-review.md"), head + table(rows));
    await writeFile(
      join(out, "formats.json"),
      `${JSON.stringify(Object.fromEntries(rows.map((row) => [row.id, row.chosen])), null, 2)}\n`,
    );
    process.stdout.write(`${head}Wrote ${join(out, "format-review.md")} and formats.json\n`);
    if (failures.length > 0)
      process.stdout.write(`Jev failures: ${failures.slice(0, 3).join("; ")}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.log.error(`${redact(message, secretsFromEnv(ctx.env))}. ${USAGE}`);
    return 1;
  }
};
