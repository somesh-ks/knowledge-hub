// Gives a git worktree the main checkout's installed packages without an install, and takes them off
// again without touching the main checkout.
//
// Why not one junction for the whole node_modules: it would make @singularity/* resolve to the main
// checkout's packages, so a worktree's checks would test the wrong code. Here node_modules is a real
// folder of junctions, one per installed package, except @singularity/*, which point at the worktree's
// own packages. Removing a worktree whose node_modules is a junction deletes the main checkout's
// packages (Windows follows the link), so run `--remove` before `git worktree remove`.
//
// Usage: node scripts/worktreeLinks.mjs <worktree> [--remove]
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const worktree = resolve(process.argv[2] ?? ".");
const remove = process.argv.includes("--remove");
const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
  cwd: worktree,
  encoding: "utf8",
}).trim();
const main = dirname(common);
if (resolve(main) === worktree) throw new Error("That is the main checkout, not a worktree.");

const isLink = (path) => existsSync(path) && lstatSync(path).isSymbolicLink();
const link = (target, path) => {
  if (existsSync(path) || isLink(path)) return;
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path, "junction");
};

/** The installed folders of the main checkout: root, each app and each package. */
const homes = [
  "",
  ...["apps", "packages"].flatMap((group) => {
    const dir = join(main, group);
    return existsSync(dir) ? readdirSync(dir).map((name) => join(group, name)) : [];
  }),
];

if (remove) {
  // Only links are removed, and a walk never goes through one, so nothing of the main checkout is
  // touched. What is left (a cache a tool wrote) is the worktree's own, and `git worktree remove` can
  // delete it once no link is left.
  const unlink = (path) => {
    if (!existsSync(path) && !isLink(path)) return;
    if (isLink(path)) return rmdirSync(path);
    if (!lstatSync(path).isDirectory()) return;
    for (const name of readdirSync(path)) unlink(join(path, name));
  };
  for (const home of homes) unlink(join(worktree, home, "node_modules"));
  console.log("Unlinked node_modules from", worktree);
  process.exit(0);
}

const modules = join(main, "node_modules");
for (const name of readdirSync(modules)) {
  if (name === ".package-lock.json" || name === ".cache" || name === ".vite") continue;
  if (name !== "@dispatch") {
    link(join(modules, name), join(worktree, "node_modules", name));
    continue;
  }
  // The workspace's own packages resolve to this worktree's copies.
  for (const pkg of readdirSync(join(modules, name))) {
    const inMain = realpathSync(join(modules, name, pkg));
    link(join(worktree, relative(main, inMain)), join(worktree, "node_modules", name, pkg));
  }
}
for (const home of homes.slice(1)) {
  const installed = join(main, home, "node_modules");
  if (existsSync(installed)) link(installed, join(worktree, home, "node_modules"));
}
console.log("Linked node_modules into", worktree, "from", main);
