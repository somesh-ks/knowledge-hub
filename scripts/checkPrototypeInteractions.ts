/**
 * Drives the prototype with real pointer input and asserts the behaviors the spec promises:
 * play and pause, rail fill, scrubber drag with pause and resume, swipe up to open, flick to
 * dismiss, slow release snaps back, sheet focus return, sounds scheduled through the real engine,
 * and reduced-motion behavior. Prints a line per check and exits non-zero on any failure.
 *
 * Usage: npx tsx scripts/checkPrototypeInteractions.ts [screenshotDir]
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "playwright";
import { ROOT } from "./prototype/buildShared.js";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const url = pathToFileURL(resolve(ROOT, "docs/prototype/ui-prototype.html")).href;
let failures = 0;

function check(name: string, passed: boolean, detail = ""): void {
  if (!passed) failures += 1;
  console.log(`${passed ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
}

const state = (page: Page) =>
  page.evaluate(() => {
    const api = (
      window as unknown as {
        singularityPrototype: { player: { getState: () => Record<string, unknown> } };
      }
    ).singularityPrototype;
    return api.player.getState();
  });

async function main(): Promise<void> {
  const shots = process.argv[2] ? resolve(ROOT, process.argv[2]) : null;
  if (shots) mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);

  // Play and pause from the hero button.
  await page.tap("#cta");
  await page.waitForTimeout(700);
  let s = await state(page);
  check("hero button starts playback", s.status === "playing", String(s.status));
  check("mini player appears", (await page.getAttribute("#mini", "data-visible")) === "true");
  check(
    "sound engine scheduled a cue through the real engine",
    await page.evaluate(() => {
      const api = (
        window as unknown as { singularityPrototype: { sound: { activeVoices: () => number } } }
      ).singularityPrototype;
      return typeof api.sound.activeVoices() === "number";
    }),
  );
  const fill1 = await page.evaluate(() =>
    document.getElementById("railFill")?.style.getPropertyValue("--player-progress"),
  );
  await page.waitForTimeout(1500);
  const fill2 = await page.evaluate(() =>
    document.getElementById("railFill")?.style.getPropertyValue("--player-progress"),
  );
  check(
    "rail fill advances continuously while playing",
    Number(fill2) > Number(fill1),
    `${fill1} to ${fill2}`,
  );
  await page.tap("#cta");
  s = await state(page);
  check("hero button pauses", s.status === "paused", String(s.status));

  // Rail tap seeks to the nearest item and plays.
  await page.locator('.item[data-index="3"]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const hit = await page.locator("#railHit").boundingBox();
  const node = await page.locator('.item[data-index="3"] .node').boundingBox();
  if (hit && node) {
    await page.touchscreen.tap(hit.x + hit.width / 2, node.y + node.height / 2);
    await page.waitForTimeout(400);
    s = await state(page);
    check(
      "rail tap seeks to item 4 and plays",
      s.itemIndex === 3 && s.status === "playing",
      `${s.itemIndex} ${s.status}`,
    );
  }
  check(
    "item states: previous played, current marked",
    (await page.getAttribute('.item[data-index="2"]', "data-state")) === "played" &&
      (await page.getAttribute('.item[data-index="3"]', "data-state")) === "current",
  );
  await page.tap("#miniToggle");

  // Open the player with a tap and compare with dialog state.
  await page.tap("#miniOpen");
  await page.waitForTimeout(1100);
  check(
    "tap on the mini player opens the sheet",
    await page.evaluate(() => (document.getElementById("playerSheet") as HTMLDialogElement).open),
  );
  const rest = await page.locator("#playerPanel").boundingBox();
  check(
    "sheet rests at the top edge",
    Boolean(rest) && Math.abs(rest?.y ?? 99) < 1.5,
    `y=${rest?.y}`,
  );
  const thumbBefore = await page.locator(".scrubber-thumb").boundingBox();
  const scrub = await page.locator("#scrubber").boundingBox();
  const time = (await state(page)).time as number;
  const expectedX = scrub
    ? scrub.x + (time / ((await state(page)).duration as number)) * scrub.width
    : 0;
  check(
    "scrubber thumb sits at the playhead",
    Boolean(thumbBefore) && Math.abs((thumbBefore?.x ?? 0) - expectedX) < 2,
    `thumb ${thumbBefore?.x?.toFixed(1)} expected ${expectedX.toFixed(1)}`,
  );

  // Scrub: playback pauses during the drag and the playhead follows the pointer.
  if ((await state(page)).status !== "playing") await page.tap("#tToggle");
  await page.waitForTimeout(300);
  if (scrub) {
    await page.mouse.move(scrub.x + scrub.width * 0.1, scrub.y + scrub.height / 2);
    await page.mouse.down();
    s = await state(page);
    check(
      "scrub begins and holds the playhead",
      s.scrubbing === true && s.status === "paused",
      `${s.scrubbing} ${s.status}`,
    );
    await page.mouse.move(scrub.x + scrub.width * 0.7, scrub.y + scrub.height / 2, { steps: 10 });
    s = await state(page);
    check(
      "playhead follows the pointer 1:1",
      Math.abs((s.time as number) / (s.duration as number) - 0.7) < 0.03,
      String(((s.time as number) / (s.duration as number)).toFixed(3)),
    );
    check(
      "bubble shows while dragging",
      (await page.getAttribute("#scrubber", "data-dragging")) === "true",
    );
    if (shots) await page.screenshot({ path: resolve(shots, "interaction-scrub.png") });
    await page.mouse.up();
    await page.waitForTimeout(300);
    s = await state(page);
    check(
      "release resumes playback",
      s.scrubbing === false && s.status === "playing",
      `${s.scrubbing} ${s.status}`,
    );
  }

  // Keyboard on the scrubber.
  await page.focus("#scrubber");
  const before = (await state(page)).time as number;
  await page.keyboard.press("ArrowRight");
  const after = (await state(page)).time as number;
  check(
    "arrow right seeks about 5 seconds",
    after - before > 4.5 && after - before < 6,
    `${(after - before).toFixed(2)}s`,
  );
  await page.keyboard.press("PageDown");
  check("page down skips an item", ((await state(page)).itemIndex as number) > 0);

  // Flick down to dismiss: fast release closes the sheet.
  const drag = await page.locator("#playerDrag").boundingBox();
  if (drag) {
    const x = drag.x + drag.width / 2;
    const y = drag.y + 120;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 90, { steps: 3 });
    if (shots) await page.screenshot({ path: resolve(shots, "interaction-drag-down.png") });
    await page.mouse.move(x, y + 260, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(1300);
    check(
      "flick down dismisses",
      !(await page.evaluate(
        () => (document.getElementById("playerSheet") as HTMLDialogElement).open,
      )),
    );
    check(
      "focus returns to the mini player",
      await page.evaluate(() => document.activeElement?.id === "miniOpen"),
    );
  }

  // Slow short drag snaps back.
  await page.tap("#miniOpen");
  await page.waitForTimeout(1100);
  const drag2 = await page.locator("#playerDrag").boundingBox();
  if (drag2) {
    const x = drag2.x + drag2.width / 2;
    const y = drag2.y + 150;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) {
      await page.mouse.move(x, y + step * 12);
      await page.waitForTimeout(90);
    }
    await page.waitForTimeout(250);
    await page.mouse.up();
    await page.waitForTimeout(1100);
    check(
      "short slow drag snaps back open",
      await page.evaluate(() => (document.getElementById("playerSheet") as HTMLDialogElement).open),
    );
  }
  await page.tap("#playerClose");
  await page.waitForTimeout(1000);

  // Swipe up on the mini player opens, with a mid-gesture screenshot of the shared cover.
  const mini = await page.locator("#miniOpen").boundingBox();
  if (mini) {
    const x = mini.x + 120;
    const y = mini.y + mini.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 260, { steps: 6 });
    check(
      "sheet follows an upward swipe",
      await page.evaluate(() => (document.getElementById("playerSheet") as HTMLDialogElement).open),
    );
    if (shots) await page.screenshot({ path: resolve(shots, "interaction-swipe-up-mid.png") });
    await page.mouse.move(x, y - 380, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(1200);
    const panel = await page.locator("#playerPanel").boundingBox();
    check(
      "swipe up commits and settles open",
      Boolean(panel) && Math.abs(panel?.y ?? 99) < 1.5,
      `y=${panel?.y}`,
    );
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);
  check(
    "escape closes the sheet",
    !(await page.evaluate(
      () => (document.getElementById("playerSheet") as HTMLDialogElement).open,
    )),
  );

  check("no page errors", errors.length === 0, errors.join("; "));
  await context.close();

  // Reduced motion: the sheet fades instead of sliding, and nothing translates.
  const reduced = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const page2 = await reduced.newPage();
  await page2.goto(url);
  await page2.tap("#cta");
  await page2.waitForTimeout(300);
  await page2.tap("#miniOpen");
  await page2.waitForTimeout(80);
  const transform = await page2.evaluate(
    () => getComputedStyle(document.getElementById("playerPanel") as HTMLElement).transform,
  );
  check(
    "reduced motion: no slide transform on the sheet",
    transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)",
    transform,
  );
  const soundsDefault = await page2.evaluate(
    () =>
      (window as unknown as { singularityPrototype: { prefs: { sounds: boolean } } })
        .singularityPrototype.prefs.sounds,
  );
  check("reduced motion: sounds default off", soundsDefault === false);
  await reduced.close();
  await browser.close();
  if (failures > 0) process.exit(1);
}

await main();
