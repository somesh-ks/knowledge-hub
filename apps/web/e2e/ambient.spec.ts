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

  // The layer reaches into the page's gutter. Reaching past it once made Today 422px wide on a
  // 390px phone: the page scrolled sideways, the bottom navigation stretched off the screen and
  // could not be tapped, and every move away from Today aborted its transition with "Viewport size
  // changed". A decorative layer must never change how wide a page is.
  for (const path of ["/", EPISODE]) {
    test(`never makes ${path} wider than the screen`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator(".ambient")).toHaveCount(1);
      const width = page.viewportSize()?.width ?? 0;
      const measured = await page.evaluate(() => {
        const layer = document.querySelector(".ambient")?.getBoundingClientRect();
        return {
          inner: window.innerWidth,
          client: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
          layerLeft: Math.floor(layer?.left ?? 0),
          layerRight: Math.ceil(layer?.right ?? 0),
        };
      });
      expect(measured.inner).toBe(width);
      expect(measured.scroll).toBeLessThanOrEqual(measured.client);
      expect(measured.layerLeft).toBeGreaterThanOrEqual(0);
      expect(measured.layerRight).toBeLessThanOrEqual(measured.client);
    });
  }

  test("leaves exactly one canvas and no errors across client navigations", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".ambient")).toHaveCount(1);
    // A real press on the navigation, as a person makes it, and no error is excused: the fixture
    // fails this test on any page error.
    const nav = (name: string) => page.locator(".app-nav-item", { hasText: name }).click();
    for (let i = 0; i < 3; i += 1) {
      await nav("Library");
      await expect(page.locator(".ambient")).toHaveCount(0);
      await nav("Today");
      await expect(page.locator(".ambient")).toHaveCount(1);
      await expect(page.locator("canvas.ambient-canvas")).toHaveCount(1);
    }
  });
});
