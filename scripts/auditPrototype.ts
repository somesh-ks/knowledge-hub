/**
 * Runs axe-core against the prototype in the states that matter: home, listening, each sheet,
 * archive, and the page states, in light and dark. Prints violations and exits non-zero on any.
 *
 * Usage: npx tsx scripts/auditPrototype.ts
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AxeBuilder } from "@axe-core/playwright";
import { chromium, type Page } from "playwright";
import { ROOT } from "./prototype/buildShared.js";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

interface Audit {
  name: string;
  query: string;
  prepare?: (page: Page) => Promise<void>;
}

const audits: Audit[] = [
  { name: "home", query: "" },
  { name: "listening", query: "?at=4" },
  {
    name: "player",
    query: "?at=4",
    prepare: async (page) => {
      await page.tap("#miniOpen");
      await page.waitForTimeout(1200);
    },
  },
  {
    name: "generate",
    query: "",
    prepare: async (page) => {
      await page.tap("#openGenerate");
      await page.waitForTimeout(1200);
    },
  },
  {
    name: "settings",
    query: "",
    prepare: async (page) => {
      await page.tap("#openSettings");
      await page.waitForTimeout(1200);
    },
  },
  { name: "archive", query: "#/archive" },
  { name: "offline", query: "?state=offline" },
  { name: "nothing", query: "?state=nothing" },
  { name: "preparing", query: "?state=preparing" },
  { name: "empty", query: "?state=empty" },
];

async function main(): Promise<void> {
  const url = pathToFileURL(resolve(ROOT, "docs/prototype/ui-prototype.html")).href;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  let failures = 0;
  try {
    for (const scheme of ["light", "dark"] as const) {
      for (const audit of audits) {
        const context = await browser.newContext({
          viewport: { width: 390, height: 844 },
          isMobile: true,
          hasTouch: true,
          colorScheme: scheme,
        });
        const page = await context.newPage();
        await page.goto(`${url}${audit.query}`);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(400);
        if (audit.prepare) await audit.prepare(page);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        if (results.violations.length === 0) {
          console.log(`ok    ${scheme.padEnd(5)} ${audit.name}`);
        }
        for (const violation of results.violations) {
          failures += violation.nodes.length;
          console.log(
            `FAIL  ${scheme.padEnd(5)} ${audit.name}: ${violation.id} (${violation.impact})`,
          );
          for (const node of violation.nodes.slice(0, 3)) {
            console.log(
              `        ${node.target.join(" ")}\n        ${node.failureSummary?.split("\n").slice(0, 3).join(" | ")}`,
            );
          }
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  if (failures > 0) process.exit(1);
}

await main();
