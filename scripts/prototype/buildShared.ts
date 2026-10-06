/**
 * Shared helpers for the two self-contained prototype pages: bundle a TypeScript entry with
 * esbuild, embed the fonts as base64, and fill an HTML template.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { hexFor, loadTokens } from "../buildTokens.js";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function readText(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

export async function bundleScript(entryRelativePath: string): Promise<string> {
  const result = await build({
    entryPoints: [resolve(ROOT, entryRelativePath)],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    write: false,
    minify: false,
    legalComments: "none",
    logLevel: "warning",
  });
  const output = result.outputFiles[0]?.text ?? "";
  // A literal closing script tag inside inline JS would end the element early.
  return output.replace(/<\/script/gi, "<\\/script");
}

function fontFace(family: string, weights: string, relativePath: string): string {
  const base64 = readFileSync(resolve(ROOT, relativePath)).toString("base64");
  return `@font-face{font-family:"${family}";font-style:normal;font-weight:${weights};font-display:swap;src:url(data:font/woff2;base64,${base64}) format("woff2-variations"),url(data:font/woff2;base64,${base64}) format("woff2");}`;
}

/** Latin subsets of the two families, embedded so the page works offline. */
export function fontsCss(): string {
  return [
    fontFace(
      "Schibsted Grotesk Variable",
      "400 900",
      "node_modules/@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2",
    ),
    fontFace(
      "Literata Variable",
      "200 900",
      "node_modules/@fontsource-variable/literata/files/literata-latin-wght-normal.woff2",
    ),
  ].join("\n");
}

export function themeColors(): { light: string; dark: string } {
  const doc = loadTokens();
  return {
    light: hexFor(doc, "semantic.color.surface", "light"),
    dark: hexFor(doc, "semantic.color.surface", "dark"),
  };
}

export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (match, key: string) => values[key] ?? match);
}
