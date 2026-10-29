// Sends values from the gitignored .env to GitHub Actions and Vercel without printing them.
// Usage: npm run secrets:push [-- --dry-run] [-- --only github|vercel]
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface Target {
  name: string;
  where: "github-secret" | "github-variable" | "vercel" | "vercel-admin";
}

/** Secrets used by the GitHub Actions workflows. */
const GITHUB_SECRETS = [
  "TYPESAFE_API_KEY",
  "ANTHROPIC_API_KEY",
  "EXA_API_KEY",
  "FIRECRAWL_API_KEY",
  "SPEECHIFY_API_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "VERCEL_TOKEN",
  "GEMINI_API_KEY",
  "DATABASE_URL",
];

/** Plain configuration, stored as GitHub Actions variables so it stays visible in workflow runs. */
const GITHUB_VARIABLES = [
  "SPEECHIFY_VOICE_ID",
  "SPEECHIFY_MONTHLY_CHARS",
  "SINGULARITY_GIT_NAME",
  "SINGULARITY_GIT_EMAIL",
];

/**
 * Environment variables for the site's server routes on Vercel: the Generate button's three, then
 * what /api/narrate needs to narrate a digest on Play. The Blob token is sent only when .env holds
 * one; a store connected through OIDC needs none (D26). CRON_SECRET is what Vercel Cron sends to
 * /api/cron/run, which refuses every call without it (D61).
 */
const VERCEL_ENV = [
  "GITHUB_SINGULARITY_TOKEN",
  "GITHUB_REPOSITORY",
  "SPEECHIFY_API_KEY",
  "SPEECHIFY_VOICE_ID",
  "SPEECHIFY_MONTHLY_CHARS",
  "BLOB_READ_WRITE_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_ADMIN_KEY",
  "TYPESAFE_API_KEY",
  // The topic emoji backup (Gemini Flash-Lite) runs on a site request.
  "GEMINI_API_KEY",
  "CRON_SECRET",
  "DATABASE_URL",
];

/**
 * The command center's sign-in (D224). They go to the separate singularity-admin Vercel project, not
 * the reader's, so they need `apps/admin` linked to it; without that link nothing is sent, because
 * the reader's own link would take them.
 */
const VERCEL_ADMIN_ENV = ["ADMIN_PASSWORD", "ADMIN_SESSION_SECRET"];

/** What `vercel env pull` writes in place of a hidden value. Sending it on would overwrite the real one. */
const SENSITIVE_PLACEHOLDER = "[SENSITIVE]";

const TARGETS: Target[] = [
  ...GITHUB_SECRETS.map((name): Target => ({ name, where: "github-secret" })),
  ...GITHUB_VARIABLES.map((name): Target => ({ name, where: "github-variable" })),
  ...VERCEL_ENV.map((name): Target => ({ name, where: "vercel" })),
  ...VERCEL_ADMIN_ENV.map((name): Target => ({ name, where: "vercel-admin" })),
];

function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  if (!out.SINGULARITY_GIT_NAME && out.DISPATCH_GIT_NAME) {
    out.SINGULARITY_GIT_NAME = out.DISPATCH_GIT_NAME;
  }
  if (!out.SINGULARITY_GIT_EMAIL && out.DISPATCH_GIT_EMAIL) {
    out.SINGULARITY_GIT_EMAIL = out.DISPATCH_GIT_EMAIL;
  }
  if (!out.GITHUB_SINGULARITY_TOKEN && out.GITHUB_DISPATCH_TOKEN) {
    out.GITHUB_SINGULARITY_TOKEN = out.GITHUB_DISPATCH_TOKEN;
  }
  return out;
}

/** The first useful line of what a failed command wrote to stderr, with every .env value masked. */
function reasonOf(error: unknown, values: Record<string, string>): string {
  const stderr = (error as { stderr?: Buffer | string }).stderr;
  let text = stderr ? String(stderr) : error instanceof Error ? error.message : String(error);
  for (const value of Object.values(values)) {
    if (value.length >= 6) text = text.split(value).join("***");
  }
  const lines = text
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(
      (entry) =>
        entry !== "" &&
        !/DeprecationWarning|trace-deprecation|^npm (notice|warn)|^<claude-code-hint/.test(entry),
    );
  // Prefer the line that says what went wrong; tools print notices and hints around it.
  const line =
    lines.find((entry) =>
      /error|invalid|denied|not found|unauthor|token|login|link/i.test(entry),
    ) ?? lines.at(-1);
  return (line ?? "no message").slice(0, 200);
}

/** What may reach a shell unquoted: names, flags and an owner/repo. A value never does; it goes on stdin. */
const SHELL_SAFE = /^[\w./-]+$/;

function run(
  file: string,
  args: string[],
  input: string,
  env: NodeJS.ProcessEnv,
  cwd?: string,
): void {
  // The value only travels on stdin. Output is discarded so it can never be echoed.
  const options = {
    input,
    env,
    cwd,
    stdio: ["pipe", "ignore", "pipe"] as ["pipe", "ignore", "pipe"],
  };
  if (process.platform !== "win32") {
    execFileSync(file, args, options);
    return;
  }
  // Windows reaches gh and npx through the shell. Node deprecates handing an argument list to a
  // shell, which joins it unquoted (DEP0190), so the line is joined here, from parts that need no
  // quoting.
  const parts = [file, ...args];
  if (!parts.every((part) => SHELL_SAFE.test(part))) {
    throw new Error("an argument would need quoting in the shell");
  }
  execSync(parts.join(" "), options);
}

/** The first of these directories where `vercel link` was run. */
function linkedVercelDir(candidates: string[]): string | undefined {
  return candidates
    .map((dir) => resolve(dir))
    .find((dir) => existsSync(join(dir, ".vercel", "project.json")));
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const onlyIndex = args.indexOf("--only");
  const only = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined;

  const envPath = resolve(".env");
  if (!existsSync(envPath)) {
    console.error("No .env found. Copy .env.example to .env and fill it in first.");
    process.exitCode = 1;
    return;
  }
  const values = parseDotenv(readFileSync(envPath, "utf8"));
  const repo = values.GITHUB_REPOSITORY || "somesh-ks/knowledge-hub";
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  // The Vercel CLI uses its own login. The VERCEL_TOKEN in .env is the one GitHub Actions needs;
  // passing it to the CLI as well made every Vercel push fail with "Could not retrieve Project
  // Settings" once that token was rotated or revoked, while the login still worked.
  delete childEnv.VERCEL_TOKEN;

  // The reader's project: the repository root or apps/web. The admin project: apps/admin only.
  const vercelDir = linkedVercelDir([".", "apps/web"]);
  const adminDir = linkedVercelDir(["apps/admin"]);
  if (!vercelDir && only !== "github" && !dryRun) {
    console.error(
      "The Vercel project is not linked. Run `vercel link` first, or use --only github.",
    );
  }

  const sent: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  const reasons = new Map<string, string>();

  for (const target of TARGETS) {
    const value = values[target.name];
    const scope = target.where.startsWith("vercel") ? "vercel" : "github";
    if (only && only !== scope) continue;
    if (!value || value === SENSITIVE_PLACEHOLDER) {
      // A name can have two destinations now (GitHub and Vercel); report it once.
      if (!skipped.includes(target.name)) skipped.push(target.name);
      continue;
    }
    if (dryRun) {
      sent.push(`${target.name} -> ${target.where}`);
      continue;
    }
    try {
      switch (target.where) {
        case "github-secret":
          run("gh", ["secret", "set", target.name, "--repo", repo], value, childEnv);
          break;
        case "github-variable":
          run("gh", ["variable", "set", target.name, "--repo", repo], value, childEnv);
          break;
        case "vercel":
          run(
            "npx",
            ["vercel", "env", "add", target.name, "production", "--force"],
            value,
            childEnv,
            vercelDir,
          );
          break;
        case "vercel-admin":
          if (!adminDir) {
            throw new Error("apps/admin is not linked to singularity-admin: run vercel link there");
          }
          run(
            "npx",
            ["vercel", "env", "add", target.name, "production", "--force"],
            value,
            childEnv,
            adminDir,
          );
          break;
        default: {
          const unreachable: never = target.where;
          throw new Error(`Unknown target ${String(unreachable)}`);
        }
      }
      sent.push(`${target.name} -> ${target.where}`);
    } catch (error) {
      failed.push(target.name);
      reasons.set(`${target.name} -> ${target.where}`, reasonOf(error, values));
    }
  }

  console.log(`${dryRun ? "Would send" : "Sent"} (${sent.length}):`);
  for (const line of sent) console.log(`  ${line}`);
  if (skipped.length)
    console.log(`Empty in .env, skipped (${skipped.length}): ${skipped.join(", ")}`);
  if (failed.length) {
    console.error(
      `Failed (${failed.length}): ${failed.join(", ")}. Check gh and vercel login, then retry.`,
    );
    // The reason, not the value: stderr is masked against every value in .env before it is shown.
    for (const [target, reason] of reasons) console.error(`  ${target}: ${reason}`);
    process.exitCode = 1;
  }
}

main();
