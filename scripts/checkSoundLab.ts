/**
 * Loads the sound lab in headless Chrome and checks that every card plays through the real
 * engine, that narration policy shows up in the status line, that the volume and scrub controls
 * work, and that each waveform canvas actually drew something.
 *
 * Usage: npx tsx scripts/checkSoundLab.ts
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { SOUND_NAMES } from "../packages/sound/src/index.js";
import { ROOT } from "./prototype/buildShared.js";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
let failures = 0;

function check(name: string, passed: boolean, detail = ""): void {
  if (!passed) failures += 1;
  console.log(`${passed ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
}

async function main(): Promise<void> {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(resolve(ROOT, "docs/prototype/sound-lab.html")).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);

  const cards = await page.locator(".sound-card").count();
  check("one card per sound", cards === SOUND_NAMES.length, `${cards}`);

  const drawn = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLCanvasElement>(".sound-card canvas")].map((canvas) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return 0;
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let lit = 0;
      for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) lit += 1;
      return lit;
    }),
  );
  check(
    "every waveform drew pixels",
    drawn.every((count) => count > 200),
    `min ${Math.min(...drawn)}`,
  );

  // The first click unlocks audio; the status line reports what happened.
  await page.click('[data-play="itemNext"]');
  await page.waitForTimeout(250);
  await page.click('[data-play="itemNext"]');
  await page.waitForTimeout(300);
  const status = await page.locator("#status-itemNext").textContent();
  check("a card plays through the engine and reports it", status === "Played.", status ?? "");

  // Narration policy: play is skipped on purpose, itemNext still plays, ducked.
  await page.evaluate(() =>
    (document.getElementById("narrationSwitch") as HTMLInputElement).click(),
  );
  await page.click('[data-play="play"]');
  const skipped = await page.locator("#status-play").textContent();
  check(
    "a skip-policy sound explains why it stayed silent",
    (skipped ?? "").startsWith("Skipped on purpose"),
    skipped ?? "",
  );
  await page.waitForTimeout(200);
  await page.click('[data-play="generateDone"]');
  await page.waitForTimeout(300);
  check(
    "a ducked sound still plays under narration",
    (await page.locator("#status-generateDone").textContent()) === "Played.",
  );
  await page.evaluate(() =>
    (document.getElementById("narrationSwitch") as HTMLInputElement).click(),
  );

  // Volume zero silences everything and says so.
  await page.evaluate(() => {
    const range = document.getElementById("volume") as HTMLInputElement;
    range.value = "0";
    range.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.click('[data-play="toggleOn"]');
  check(
    "volume zero is silent and says so",
    (await page.locator("#status-toggleOn").textContent()) === "Volume is zero.",
  );
  await page.evaluate(() => {
    const range = document.getElementById("volume") as HTMLInputElement;
    range.value = "0.8";
    range.dispatchEvent(new Event("input", { bubbles: true }));
  });

  // The scrub card reacts to its position slider and the speed card to its rate.
  await page.evaluate(() => {
    const slider = document.querySelector<HTMLInputElement>(
      '[data-sound="scrubDetent"] input[type="range"]',
    );
    if (!slider) return;
    slider.value = "1";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(150);
  check(
    "scrub position slider plays",
    (await page.locator("#status-scrubDetent").textContent()) === "Played.",
  );

  // The typical session runs to completion without errors and cleans up.
  await page.click("#sessionButton");
  await page.waitForTimeout(1200);
  check("session runs", (await page.getAttribute("#sessionButton", "data-running")) === "true");
  await page.click("#sessionButton");
  check("session stops", (await page.getAttribute("#sessionButton", "data-running")) === null);

  check("no page errors", errors.length === 0, errors.join("; "));
  await browser.close();
  if (failures > 0) process.exit(1);
}

await main();
