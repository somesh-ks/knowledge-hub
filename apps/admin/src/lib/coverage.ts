/**
 * Coverage's numbers, counted at build from the reader's and this app's sources with the system's
 * own class reader (scripts/system/build.ts): how many files draw each shared part, and how many
 * draw each one-off control. A part is drawn by a file that writes one of its classes or imports
 * one of its components; its own files are its definition, not a use. The numbers are as of this
 * app's build.
 *
 * shortcut: the admin app rebuilds only when tokens or the design system change (ignore-build.sh), so a
 * page edit that touches neither shows on the next such build; widen the list if every edit must count.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { classTokens } from "../../../../scripts/system/build";
import type { BespokeControl, PartKind, System } from "../../../../scripts/system/types";

export interface PartUse {
  id: string;
  name: string;
  kind: PartKind;
  summary: string;
  files: number;
}

export interface OneOffUse {
  name: string;
  reason: string;
  files: number;
}

export interface Coverage {
  parts: PartUse[];
  oneOffs: OneOffUse[];
  /** Files drawing a part, summed over parts, and the same for one-offs. */
  partUses: number;
  oneOffUses: number;
}

/** The repository's root: the first folder up from the build's own that holds tokens/system.json. */
export function repoRoot(from: string = process.cwd()): string {
  let dir = from;
  while (!existsSync(join(dir, "tokens/system.json"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error(`No tokens/system.json above ${from}`);
    dir = up;
  }
  return dir;
}

const stem = (path: string): string => (path.split("/").pop() ?? path).replace(/\.\w+$/, "");

/** Whether `text` imports a module named `name` (any folder, any extension). */
const importsModule = (text: string, name: string): boolean =>
  new RegExp(`from\\s+["'][^"']*/${name}(?:\\.\\w+)?["']`).test(text);

interface Source {
  path: string;
  text: string;
  tokens: Set<string>;
}

/**
 * The apps' own files, as the system's reader reads them (sourceFiles in build.ts, which finds the
 * repository from its own path and so cannot from this app's bundle). The design system's files are
 * its definition, so a part one of them draws is not counted as the apps drawing it.
 */
export function appSources(root: string = repoRoot()): Source[] {
  return ["apps/web/src", "apps/admin/src"]
    .flatMap((dir) =>
      readdirSync(join(root, dir), { recursive: true, encoding: "utf8" }).map((file) =>
        join(root, dir, file).split("\\").join("/"),
      ),
    )
    .filter(
      (path) =>
        /\.(astro|tsx|ts|js)$/.test(path) &&
        !path.endsWith(".test.ts") &&
        !path.includes("/pages/design/") &&
        !path.includes("/design-system/"),
    )
    .map((path) => {
      const text = readFileSync(path, "utf8");
      return { path, text, tokens: classTokens(text) };
    });
}

export function countCoverage(system: System, sources: Source[] = appSources()): Coverage {
  // A module more than one part names (Button.astro draws four) says nothing about which: those
  // parts are told apart by the classes the reader finds (a Button's variant is one).
  const owners = new Map<string, number>();
  for (const part of system.parts)
    for (const file of part.files ?? []) owners.set(stem(file), (owners.get(stem(file)) ?? 0) + 1);
  const parts = system.parts.map((part): PartUse => {
    const own = part.files ?? [];
    const modules = own.map(stem).filter((name) => owners.get(name) === 1);
    const files = sources.filter(
      (source) =>
        !own.some((file) => source.path.endsWith(file)) &&
        (part.classes.some((name) => source.tokens.has(name)) ||
          modules.some((name) => importsModule(source.text, name))),
    ).length;
    return { id: part.id, name: part.name, kind: part.kind, summary: part.summary, files };
  });
  // A bespoke class a part lists is used through that part; the rest are built for one place.
  const oneOffs = system.bespoke
    .filter((control: BespokeControl) => !control.part)
    .map((control) => ({
      name: control.class,
      reason: control.reason,
      files: sources.filter((source) => source.tokens.has(control.class)).length,
    }));
  return {
    parts,
    oneOffs,
    partUses: parts.reduce((sum, part) => sum + part.files, 0),
    oneOffUses: oneOffs.reduce((sum, control) => sum + control.files, 0),
  };
}
