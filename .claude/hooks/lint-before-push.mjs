#!/usr/bin/env node
// PreToolUse hook (Bash): before `git commit` or `git push`, run Biome on the files this branch
// changed and block the command while it reports an error (exit 2, stderr). A formatting slip then
// never reaches CI: most red `Lint` runs on 2026-11-03 were one or two lines Biome would have fixed.
// Silent for any other command and when green. A hook that errors itself never blocks the agent.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const GIT_WRITE = /(?:^|[\s;&|(])git\s+(?:-C\s+\S+\s+)?(?:commit|push)\b/;

try {
  const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  const command = payload.tool_input?.command;
  if (typeof command !== "string" || !GIT_WRITE.test(command)) process.exit(0);
  const root = resolve(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd());
  const run = (cmd, args) =>
    spawnSync(cmd, args, {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32",
      timeout: 60_000,
    });

  // What the branch changes against main, working tree included; a deleted file has nothing to lint.
  const base = run("git", ["merge-base", "origin/main", "HEAD"]);
  if (base.status !== 0) process.exit(0);
  const diff = run("git", ["diff", "--name-only", "--diff-filter=d", base.stdout.trim()]);
  const files = diff.stdout.split("\n").filter((file) => /\.(?:[cm]?[jt]sx?|css|json)$/.test(file));
  if (diff.status !== 0 || files.length === 0) process.exit(0);

  const check = run("npx", [
    "biome",
    "check",
    "--no-errors-on-unmatched",
    "--files-ignore-unknown=true",
    "--max-diagnostics=10",
    ...files,
  ]);
  if (check.status === 0 || check.error) process.exit(0);

  const report = `${check.stdout}\n${check.stderr}`.split("\n").slice(0, 60).join("\n");
  process.stderr.write(
    `Biome reports errors in the files this branch changes; CI would fail on Lint. Run \`npx biome check --write ${files.slice(0, 3).join(" ")}${files.length > 3 ? " ..." : ""}\`, fix what is left, then run the command again.\n${report}\n`,
  );
  process.exit(2);
} catch {
  process.exit(0);
}
