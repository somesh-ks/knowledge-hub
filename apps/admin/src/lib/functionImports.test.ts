import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const API_DIR = new URL("../../api/", import.meta.url);

// 2026-10-30: the Experiments function imported `@singularity/engine/...`. On Vercel that resolves
// to the package's .ts source under node_modules, which the function bundle leaves out, so every
// request crashed at load and the page quietly fell back to "Showing the last deploy". Build,
// typecheck and unit tests all passed. A workspace package must be imported by relative path.
describe("admin functions", () => {
  it("import workspace code by relative path, never by package name", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(API_DIR).filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(new URL(file, API_DIR), "utf8");
      for (const match of source.matchAll(/from\s+"(@singularity\/[^"]+)"/g)) {
        offenders.push(`${file}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
