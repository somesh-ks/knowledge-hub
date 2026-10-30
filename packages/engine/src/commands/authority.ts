import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type Item, JudgmentsFile } from "@singularity/core";
import { loadAuthority } from "../authority/authority.js";
import {
  AUTHORITY_PASS_GUARD,
  type AuthorityReplay,
  replayAuthority,
} from "../authority/replay.js";
import type { CommandRun } from "../context.js";
import { loadPreferences } from "../curate/inputs.js";
import { PoolFile } from "../fetch/pool.js";

const USAGE = "Usage: singularity authority replay <pools-dir> [--days <n>]";
const DEFAULT_DAYS = 14;
const DAY_MS = 86_400_000;

/** Every `pool.json` under a directory, however the artifacts were unpacked into it. */
async function findPools(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await findPools(path)));
    else if (entry.name === "pool.json") found.push(path);
  }
  return found;
}

function format(report: AuthorityReplay, pools: number): string {
  const lines = [
    `Authority replay over ${pools} pools: ${report.items} items, ${report.judged} with a judgment, ${report.authority_items} from the list`,
    `Passing the bar: ${report.passed_before} without the list, ${report.passed_after} with it`,
    "",
    "By domain (judged, passed before, passed after, share after)",
    ...Object.entries(report.domains).map(
      ([domain, d]) =>
        `  ${domain}: ${d.judged}, ${d.passed_before}, ${d.passed_after}, ${Math.round(d.share_after * 100)}%`,
    ),
    "",
    `New passers (${report.newly_passing.length}), best first, with their place among everything that passes`,
    ...report.newly_passing.map(
      (row) =>
        `  #${row.rank_after} ${row.score_before} to ${row.score_after} ${row.source_id}: ${row.title}`,
    ),
  ];
  if (report.over_guard.length > 0) {
    lines.push(
      "",
      `Over ${Math.round(AUTHORITY_PASS_GUARD * 100)}% of judged items pass: ${report.over_guard.join(", ")}. Reassess the list before switching it on.`,
    );
  }
  return lines.join("\n");
}

/**
 * `singularity authority replay <dir>`: what config/authority.json would change, scored from the
 * cached judgments (state/judgments.json) and the pools in <dir> (the run artifacts, unpacked).
 * Offline and free; the list is read as if on. Changes nothing.
 */
export const run: CommandRun = async (argv, ctx) => {
  let verb: string | undefined;
  let dir: string | undefined;
  let days = DEFAULT_DAYS;
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: { days: { type: "string" } },
    });
    [verb, dir] = parsed.positionals;
    if (parsed.values.days !== undefined) days = Number(parsed.values.days);
  } catch (error) {
    ctx.log.error(`${error instanceof Error ? error.message : "invalid arguments"}. ${USAGE}`);
    return 2;
  }
  if (verb !== "replay" || !dir || !Number.isFinite(days) || days <= 0) {
    ctx.log.error(USAGE);
    return 2;
  }
  const since = ctx.now().getTime() - days * DAY_MS;
  const items: Item[] = [];
  let pools = 0;
  let paths: string[];
  try {
    paths = await findPools(dir);
  } catch {
    ctx.log.error(`${dir} cannot be read. ${USAGE}`);
    return 2;
  }
  for (const path of paths) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path, "utf8"));
    } catch {
      ctx.log.warn(`skipped ${path}: not readable as JSON`);
      continue;
    }
    // An older run's pool may have another shape; one such file must not discard the report.
    const parsed = PoolFile.safeParse(raw);
    if (!parsed.success) {
      ctx.log.warn(`skipped ${path}: not a valid pool`);
      continue;
    }
    if (Date.parse(parsed.data.generated_at) < since) continue;
    pools += 1;
    items.push(...parsed.data.items);
  }
  const [authority, preferences, judgments] = await Promise.all([
    loadAuthority(ctx.root),
    loadPreferences(ctx.root),
    readFile(join(ctx.root, "state", "judgments.json"), "utf8").then((text) =>
      JudgmentsFile.parse(JSON.parse(text)),
    ),
  ]);
  if (authority.entries.length === 0) {
    ctx.log.error("config/authority.json lists no domain");
    return 1;
  }
  const report = replayAuthority({ pools: items, judgments, preferences, authority });
  process.stdout.write(`${ctx.json ? JSON.stringify(report) : format(report, pools)}\n`);
  return 0;
};
