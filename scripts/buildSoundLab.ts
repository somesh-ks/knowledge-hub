/**
 * Builds docs/prototype/sound-lab.html: the real sound engine bundled into one self-contained page.
 *
 * Usage: npx tsx scripts/buildSoundLab.ts
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
import { MARK_SVG } from "./prototype/icons.js";

async function main(): Promise<void> {
  const colors = themeColors();
  const html = fillTemplate(readText("scripts/soundLab/sound-lab.template.tpl"), {
    THEME_LIGHT: colors.light,
    THEME_DARK: colors.dark,
    FONTS: fontsCss(),
    TOKENS: buildTokensCss(),
    FOUNDATIONS: readText("apps/web/src/styles/foundations.css"),
    PROTOTYPE: readText("scripts/prototype/ui-prototype.css"),
    LAB: readText("scripts/soundLab/sound-lab.css"),
    MARK: MARK_SVG,
    SCRIPT: await bundleScript("scripts/soundLab/soundLab.ts"),
  });
  const out = resolve(ROOT, "docs/prototype/sound-lab.html");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html, "utf8");
  console.log(`Wrote ${out} (${Math.round(html.length / 1024)} KB)`);
}

await main();
