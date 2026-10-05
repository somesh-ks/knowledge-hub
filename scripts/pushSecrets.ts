// Sends values from the gitignored .env to GitHub Actions and Vercel without printing them.
// Usage: npm run secrets:push [-- --dry-run] [-- --only github|vercel]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Target {
  name: string;
  where: "github-secret" | "github-variable" | "vercel";
}

/** Secrets used by the GitHub Actions workflows. */
const GITHUB_SECRETS = [
  "TYPESAFE_API_KEY",
  "NEBIUS_API_KEY",
  "EXA_API_KEY",
  "FIRECRAWL_API_KEY",
  "SPEECHIFY_API_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "VERCEL_TOKEN",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
  "YOUTUBE_API_KEY",
];

/** Plain configuration, stored as GitHub Actions variables so it stays visible in workflow runs. */
const GITHUB_VARIABLES = [
  "NEBIUS_BASE_URL",
  "DISPATCH_MODEL",
  "DISPATCH_FALLBACK_MODEL",
  "SPEECHIFY_VOICE_ID",
];

/** Environment variables for the Generate button's server routes on Vercel. */
const VERCEL_ENV = ["GITHUB_DISPATCH_TOKEN", "GITHUB_REPOSITORY", "GENERATE_PASSPHRASE_HASH"];

const TARGETS: Target[] = [
  ...GITHUB_SECRETS.map((name): Target => ({ name, where: "github-secret" })),
  ...GITHUB_VARIABLES.map((name): Target => ({ name, where: "github-variable" })),
  ...VERCEL_ENV.map((name): Target => ({ name, where: "vercel" })),
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
  return out;
}

function run(
  file: string,
  args: string[],
  input: string,
  env: NodeJS.ProcessEnv,
  cwd?: string,
): void {
  // The value only travels on stdin. Output is discarded so it can never be echoed.
  execFileSync(file, args, {
    input,
    env,
    cwd,
    stdio: ["pipe", "ignore", "pipe"],
    shell: process.platform === "win32",
  });
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
  const repo = values.GITHUB_REPOSITORY || "somesh-ks/dispatch";
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  if (values.VERCEL_TOKEN) childEnv.VERCEL_TOKEN = values.VERCEL_TOKEN;

  const sent: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];

  for (const target of TARGETS) {
    const value = values[target.name];
    const scope = target.where === "vercel" ? "vercel" : "github";
    if (only && only !== scope) continue;
    if (!value) {
      skipped.push(target.name);
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
            resolve("apps/web"),
          );
          break;
        default: {
          const unreachable: never = target.where;
          throw new Error(`Unknown target ${String(unreachable)}`);
        }
      }
      sent.push(`${target.name} -> ${target.where}`);
    } catch {
      failed.push(target.name);
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
    process.exitCode = 1;
  }
}

main();
