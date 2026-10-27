// Gives a git worktree the main checkout's installed packages without an install, and takes them off
// again without touching the main checkout.
//
// Why not one junction for the whole node_modules: it would make the workspace's own packages resolve
// to the main checkout's, so a worktree's checks would test the wrong code. Here node_modules is a real
// folder of junctions, one per installed package, except the workspace's own packages, which point at
// the worktree's copies. Their names come from the worktree's package.json files, and the main
// checkout's own links are left out by where they point, never by a scope name: the two checkouts can
// be installed under different names (#272 renamed @dispatch/* to @singularity/*). Removing a worktree
// whose node_modules is a junction deletes the main checkout's packages (Windows follows the link), so
// run `--remove` before `git worktree remove`.
//
// Usage: node scripts/worktreeLinks.mjs <worktree> [--remove]
//        node scripts/worktreeLinks.mjs <any worktree or main> --check   (lists worktrees that still hold links)
// Safe to run again: links that exist stay, and a stale scope link becomes a real folder of links.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const worktree = resolve(process.argv.find((arg, i) => i >= 2 && !arg.startsWith("--")) ?? ".");
const remove = process.argv.includes("--remove");
const check = process.argv.includes("--check");
const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
  cwd: worktree,
  encoding: "utf8",
}).trim();
const main = dirname(common);
if (!check && resolve(main) === worktree)
  throw new Error("That is the main checkout, not a worktree.");

// lstat, so a link whose target is gone still counts as one.
const isLink = (path) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};
// Takes off the link itself, never what it points at: rmdir takes a Windows junction, and refuses
// (ENOTDIR) a Linux symlink or a Windows file link, which unlink takes.
const unlink = (path) => {
  if (!isLink(path)) throw new Error(`Refusing to unlink ${path}: it is not a link.`);
  const target = real(path);
  try {
    rmdirSync(path);
  } catch (error) {
    if (error.code !== "ENOTDIR") throw error;
    unlinkSync(path);
  }
  if (target && !existsSync(target))
    throw new Error(`Unlinking ${path} removed its target ${target}.`);
};
const link = (target, path) => {
  if (existsSync(path) || isLink(path)) return;
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, "junction");
};
const real = (path) => {
  try {
    return realpathSync.native(path);
  } catch {
    return undefined;
  }
};

/** The installed folders of the main checkout: root, each app and each package. */
const homes = [
  "",
  ...["apps", "packages"].flatMap((group) => {
    const dir = join(main, group);
    return existsSync(dir) ? readdirSync(dir).map((name) => join(group, name)) : [];
  }),
];

if (check) {
  // Lists each worktree under .claude/worktrees that holds a link, so the main session unlinks it
  // before anything deletes it. Never follows a link.
  const found = (path) => {
    if (isLink(path)) return [path];
    if (!existsSync(path) || !lstatSync(path).isDirectory()) return [];
    return readdirSync(path).flatMap((name) => found(join(path, name)));
  };
  // Every worktree git has registered, wherever it lives, not only those under .claude/worktrees.
  const registered = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: main,
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => resolve(line.slice("worktree ".length)))
    .filter((path) => path !== resolve(main));
  const held = registered
    .map((path) => {
      // Main's folders and the worktree's own: main may have dropped a package a worktree still links.
      const own = ["apps", "packages"].flatMap((group) => {
        const dir = join(path, group);
        return existsSync(dir) ? readdirSync(dir).map((name) => join(group, name)) : [];
      });
      return [
        path,
        [...new Set([...homes, ...own])].flatMap((home) => found(join(path, home, "node_modules"))),
      ];
    })
    .filter(([, list]) => list.length > 0);
  for (const [name, list] of held) console.log(`${name}: ${list.length} links`);
  if (held.length > 0) {
    console.log(
      "Run `node scripts/worktreeLinks.mjs <path> --remove` for each before deleting it.",
    );
    process.exit(1);
  }
  console.log("No worktree holds links.");
  process.exit(0);
}

if (remove) {
  // Only links are removed, and a walk never goes through one, so nothing of the main checkout is
  // touched. What is left (a cache a tool wrote) is the worktree's own, and `git worktree remove` can
  // delete it once no link is left.
  const unlinkAll = (path) => {
    if (isLink(path)) return unlink(path);
    if (!existsSync(path) || !lstatSync(path).isDirectory()) return;
    for (const name of readdirSync(path)) unlinkAll(join(path, name));
  };
  for (const home of homes) unlinkAll(join(worktree, home, "node_modules"));
  console.log("Unlinked node_modules from", worktree);
  process.exit(0);
}

/** The workspace's own packages, by the names this worktree's package.json files give them. */
const own = new Map(
  ["apps", "packages"].flatMap((group) => {
    const dir = join(worktree, group);
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap((name) => {
      const manifest = join(dir, name, "package.json");
      if (!existsSync(manifest)) return [];
      const packageName = JSON.parse(readFileSync(manifest, "utf8")).name;
      return typeof packageName === "string" ? [[packageName, join(dir, name)]] : [];
    });
  }),
);
/** The main checkout's own packages as it installed them: links into its apps and packages. */
const mainOwn = new Set(
  homes
    .slice(1)
    .map((home) => real(join(main, home)))
    .filter(Boolean),
);
const isMainOwn = (path) => isLink(path) && mainOwn.has(real(path));

const modules = join(main, "node_modules");
const linked = join(worktree, "node_modules");
// An earlier run may have linked an own package's name to the main checkout (a whole scope, or the
// package itself, when the main checkout was installed under that name). Those links come off first.
for (const [name, dir] of own) {
  const scope = join(linked, name.split("/")[0]);
  if (name.includes("/") && isLink(scope)) unlink(scope);
  const path = join(linked, name);
  if (isLink(path) && real(path) !== real(dir)) unlink(path);
}
const shared = (name) => !own.has(name) && !isMainOwn(join(modules, name));
for (const name of readdirSync(modules)) {
  if (name === ".package-lock.json" || name === ".cache" || name === ".vite") continue;
  const path = join(modules, name);
  // Every scope is a real folder in the worktree with one junction per package, never one junction for
  // the scope: a tool that writes or deletes inside a scope junction acts on the main checkout (it
  // emptied @rolldown and @rollup there on 2026-10-26).
  const split = name.startsWith("@") && existsSync(path) && statSync(path).isDirectory();
  if (!split) {
    if (shared(name)) link(path, join(linked, name));
    continue;
  }
  // A scope link an earlier run left comes off first, so the scope becomes a real folder.
  if (isLink(join(linked, name))) unlink(join(linked, name));
  for (const pkg of readdirSync(path)) {
    if (shared(`${name}/${pkg}`)) link(join(path, pkg), join(linked, name, pkg));
  }
}
// The workspace's own packages resolve to this worktree's copies.
for (const [name, dir] of own) link(dir, join(linked, name));
for (const home of homes.slice(1)) {
  const installed = join(main, home, "node_modules");
  if (existsSync(installed)) link(installed, join(worktree, home, "node_modules"));
}
console.log("Linked node_modules into", worktree, "from", main);
