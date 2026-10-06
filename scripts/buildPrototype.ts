/**
 * Builds docs/prototype/ui-prototype.html: one self-contained file with the real tokens, the real
 * foundations stylesheet, the real sound engine, embedded fonts and the prototype app.
 *
 * Usage: npx tsx scripts/buildPrototype.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildTokensCss } from "./buildTokens.js";
import {
  bundleScript,
  fillTemplate,
  fontsCss,
  ROOT,
  readText,
  themeColors,
} from "./prototype/buildShared.js";

async function main(): Promise<void> {
  const colors = themeColors();
  const html = fillTemplate(readText("scripts/prototype/ui-prototype.template.tpl"), {
    THEME_LIGHT: colors.light,
    THEME_DARK: colors.dark,
    FONTS: fontsCss(),
    TOKENS: buildTokensCss(),
    FOUNDATIONS: readText("apps/web/src/styles/foundations.css"),
    PROTOTYPE: readText("scripts/prototype/ui-prototype.css"),
    SCRIPT: await bundleScript("scripts/prototype/main.ts"),
  });
  const out = resolve(ROOT, "docs/prototype/ui-prototype.html");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html, "utf8");
  console.log(`Wrote ${out} (${Math.round(html.length / 1024)} KB)`);
}

await main();
