#!/usr/bin/env node
// PostToolUse hook (Edit|Write|MultiEdit): after an agent edits UI source or the tokens, run the
// static design rules (`npm run design-check`, about 2 s) and hand failures back as blocking
// feedback (exit 2, stderr). Silent when green or when the file is not UI. The rules and why each
// exists are in apps/web/src/styles/styles.test.ts; the owner's ask is in AGENTS.md ("Tests" and
// the UI rule). A hook that errors itself never blocks the agent.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const UI = /^(?:apps\/web\/src\/.*\.(?:css|astro|tsx|ts)|tokens\/.*)$/;

try {
  const payload = JSON.parse(readFileSync(0, "utf8") || "{}");
  const file = payload.tool_input?.file_path;
  if (typeof file !== "string") process.exit(0);
  const root = resolve(process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd());
  const rel = relative(root, resolve(root, file)).replaceAll("\\", "/");
  if (!UI.test(rel)) process.exit(0);

  const run = spawnSync(
    "npx",
    [
      "vitest",
      "run",
      "apps/web/src/styles/styles.test.ts",
      "scripts/buildTokens.test.ts",
      "--reporter=default",
    ],
    { cwd: root, encoding: "utf8", shell: process.platform === "win32", timeout: 60_000 },
  );
  if (run.status === 0 || run.error) process.exit(0);

  // The failing rule names and what each one found: not the whole vitest report.
  const lines = `${run.stdout}\n${run.stderr}`
    .split("\n")
    .filter((line) => /^\s*(?:FAIL|[-+]\s{1,3}"|AssertionError|×)/.test(line))
    .slice(0, 40);
  process.stderr.write(
    `Design check failed after editing ${rel}. Fix it or, when the existing look is load-bearing, add a commented allowlist entry in apps/web/src/styles/styles.test.ts (see AGENTS.md).\n${lines.join("\n")}\nRun \`npm run design-check\` for the full report.\n`,
  );
  process.exit(2);
} catch {
  process.exit(0);
}
