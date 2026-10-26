import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";

// A worktree whose own packages resolve to the main checkout's copies runs its typecheck, unit and
// browser checks against main's code, and they pass. The two checkouts can be installed under
// different names (#272 renamed @dispatch/* to @singularity/*): the script matched the old scope by
// name, so a worktree got none of its own packages, or, once main reinstalled, main's.
const script = join(import.meta.dirname, "worktreeLinks.mjs");
const roots: string[] = [];
// A failed run can leave the worktree's links into main: they come off before the delete.
afterEach(() => {
  for (const root of roots.splice(0)) {
    try {
      links(join(root, "worktree"), "--remove");
    } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});

const put = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const junction = (target: string, path: string) => {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, "junction");
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Test Author",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, stdio: "ignore" },
  );
const links = (worktree: string, ...flags: string[]) =>
  execFileSync(process.execPath, [script, worktree, ...flags], { stdio: "ignore" });
const real = (path: string) => realpathSync.native(path);
const linksIn = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (lstatSync(path).isSymbolicLink()) return [path];
    return lstatSync(path).isDirectory() ? linksIn(path) : [];
  });

it("points the workspace's own packages at the worktree, under whichever name main was installed", () => {
  const root = real(mkdtempSync(join(tmpdir(), "worktree-links-")));
  roots.push(root);
  const main = join(root, "main");
  const worktree = join(root, "worktree");
  put(join(main, "packages/core/package.json"), JSON.stringify({ name: "@new/core" }));
  git(main, "init", "-q");
  git(main, "add", "-A");
  git(main, "commit", "-q", "-m", "init");
  git(main, "worktree", "add", "-q", "--detach", worktree);
  const own = real(join(worktree, "packages/core"));
  const resolved = (name: string) => real(join(worktree, "node_modules", name));

  // Main installed before the rename: its own package under the old name, and a third-party one.
  junction(join(main, "packages/core"), join(main, "node_modules/@old/core"));
  put(join(main, "node_modules/leftpad/package.json"), "{}");
  links(worktree);
  expect(resolved("@new/core"), "own package, new name").toBe(own);
  expect(existsSync(join(worktree, "node_modules/@old")), "main's own package, old name").toBe(
    false,
  );
  expect(resolved("leftpad"), "third-party package").toBe(real(join(main, "node_modules/leftpad")));
  links(worktree, "--remove");
  expect(linksIn(worktree), "links left after --remove").toEqual([]);
  expect(existsSync(join(main, "node_modules/leftpad/package.json")), "main's packages").toBe(true);

  // Main reinstalled under the new name, over a worktree an earlier run linked to main's whole scope.
  junction(join(main, "packages/core"), join(main, "node_modules/@new/core"));
  rmdirSync(join(worktree, "node_modules/@new"));
  junction(join(main, "node_modules/@new"), join(worktree, "node_modules/@new"));
  links(worktree);
  expect(resolved("@new/core"), "own package, after main reinstalled").toBe(own);
  links(worktree, "--remove");
  expect(linksIn(worktree), "links left after the second --remove").toEqual([]);
  expect(existsSync(join(main, "packages/core/package.json")), "main's own package").toBe(true);
});

// On 2026-10-26 the main checkout's @rolldown and @rollup were emptied: the script junctioned a whole
// third-party scope, so a tool that cleared a folder inside the worktree's scope cleared main's.
it("links a third-party scope package by package, so clearing it in the worktree leaves main whole", () => {
  const root = real(mkdtempSync(join(tmpdir(), "worktree-links-")));
  roots.push(root);
  const main = join(root, "main");
  const worktree = join(root, "worktree");
  put(join(main, "packages/core/package.json"), JSON.stringify({ name: "@new/core" }));
  git(main, "init", "-q");
  git(main, "add", "-A");
  git(main, "commit", "-q", "-m", "init");
  git(main, "worktree", "add", "-q", "--detach", worktree);
  put(join(main, "node_modules/@rolldown/binding/index.node"), "x");
  put(join(main, "node_modules/@rolldown/other/index.js"), "x");

  links(worktree);
  links(worktree);
  const scope = join(worktree, "node_modules/@rolldown");
  expect(lstatSync(scope).isSymbolicLink(), "scope is a link").toBe(false);
  expect(real(join(scope, "binding"))).toBe(real(join(main, "node_modules/@rolldown/binding")));

  // A tool that clears what a scope holds (a prune, a cache sweep) removes links, not main's files.
  rmSync(scope, { recursive: true, force: true });
  expect(
    existsSync(join(main, "node_modules/@rolldown/binding/index.node")),
    "main's package",
  ).toBe(true);
  links(worktree);
  expect(linksIn(worktree).length, "links after relinking").toBeGreaterThan(0);
  links(worktree, "--remove");
  expect(linksIn(worktree)).toEqual([]);
  expect(
    existsSync(join(main, "node_modules/@rolldown/binding/index.node")),
    "main's package",
  ).toBe(true);
});

// `--check` guards `git worktree remove`: a worktree kept anywhere but .claude/worktrees went
// unlisted, and removing it with links in place deletes main's packages.
it("--check lists a linked worktree wherever git registered it", () => {
  const root = real(mkdtempSync(join(tmpdir(), "worktree-links-")));
  roots.push(root);
  const main = join(root, "main");
  const worktree = join(root, "worktree");
  put(join(main, "packages/core/package.json"), JSON.stringify({ name: "@new/core" }));
  git(main, "init", "-q");
  git(main, "add", "-A");
  git(main, "commit", "-q", "-m", "init");
  git(main, "worktree", "add", "-q", "--detach", worktree);
  put(join(main, "node_modules/leftpad/package.json"), "{}");

  links(worktree);
  expect(() => links(main, "--check"), "a linked worktree outside .claude/worktrees").toThrow();
  links(worktree, "--remove");
  expect(() => links(main, "--check"), "no links left").not.toThrow();
});
