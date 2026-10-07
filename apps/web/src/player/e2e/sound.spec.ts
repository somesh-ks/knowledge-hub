import { expect, test } from "./lab";

declare global {
  interface Window {
    __soundLog: string[];
    __contexts: number;
  }
}

/** Counts AudioContexts and oscillators, and logs the order of cues against narration starts. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__soundLog = [];
    window.__contexts = 0;
    const OriginalContext = window.AudioContext;
    window.AudioContext = class extends OriginalContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        window.__contexts += 1;
        const createOscillator = this.createOscillator.bind(this);
        this.createOscillator = () => {
          window.__soundLog.push("cue");
          return createOscillator();
        };
      }
    } as typeof AudioContext;
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
      window.__soundLog.push("narration");
      return originalPlay.call(this);
    };
  });
});

const cues = (page: import("@playwright/test").Page) =>
  page.evaluate(() => window.__soundLog.filter((entry) => entry === "cue").length);

async function waitForEngine(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForFunction(
    () =>
      performance
        .getEntriesByType("resource")
        .some((entry) => entry.name.includes("sound/src/engine")),
    undefined,
    { timeout: 15_000 },
  );
}

test.describe("interface sounds", () => {
  test("load after first paint, and create no audio context before a gesture", async ({
    lab,
    page,
  }) => {
    await lab.open();
    await waitForEngine(page);
    expect(await page.evaluate(() => window.__contexts)).toBe(0);
    await page.locator('[data-open-sheet="settings"]').tap();
    expect(await page.evaluate(() => window.__contexts)).toBe(1);
  });

  test("confirm opening a sheet, and stay silent once the Sounds switch is off", async ({
    lab,
    page,
  }) => {
    await lab.open();
    await waitForEngine(page);
    // The first gesture creates and resumes the context; later ones are heard.
    await page.locator('[data-open-sheet="settings"]').tap();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.waitForTimeout(400);
    const before = await cues(page);
    await page.locator('[data-open-sheet="settings"]').tap();
    await expect.poll(() => cues(page)).toBeGreaterThan(before);
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await dialog.getByRole("switch", { name: "Interface sounds" }).click();
    await page.waitForTimeout(300);
    const afterOff = await cues(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await page.locator('[data-open-sheet="generate"]').tap();
    await page.waitForTimeout(500);
    expect(await cues(page)).toBe(afterOff);
  });

  test("play before the narration starts, so the cue lands in silence", async ({ lab, page }) => {
    await lab.open();
    await waitForEngine(page);
    await lab.play();
    await page.locator(".dock-btn[data-primary]").tap();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "paused");
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      window.__soundLog.length = 0;
    });
    await page.locator(".dock-btn[data-primary]").tap();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    const log = await page.evaluate(() => window.__soundLog);
    expect(log.indexOf("cue")).toBeGreaterThanOrEqual(0);
    expect(log.indexOf("cue")).toBeLessThan(log.indexOf("narration"));
  });

  test("skip the sheet cue while narration plays", async ({ lab, page }) => {
    await lab.open();
    await waitForEngine(page);
    await lab.play();
    await page.waitForTimeout(500);
    const before = await cues(page);
    await page.locator('[data-open-sheet="settings"]').tap();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await page.waitForTimeout(400);
    expect(await cues(page)).toBe(before);
  });

  test("never touch the narration element", async ({ lab, audio, page }) => {
    await lab.open();
    await waitForEngine(page);
    await lab.play();
    await page.locator('[data-open-sheet="settings"]').tap();
    await page.keyboard.press("Escape");
    expect((await audio.read())?.paused).toBe(false);
    expect(await audio.count()).toBe(1);
  });
});

test.describe("Up next", () => {
  test("offers the previous briefing after the last item and plays it on the same audio element", async ({
    lab,
    audio,
    page,
  }) => {
    // The lab has no /d/ route; the previous briefing's page is the earlier lab page.
    await page.route("**/d/2026-01-12", async (route) => {
      const response = await route.fetch({
        url: new URL("/dev/player-lab-older", route.request().url()).toString(),
      });
      await route.fulfill({ response });
    });
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    await page.getByRole("slider", { name: "Playback position" }).focus();
    await page.keyboard.press("End");
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "ended");
    const upNext = page.getByRole("button", { name: /Monday 12 January/ });
    await expect(upNext).toBeVisible();
    // Never an autoplay chain: nothing plays until the listener chooses.
    expect((await audio.read())?.paused).toBe(true);
    await upNext.tap();
    await expect(page).toHaveURL(/\/d\/2026-01-12/);
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing", {
      timeout: 10_000,
    });
    expect((await audio.read())?.src).toContain("#older");
    expect(await audio.count()).toBe(1);
  });
});
