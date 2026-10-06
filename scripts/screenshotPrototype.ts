/**
 * Renders the UI prototype in headless Chrome and saves review screenshots.
 *
 * Usage: npx tsx scripts/screenshotPrototype.ts [outDir] [sceneNamePrefix | --keep]
 * Default outDir is docs/design/screenshots. Chrome is driven through Playwright's CDP emulation,
 * so the 390px phone viewport is honored without the headless minimum window width. Interactions
 * use real taps and pointer events, so focus and gesture behavior match a device.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";
import { ROOT } from "./prototype/buildShared.js";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

interface Scene {
  name: string;
  width: number;
  height: number;
  scheme: "light" | "dark";
  query: string;
  file?: string;
  fullPage?: boolean;
  run?: (page: Page) => Promise<void>;
}

const settle = (page: Page, ms = 900): Promise<void> => page.waitForTimeout(ms);

const PHONE = { width: 390, height: 844 };
const SMALL = { width: 320, height: 568 };
const TABLET = { width: 820, height: 1180 };
const DESKTOP = { width: 1280, height: 860 };

const openPlayer = async (page: Page): Promise<void> => {
  await page.tap("#miniOpen");
  await settle(page, 1300);
};

const scrubberBox = async (page: Page) => {
  const box = await page.locator("#scrubber").boundingBox();
  if (!box) throw new Error("no scrubber");
  return box;
};

const scenes: Scene[] = [
  { name: "home-phone-light", ...PHONE, scheme: "light", query: "" },
  { name: "home-phone-dark", ...PHONE, scheme: "dark", query: "" },
  { name: "home-small-light", ...SMALL, scheme: "light", query: "" },
  {
    name: "listening-phone-light",
    ...PHONE,
    scheme: "light",
    query: "?at=4",
    run: (page) => settle(page, 1200),
  },
  {
    name: "listening-phone-dark",
    ...PHONE,
    scheme: "dark",
    query: "?at=4",
    run: (page) => settle(page, 1200),
  },
  { name: "player-phone-light", ...PHONE, scheme: "light", query: "?at=4", run: openPlayer },
  { name: "player-phone-dark", ...PHONE, scheme: "dark", query: "?at=4", run: openPlayer },
  {
    name: "player-scrubbing-phone-light",
    ...PHONE,
    scheme: "light",
    query: "?at=2",
    run: async (page) => {
      await openPlayer(page);
      const box = await scrubberBox(page);
      await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.55, box.y + box.height / 2, { steps: 8 });
      await settle(page, 500);
    },
  },
  {
    name: "generate-phone-light",
    ...PHONE,
    scheme: "light",
    query: "",
    run: async (page) => {
      await page.tap("#openGenerate");
      await settle(page, 1400);
    },
  },
  {
    name: "generate-error-phone-light",
    ...PHONE,
    scheme: "light",
    query: "",
    run: async (page) => {
      await page.tap("#openGenerate");
      await settle(page, 1000);
      await page.fill("#pass", "wrong");
      await page.tap("#generateBtn");
      await settle(page, 500);
    },
  },
  {
    name: "generate-running-phone-dark",
    ...PHONE,
    scheme: "dark",
    query: "",
    run: async (page) => {
      await page.tap("#openGenerate");
      await settle(page, 1200);
      await page.fill("#pass", "demo");
      await page.tap("#generateBtn");
      await settle(page, 3700);
    },
  },
  {
    name: "generate-done-phone-light",
    ...PHONE,
    scheme: "light",
    query: "",
    run: async (page) => {
      await page.tap("#openGenerate");
      await settle(page, 1000);
      await page.fill("#pass", "demo");
      await page.tap("#generateBtn");
      await settle(page, 8600);
    },
  },
  {
    name: "settings-phone-dark",
    ...PHONE,
    scheme: "dark",
    query: "",
    run: async (page) => {
      await page.tap("#openSettings");
      await settle(page, 1300);
    },
  },
  {
    name: "settings-phone-light",
    ...PHONE,
    scheme: "light",
    query: "",
    run: async (page) => {
      await page.tap("#openSettings");
      await settle(page, 1300);
    },
  },
  {
    name: "archive-phone-light",
    ...PHONE,
    scheme: "light",
    query: "#/archive",
    run: (page) => settle(page, 600),
  },
  { name: "state-offline-phone-light", ...PHONE, scheme: "light", query: "?state=offline" },
  { name: "state-nothing-phone-dark", ...PHONE, scheme: "dark", query: "?state=nothing" },
  { name: "state-preparing-phone-light", ...PHONE, scheme: "light", query: "?state=preparing" },
  { name: "state-empty-phone-light", ...PHONE, scheme: "light", query: "?state=empty" },
  {
    name: "home-tablet-light",
    ...TABLET,
    scheme: "light",
    query: "?at=2",
    run: (page) => settle(page, 1200),
  },
  {
    name: "player-tablet-dark",
    ...TABLET,
    scheme: "dark",
    query: "?at=2",
    run: async (page) => {
      await page.click("#miniOpen");
      await settle(page, 1300);
    },
  },
  {
    name: "lab-phone-light",
    ...PHONE,
    scheme: "light",
    query: "",
    file: "sound-lab.html",
    fullPage: true,
  },
  {
    name: "lab-cards-desktop-light",
    ...DESKTOP,
    scheme: "light",
    query: "",
    file: "sound-lab.html",
    run: async (page) => {
      await page.locator("#soundGrid").scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -40));
      await settle(page, 500);
    },
  },
  { name: "lab-desktop-dark", ...DESKTOP, scheme: "dark", query: "", file: "sound-lab.html" },
  {
    name: "home-desktop-dark",
    ...DESKTOP,
    scheme: "dark",
    query: "?at=3",
    run: (page) => settle(page, 1200),
  },
];

/** The scenes saved to docs/design/screenshots. Run with `--keep` to render only these. */
const KEEP = new Set([
  "home-phone-light",
  "home-phone-dark",
  "home-small-light",
  "listening-phone-light",
  "listening-phone-dark",
  "player-phone-light",
  "player-phone-dark",
  "player-scrubbing-phone-light",
  "generate-error-phone-light",
  "generate-running-phone-dark",
  "generate-done-phone-light",
  "settings-phone-dark",
  "archive-phone-light",
  "state-offline-phone-light",
  "state-nothing-phone-dark",
  "home-tablet-light",
  "player-tablet-dark",
  "home-desktop-dark",
  "lab-cards-desktop-light",
  "lab-desktop-dark",
]);

async function main(): Promise<void> {
  const outDir = resolve(ROOT, process.argv[2] ?? "docs/design/screenshots");
  const keepOnly = process.argv.includes("--keep");
  const filter = process.argv[3] && process.argv[3] !== "--keep" ? process.argv[3] : "";
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    for (const scene of scenes.filter(
      (candidate) => candidate.name.startsWith(filter) && (!keepOnly || KEEP.has(candidate.name)),
    )) {
      const context = await browser.newContext({
        viewport: { width: scene.width, height: scene.height },
        deviceScaleFactor: 2,
        isMobile: scene.width < 700,
        hasTouch: scene.width < 700,
        colorScheme: scene.scheme,
        reducedMotion: "no-preference",
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => console.error(`[${scene.name}] pageerror:`, error.message));
      page.on("console", (message) => {
        if (message.type() === "error") console.error(`[${scene.name}] console:`, message.text());
      });
      const url = pathToFileURL(
        resolve(ROOT, "docs/prototype", scene.file ?? "ui-prototype.html"),
      ).href;
      await page.goto(`${url}${scene.query}`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);
      if (scene.run) await scene.run(page);
      await page.screenshot({
        path: resolve(outDir, `${scene.name}.png`),
        fullPage: scene.fullPage ?? false,
      });
      console.log(`saved ${scene.name}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

await main();
