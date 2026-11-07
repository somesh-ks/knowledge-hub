// The package as a customer gets it (D382 step 5): `pnpm pack` the design system, install the tarball into
// a throwaway Astro project outside the workspace, and build a page that imports a component, a stylesheet
// (fonts.css, which pulls the font files) and a token file. The workspace link serves every file in the
// folder, so a path missing from `files`, a broken exports entry or a lost astro peer (Astro then leaves
// the .astro source to Node) passes every other check and fails only here.
//
// Usage: node scripts/designSystemPack.mjs  (installs offline from the pnpm store when it can)
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const packageDir = join(root, "packages/design-system");
const { name } = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
// The astro the apps build with, exact, so the install resolves from the store without the network.
const astro = JSON.parse(
  readFileSync(join(root, "apps/web/node_modules/astro/package.json"), "utf8"),
).version;

const work = mkdtempSync(join(tmpdir(), "ds-pack-"));
const pnpm = (args, cwd) =>
  execFileSync("pnpm", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

try {
  pnpm(["pack", "--pack-destination", work], packageDir);
  const tarball = readdirSync(work).find((file) => file.endsWith(".tgz"));
  const app = join(work, "app");
  mkdirSync(join(app, "src/pages"), { recursive: true });
  writeFileSync(
    join(app, "package.json"),
    JSON.stringify({
      name: "ds-pack-check",
      private: true,
      type: "module",
      dependencies: { astro, [name]: `file:../${tarball}` },
    }),
  );
  writeFileSync(
    join(app, "src/pages/index.astro"),
    [
      "---",
      `import Button from "${name}/Button.astro";`,
      `import "${name}/styles/tokens.css";`,
      `import "${name}/styles/fonts.css";`,
      `import tokens from "${name}/tokens/tokens.json";`,
      "---",
      '<html lang="en"><body><Button>Play</Button><p data-tokens={Object.keys(tokens).length}></p></body></html>',
      "",
    ].join("\n"),
  );
  let install = "offline";
  try {
    pnpm(["install", "--offline"], app);
  } catch {
    // shortcut: a store without astro's metadata (a fresh CI cache) fetches it; offline stays the default.
    install = "prefer-offline";
    pnpm(["install", "--prefer-offline"], app);
  }
  const installed = join(app, "node_modules", name);
  const shipped = readdirSync(installed, { recursive: true }).map(String);
  const problems = [];
  if (shipped.some((file) => file.endsWith(".test.ts"))) problems.push("the tarball ships tests");
  // Flags are copied by the apps, never imported, so the build below cannot see a missing one.
  if (!existsSync(join(installed, "flags/se.svg"))) problems.push("the tarball has no flags");
  pnpm(["exec", "astro", "build"], app);
  const html = readFileSync(join(app, "dist/index.html"), "utf8");
  if (!html.includes("<button")) problems.push("the page drew no Button");
  const assets = readdirSync(join(app, "dist/_astro"));
  if (!assets.some((file) => file.endsWith(".woff2")))
    problems.push("the build emitted no font file");
  if (problems.length > 0) throw new Error(problems.join("; "));
  console.log(`${tarball}: packs, installs (${install}) and builds (${shipped.length} files)`);
} catch (error) {
  const output = [error.stdout, error.stderr].filter(Boolean).join("\n").trim();
  console.error(`${name} failed the pack-and-install check: ${error.message}`);
  if (output) console.error(output.split("\n").slice(-30).join("\n"));
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
