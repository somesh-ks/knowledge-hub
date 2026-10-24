// The fast checks in parallel: typecheck, the site's type check (astro check), lint and the unit tests,
// plus the static site build with --build (it follows the site's type check: both write apps/web/.astro),
// and the docs check (scripts/docsCheck.mjs).
// One process starts the others, so a shell that is slow to spawn (Git Bash on Windows: 3 to 8 s a
// process, against 50 ms from PowerShell) pays once. Exit 1 if any step fails.
//
// Usage: npm run gate [-- --build]
import { spawn } from "node:child_process";

const chains = [
  [{ name: "typecheck", command: "npm run typecheck:packages" }],
  [{ name: "lint", command: "npm run lint" }],
  [{ name: "test", command: "npm test" }],
  [{ name: "site types", command: "npm run check -w @dispatch/web" }],
  [{ name: "docs", command: "node scripts/docsCheck.mjs" }],
];
if (process.argv.includes("--build")) {
  chains[3].push({
    name: "build",
    command: "npm run build",
    env: { SINGULARITY_STATIC_ONLY: "1" },
  });
}

const run = ({ name, command, env }) =>
  new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, {
      shell: true,
      env: { ...process.env, ...env, FORCE_COLOR: "0" },
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("close", (code) =>
      resolve({ name, code, seconds: Math.round((Date.now() - started) / 1000), output }),
    );
  });

const runChain = async (chain) => {
  const done = [];
  for (const step of chain) {
    const result = await run(step);
    done.push(result);
    if (result.code !== 0) break;
  }
  return done;
};

const results = (await Promise.all(chains.map(runChain))).flat();
for (const { name, code, seconds, output } of results) {
  console.log(
    `${code === 0 ? "pass" : "FAIL"}  ${name.padEnd(10)} ${String(seconds).padStart(4)} s`,
  );
  if (code !== 0) console.log(output.trim().split("\n").slice(-25).join("\n"));
}
process.exit(results.every((result) => result.code === 0) ? 0 : 1);
