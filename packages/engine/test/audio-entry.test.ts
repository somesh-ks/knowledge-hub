import { readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  addUsage,
  BUDGET_RATIO,
  buildSpokenText,
  checkBudget,
  createSpeechifyClient,
  emptyUsage,
  isMarksUnavailable,
  parseMonthlyChars,
  readSse,
  resolveTimeline,
  usageMonth,
} from "../src/audio/index.js";

/**
 * `@singularity/engine/audio` is bundled into the site's narrate function, which has no repository to
 * read and must not carry the run pipeline. This walks the entry's run-time imports and fails when a
 * module outside src/audio, or a package outside the short allowlist, becomes reachable.
 */

const AUDIO_DIR = resolve(import.meta.dirname, "..", "src", "audio");
const ENTRY = join(AUDIO_DIR, "index.ts");

/** Packages the entry may load at run time. Every `node:` module is refused, node:fs above all. */
const ALLOWED_PACKAGES = new Set(["@singularity/core", "zod"]);

/** Specifiers a file loads at run time. Type-only imports are erased by the compiler, so they do not count. */
function runtimeImports(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      if (!node.importClause?.isTypeOnly) found.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      if (!node.isTypeOnly) found.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const [argument] = node.arguments;
      if ((isDynamicImport || isRequire) && argument && ts.isStringLiteralLike(argument)) {
        found.push(argument.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

interface ImportGraph {
  /** Every engine file reachable from the entry, by file name. */
  files: string[];
  violations: string[];
}

function walk(entry: string): ImportGraph {
  const seen = new Set<string>();
  const violations: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);
    const from = basename(file);
    for (const specifier of runtimeImports(file)) {
      if (!specifier.startsWith(".")) {
        if (!ALLOWED_PACKAGES.has(specifier)) violations.push(`${from} imports ${specifier}`);
        continue;
      }
      const target = resolve(dirname(file), specifier.replace(/\.js$/, ".ts"));
      if (relative(AUDIO_DIR, target).startsWith("..")) {
        violations.push(`${from} imports ${specifier}, outside src/audio`);
        continue;
      }
      queue.push(target);
    }
  }
  return { files: [...seen].map((file) => basename(file)).sort(), violations };
}

describe("@singularity/engine/audio", () => {
  it("exposes the narration code the narrate function calls", () => {
    const exposed = {
      buildSpokenText,
      resolveTimeline,
      readSse,
      createSpeechifyClient,
      isMarksUnavailable,
      checkBudget,
      addUsage,
      emptyUsage,
      usageMonth,
      parseMonthlyChars,
    };
    for (const [name, value] of Object.entries(exposed)) {
      expect(typeof value, name).toBe("function");
    }
    expect(BUDGET_RATIO).toBe(0.9);
  });

  it("reaches no file-system, git or pipeline module", () => {
    const graph = walk(ENTRY);
    expect(graph.violations).toEqual([]);
    // The two modules in this folder that touch the disk must stay out of reach.
    expect(graph.files).not.toContain("budget.ts");
    expect(graph.files).not.toContain("atomicFile.ts");
    expect(graph.files).toEqual(
      expect.arrayContaining([
        "budgetMath.ts",
        "speechify.ts",
        "spokenText.ts",
        "sse.ts",
        "timeline.ts",
      ]),
    );
  });

  it("would catch a file-system import, shown on the module that has one", () => {
    const graph = walk(join(AUDIO_DIR, "budget.ts"));
    expect(graph.violations).toContain("budget.ts imports node:fs/promises");
    expect(graph.violations).toContain("atomicFile.ts imports node:fs/promises");
  });

  it("would catch a reach into the pipeline, shown on the publish step", () => {
    const publish = resolve(AUDIO_DIR, "..", "publish", "publishAudio.ts");
    expect(walk(publish).violations.some((line) => line.includes("outside src/audio"))).toBe(true);
  });
});
