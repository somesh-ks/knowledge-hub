import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Fails the build when the Vercel Function cannot answer a request on its own. The function is
 * copied out of the repository first, so it sees only the files the adapter traced into it, as on
 * Vercel. @astrojs/vercel 11.0.13 left a bare `import "rolldown"` in the function's entry, whose
 * native binding was never traced: every API route answered 500 in production while the build, the
 * unit tests and the browser suites (which stub the API routes) all passed.
 *
 * Usage: npx tsx apps/web/scripts/checkFunction.ts (after a build with the adapter)
 */

if ((process.env.SINGULARITY_STATIC_ONLY ?? process.env.DISPATCH_STATIC_ONLY) === "1")
  process.exit(0);

const HERE = dirname(fileURLToPath(import.meta.url));
const source = join(HERE, "..", ".vercel", "output", "functions", "_render.func");
if (!existsSync(source)) {
  console.error(`No function at ${source}. Run the build first.`);
  process.exit(1);
}

const { handler } = JSON.parse(readFileSync(join(source, ".vc-config.json"), "utf8")) as {
  handler: string;
};
const copy = mkdtempSync(join(tmpdir(), "dispatch-function-"));
try {
  cpSync(source, copy, { recursive: true, dereference: true });
  // A GET to a POST-only route reads no settings, so it answers 405 whatever the environment.
  const probe = `
    const { default: app } = await import(${JSON.stringify(`./${handler}`)});
    const response = await app.fetch(new Request("http://localhost/api/podcast"));
    if (response.status !== 405) throw new Error("GET /api/podcast answered " + response.status);
  `;
  execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
    cwd: copy,
    env: { PATH: process.env.PATH ?? "" },
    stdio: ["ignore", "ignore", "pipe"],
    timeout: 60_000,
  });
  console.log("Function check: the server answers on its own.");
} catch (error) {
  const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
  console.error("The Vercel Function fails outside the repository, as it would on Vercel:");
  console.error(stderr || String(error));
  process.exitCode = 1;
} finally {
  rmSync(copy, { recursive: true, force: true });
}
