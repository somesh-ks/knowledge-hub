import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const EPISODE = "/e/ep-20261007-1930";

interface Counters {
  __draws: number;
}

/** Counts every drawArrays on a WebGL context, so a test can tell whether frames are still coming. */
async function countDraws(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Counters;
    w.__draws = 0;
    const draw = WebGLRenderingContext.prototype.drawArrays;
    WebGLRenderingContext.prototype.drawArrays = function (...args) {
      w.__draws += 1;
      return draw.apply(this, args);
    };
  });
}

const draws = (page: Page) => page.evaluate(() => (window as unknown as Counters).__draws);

/** True once the canvas has drawn at least one non-transparent pixel, read back through a 2D canvas. */
const hasPixels = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".ambient-canvas");
    if (!canvas || canvas.width === 0) return false;
    const copy = document.createElement("canvas");
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(canvas, 0, 0);
    const data = ctx.getImageData(0, 0, copy.width, copy.height).data;
    for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 0) > 0) return true;
    return false;
  });

const headerBoxes = (page: Page) =>
  page.evaluate(() =>
    [".hero", ".hero .cover", ".hero .page-title", ".hero-actions"].map((selector) => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return box ? [box.x, box.y, box.width, box.height].map(Math.round) : null;
    }),
  );

test.describe("ambient light", () => {
  test("sits on Today and on an episode, not on Library or Settings", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".ambient")).toHaveCount(1);
    await page.goto(EPISODE);
    await expect(page.locator(".ambient")).toHaveCount(1);
    await page.goto("/library");
    await expect(page.locator(".ambient")).toHaveCount(0);
    await page.goto("/settings");
    await expect(page.locator(".ambient")).toHaveCount(0);
  });

  test("is hidden from assistive tech, inert, and takes no room", async ({ page }) => {
    await page.goto("/");
    const ambient = page.locator(".ambient");
    await expect(ambient).toHaveAttribute("aria-hidden", "true");
    await expect(ambient).toHaveCSS("pointer-events", "none");
    await expect(ambient).toHaveCSS("position", "absolute");
    const before = await headerBoxes(page);
    await page.evaluate(() => document.querySelector(".ambient")?.remove());
    expect(await headerBoxes(page)).toEqual(before);
  });

  test("draws a lit canvas, or leaves the CSS layer where WebGL is missing", async ({ page }) => {
    await page.goto("/");
    const webgl = await page.evaluate(() => !!document.createElement("canvas").getContext("webgl"));
    if (!webgl) {
      test.info().annotations.push({ type: "webgl", description: "unavailable, CSS layer only" });
      await expect(page.locator(".ambient-still")).toBeVisible();
      await expect(page.locator(".ambient")).not.toHaveAttribute("data-live", /.*/);
      return;
    }
    await expect(page.locator(".ambient")).toHaveAttribute("data-live", "");
    expect(await hasPixels(page)).toBe(true);
  });

  test("draws one still frame and no more under reduced motion", async ({ page }) => {
    await countDraws(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const webgl = await page.evaluate(() => !!document.createElement("canvas").getContext("webgl"));
    test.skip(!webgl, "no WebGL in this browser");
    await expect(page.locator(".ambient")).toHaveAttribute("data-live", "");
    const first = await draws(page);
    expect(first).toBeGreaterThan(0);
    await page.waitForTimeout(600);
    expect(await draws(page)).toBe(first);
  });

  test("animates while on screen and stops when the tab hides", async ({ page }) => {
    await countDraws(page);
    await page.goto("/");
    const webgl = await page.evaluate(() => !!document.createElement("canvas").getContext("webgl"));
    test.skip(!webgl, "no WebGL in this browser");
    await expect(page.locator(".ambient")).toHaveAttribute("data-live", "");
    const a = await draws(page);
    await page.waitForTimeout(500);
    const b = await draws(page);
    expect(b).toBeGreaterThan(a);
    // 30 frames a second at most: half a second holds no more than a handful over 15.
    expect(b - a).toBeLessThanOrEqual(20);
    // Scrolled away, the header is off screen and the loop stops.
    await page.evaluate(() => {
      document.body.style.minHeight = "400vh";
      window.scrollTo(0, 3000);
    });
    await page.waitForTimeout(300);
    const c = await draws(page);
    await page.waitForTimeout(400);
    expect(await draws(page)).toBe(c);
  });

  test("leaves exactly one canvas and no errors across client navigations", async ({
    page,
    problems,
  }) => {
    await page.goto("/");
    await expect(page.locator(".ambient")).toHaveCount(1);
    // A script click goes through the router like a tap would; the phone emulation parks the fixed
    // bar below the visible area, where a pointer click would hit the page behind it.
    const nav = (name: string) =>
      page.locator(".app-nav-item", { hasText: name }).evaluate((a) => (a as HTMLElement).click());
    for (let i = 0; i < 3; i += 1) {
      await nav("Library");
      await expect(page.locator(".ambient")).toHaveCount(0);
      await nav("Today");
      await expect(page.locator(".ambient")).toHaveCount(1);
      await expect(page.locator("canvas.ambient-canvas")).toHaveCount(1);
    }
    // The phone emulation resizes the viewport mid-transition on any page pair, ambient or not
    // (Library to Settings does it too); that browser message is not this feature.
    problems.messages = problems.messages.filter((m) => !/Viewport size changed/.test(m));
  });
});
