import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const EPISODE = "/e/ep-20261007-1930";

interface Counters {
  __draws: number;
  /** The attributes the page asked for when it gave its own canvas a WebGL context, if it did. */
  __asked: WebGLContextAttributes | null;
  /** True once the page's drawing code has loaded and asked what WebGL draws with. */
  __decided: boolean;
}

/**
 * Watches the page's WebGL from the outside: counts every drawArrays and records the attributes the
 * page's own canvas was asked for.
 */
async function watchWebGL(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Counters;
    w.__draws = 0;
    w.__asked = null;
    w.__decided = false;
    const draw = WebGLRenderingContext.prototype.drawArrays;
    WebGLRenderingContext.prototype.drawArrays = function (...args) {
      w.__draws += 1;
      draw.apply(this, args);
    };
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      attributes?: WebGLContextAttributes,
    ) {
      if (type === "webgl") {
        // The page first asks a canvas of its own making what WebGL draws with, then decides.
        w.__decided = true;
        if (this.classList.contains("ambient-canvas")) w.__asked = attributes ?? {};
      }
      return getContext.call(this, type, attributes);
    } as typeof getContext;
  });
}

const draws = (page: Page) => page.evaluate(() => (window as unknown as Counters).__draws);

/**
 * True where the browser draws WebGL on a GPU. The page declines a renderer that draws on the
 * processor (the same names as in ambientLight.ts), so a headless browser keeps the CSS layer.
 */
const hasFastWebGL = (page: Page) =>
  page.evaluate(() => {
    const gl = document
      .createElement("canvas")
      .getContext("webgl", { failIfMajorPerformanceCaveat: true });
    if (!gl) return false;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = String(
      info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    );
    return !/swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
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
    const before = await headerBoxes(page);
    await page.evaluate(() => document.querySelector(".ambient")?.remove());
    expect(await headerBoxes(page)).toEqual(before);
  });

  const asked = (page: Page) => page.evaluate(() => (window as unknown as Counters).__asked);

  /** True once the drawing code, which loads on idle, has asked what WebGL draws with. */
  const decided = (page: Page) => page.evaluate(() => (window as unknown as Counters).__decided);

  // Headless Chromium draws WebGL on the processor, which the page declines (ambientLight.ts): the
  // drawing itself needs a GPU and is checked by hand with --headed. What runs here is the decline.
  // A WebGL canvas on a software renderer makes the browser log "GPU stall due to ReadPixels" on
  // every page that has one, and the player's own suite fails on any warning.
  test("on a software renderer, keeps the CSS layer and never gives its canvas a context", async ({
    page,
  }) => {
    await watchWebGL(page);
    await page.goto("/");
    await expect.poll(() => decided(page)).toBe(true);
    test.skip(await hasFastWebGL(page), "this browser has a GPU");
    await expect(page.locator(".ambient-still")).toBeVisible();
    await expect(page.locator(".ambient")).not.toHaveAttribute("data-live", /.*/);
    expect(await asked(page)).toBeNull();
    expect(await draws(page)).toBe(0);
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
