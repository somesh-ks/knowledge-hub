import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findRepoRoot } from "./repoRoot";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "dispatch-root-"));
  temporary.push(root);
  mkdirSync(join(root, "packages", "core"), { recursive: true });
  writeFileSync(join(root, "packages", "core", "package.json"), "{}");
  mkdirSync(join(root, "apps", "web", "src"), { recursive: true });
  return root;
}

describe("findRepoRoot", () => {
  it("prefers DISPATCH_REPO_ROOT", () => {
    expect(findRepoRoot("/anywhere", { DISPATCH_REPO_ROOT: "/some/root" })).toBe(
      resolve("/some/root"),
    );
  });

  it("walks up to the directory that holds the core package", () => {
    const root = makeRepo();
    expect(findRepoRoot(join(root, "apps", "web", "src"), {})).toBe(root);
    expect(findRepoRoot(root, {})).toBe(root);
  });

  it("fails clearly outside a repository", () => {
    const outside = mkdtempSync(join(tmpdir(), "dispatch-outside-"));
    temporary.push(outside);
    expect(() => findRepoRoot(outside, {})).toThrow(/repository root/);
  });
});
