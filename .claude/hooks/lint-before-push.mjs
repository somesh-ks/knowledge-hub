#!/usr/bin/env node
// PreToolUse hook (Bash): before `git commit` or `git push`, run Biome on the files this branch
// changed and block the command while it reports an error (exit 2, stderr). A formatting slip then
// never reaches CI: most red `Lint` runs on 2026-11-03 were one or two lines Biome would have fixed.
// Silent for any other command and when green. A hook that errors itself never blocks the agent.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// `git` in command position: the start of the command or after ; & | (. `echo git commit` is not one.
const GIT_WRITE = /(?:^|[;&|(])\s*git\s+(?:-C\s+\S+\s+)?(?:commit|push)\b/;
// New files are checked only when the command can stage them.
const STAGES_NEW = /(?:^|[;&|(])\s*git\s+(?:-C\s+\S+\s+)?add\b/;

try {
  const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  const command = payload.tool_input?.command;
  if (typeof command !== "string" || !GIT_WRITE.test(command)) process.exit(0);
  // No shell: a file name reaches Biome as an argument and nothing else.
  const run = (cwd, cmd, args) =>
    spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 60_000 });

  // The repository the command runs in: a worktree has its own root, not CLAUDE_PROJECT_DIR's.
  // shortcut: a `git -C <other>` target is not followed, upgrade if agents start to use it.
  const start = resolve(payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const top = run(start, "git", ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) process.exit(0);
  const root = top.stdout.trim();

  // What the branch changes against main, working tree and new files included; a deleted file has
  // nothing to lint. shortcut: this reads the working tree, not the index or the pushed revision, so a
  // staged error fixed only on disk passes; upgrade if that ever reaches CI.
  const base = run(root, "git", ["merge-base", "origin/main", "HEAD"]);
  if (base.status !== 0) process.exit(0);
  // -z: git quotes an unusual path (café.ts) unless the names are NUL-delimited.
  const changed = run(root, "git", ["diff", "-z", "--name-only", "--diff-filter=d", base.stdout.trim()]);
  const added = STAGES_NEW.test(command)
    ? run(root, "git", ["ls-files", "-z", "--others", "--exclude-standard"])
    : { stdout: "" };
  const files = `${changed.stdout}\0${added.stdout}`
    .split("\0")
    .filter((file) => /\.(?:[cm]?[jt]sx?|css|json|astro)$/.test(file));
  if (changed.status !== 0 || files.length === 0) process.exit(0);
  // A rule change can fail files the branch did not touch, so CI's `biome check .` gets the whole tree.
  const targets = files.includes("biome.json") ? ["."] : files;

  // Biome's own launcher run by Node, so no npx and no shell.
  const biome = createRequire(`${root}/package.json`).resolve("@biomejs/biome/bin/biome");
  const check = run(root, process.execPath, [
    biome,
    "check",
    "--no-errors-on-unmatched",
    "--files-ignore-unknown=true",
    "--max-diagnostics=10",
    ...targets,
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
