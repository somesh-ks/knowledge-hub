// The fast checks in parallel: typecheck, lint and the unit tests, plus the static site build with
// --build. One process starts the others, so a shell that is slow to spawn (Git Bash on Windows:
// 3 to 8 s a process, against 50 ms from PowerShell) pays once. Exit 1 if any step fails.
//
// Usage: npm run gate [-- --build]
import { spawn } from "node:child_process";

const steps = [
  { name: "typecheck", command: "npm run typecheck" },
  { name: "lint", command: "npm run lint" },
  { name: "test", command: "npm test" },
];
if (process.argv.includes("--build")) {
  steps.push({ name: "build", command: "npm run build", env: { DISPATCH_STATIC_ONLY: "1" } });
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

const results = await Promise.all(steps.map(run));
for (const { name, code, seconds, output } of results) {
  console.log(
    `${code === 0 ? "pass" : "FAIL"}  ${name.padEnd(10)} ${String(seconds).padStart(4)} s`,
  );
  if (code !== 0) console.log(output.trim().split("\n").slice(-25).join("\n"));
}
process.exit(results.every((result) => result.code === 0) ? 0 : 1);
