import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { REPO_ROOT } from "./score-factories.js";

// No test runs a scheduled workflow, so a renamed command or flag would first fail in production.
// This reads every `singularity -- <args>` call in .github/workflows and runs its literal arguments
// through the CLI in an empty folder with no keys: any exit is fine except 2, the usage error that a
// missing command or an unknown flag produces. Shell variables get a plausible value each.
const RUNS_FILE = join(tmpdir(), `singularity-contract-runs-${process.pid}.json`);
writeFileSync(RUNS_FILE, "[]");
const PLACEHOLDERS: Record<string, string[]> = {
  '"${args[@]}"': [
    "--mode",
    "on-demand",
    "--json",
    "--force",
    "--since",
    "2026-10-01",
    "--replace",
    "2026-10-01",
    "--dry-run",
  ],
  // seed.yml: the replace and dry-run flags it can pass.
  '"${seed_args[@]}"': ["--json", "--replace", "--dry-run"],
  // Offline here: the contract run must not reach the live site.
  '"$CEILING"': ["5", "--offline"],
  '"$DELETE_ID"': ["2026-10-01"],
  // health.yml's `gh run list` output: an empty list.
  '"$runs"': [RUNS_FILE],
  // health.yml's probe output (empty on a day without the probe); a failed probe wrote none,
  // which must not be a usage error.
  '"$PERF"': [join(tmpdir(), `singularity-contract-perf-${process.pid}-missing.json`)],
  '"$FEEDBACK"': ["Shorter summaries"],
  '"$TOPICS"': ["ai,design"],
  '"$OP"': ['{"op":"weights.set","weights":{"design_engineering_craft":0.9}}'],
  '"$TOPIC_ID"': ["design_engineering_craft"],
  '"$message"': ["chore(config): set a weight"],
  '"$REQUEST"': [
    '{"topic_ids":["design_engineering_craft"],"length_minutes":5,"format":"readout","window_days":2,"tone":"neutral"}',
  ],
};

function tokens(line: string): string[] {
  const out: string[] = [];
  for (const raw of line.match(/"[^"]*"|\S+/g) ?? []) {
    const placeholder = PLACEHOLDERS[raw];
    if (placeholder) out.push(...placeholder);
    else if (raw.includes("$")) throw new Error(`no placeholder for ${raw} in: ${line}`);
    else out.push(raw.replace(/^"(.*)"$/, "$1"));
  }
  return out;
}

const dir = join(REPO_ROOT, ".github", "workflows");
const calls = readdirSync(dir)
  .filter((name) => name.endsWith(".yml"))
  .flatMap((name) =>
    readFileSync(join(dir, name), "utf8")
      .split("\n")
      .map((line) => /singularity -- ([^|]+)/.exec(line)?.[1]?.trim())
      .filter((args): args is string => args !== undefined)
      .map((args) => [`${name}: ${args}`, args] as const),
  );

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "singularity-contract-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("workflow calls", () => {
  it("finds the calls the workflows make", () => {
    expect(calls.length).toBeGreaterThan(5);
  });

  it.each(calls)("%s still parses", async (_name, args) => {
    let err = "";
    const code = await runCli([...tokens(args), "--root", root], {
      cwd: root,
      env: {},
      stdout: () => {},
      stderr: (text) => {
        err += text;
      },
    });
    expect(code, err).not.toBe(2);
  });
});

// run_died started a paid run on a guess (a cancel, a timeout) that nothing confirmed: it alerts only.
describe("health.yml's heal", () => {
  it("starts a briefing run for run_failed and run_overdue only", () => {
    const yml = readFileSync(join(dir, "health.yml"), "utf8").split("\n");
    const start = yml.findIndex((line) => line.includes("gh workflow run run.yml"));
    const condition = yml[start - 1] ?? "";
    expect([...condition.matchAll(/new_fault (\w+)/g)].map((match) => match[1])).toEqual([
      "run_failed",
      "run_overdue",
    ]);
  });
});
