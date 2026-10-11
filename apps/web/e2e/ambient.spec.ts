import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const EPISODE = "/e/ep-20261007-1930";

interface Counters {
  __draws: number;
  /** True once a frame held at least one pixel that is not fully transparent. */
  __lit: boolean;
  /** The attributes the page asked for when it gave its own canvas a WebGL context, if it did. */
  __asked: WebGLContextAttributes | null;
  /** True once the page's drawing code has loaded and asked what WebGL draws with. */
  __decided: boolean;
}

/**
 * Watches the page's WebGL from the outside: counts every drawArrays, so a test can tell whether
 * frames are still coming; reads the first frame back in the same task as its draw, which is the
 * only moment its pixels are there to read (the page does not keep its drawing buffer); and records
 * the attributes the context was asked for.
 */
async function watchWebGL(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Counters;
    w.__draws = 0;
    w.__lit = false;
    w.__asked = null;
    w.__decided = false;
    const draw = WebGLRenderingContext.prototype.drawArrays;
    WebGLRenderingContext.prototype.drawArrays = function (...args) {
      w.__draws += 1;
      draw.apply(this, args);
      if (w.__draws === 1) {
        const { drawingBufferWidth: width, drawingBufferHeight: height } = this;
        const pixels = new Uint8Array(width * height * 4);
        this.readPixels(0, 0, width, height, this.RGBA, this.UNSIGNED_BYTE, pixels);
        for (let i = 3; i < pixels.length; i += 4) if ((pixels[i] ?? 0) > 0) w.__lit = true;
      }
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
 * processor (the same names as in ambientLight.ts), so a headless browser keeps the CSS layer and
 * the tests of the drawing itself skip there; run this file with --headed to exercise them.
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
    await expect(ambient).toHaveCSS("pointer-events", "none");
    await expect(ambient).toHaveCSS("position", "absolute");
    const before = await headerBoxes(page);
    await page.evaluate(() => document.querySelector(".ambient")?.remove());
    expect(await headerBoxes(page)).toEqual(before);
  });

  const asked = (page: Page) => page.evaluate(() => (window as unknown as Counters).__asked);

  /** True once the drawing code, which loads on idle, has asked what WebGL draws with. */
  const decided = (page: Page) => page.evaluate(() => (window as unknown as Counters).__decided);

  test("gives its canvas a context only on a GPU, and one that keeps no drawing buffer", async ({
    page,
  }) => {
    await watchWebGL(page);
    await page.goto("/");
    await expect.poll(() => decided(page)).toBe(true);
    if (!(await hasFastWebGL(page))) {
      // On a renderer that draws on the processor the page's own canvas is never touched.
      await page.waitForTimeout(300);
      expect(await asked(page)).toBeNull();
      return;
    }
    await expect.poll(() => asked(page)).not.toBeNull();
    const attributes = await asked(page);
    // Lets a browser refuse where it knows the context would be slow. Chromium's headless software
    // renderer is granted all the same, which is why the page also checks the renderer by name.
    expect(attributes?.failIfMajorPerformanceCaveat).toBe(true);
    // Keeping the buffer costs a copy every frame, and nothing in the page reads the canvas.
    expect(attributes?.preserveDrawingBuffer ?? false).toBe(false);
  });

  // A WebGL canvas on a software renderer makes the browser log "GPU stall due to ReadPixels" on
  // every page that has one. The player's own suite fails on any warning, so it failed everywhere.
  for (const path of ["/", EPISODE]) {
    test(`logs no warning on ${path}`, async ({ page }) => {
      const warnings: string[] = [];
      page.on("console", (message) => {
        if (message.type() !== "warning") return;
        if (/Failed to load resource/.test(message.text())) return;
        warnings.push(message.text());
      });
      await watchWebGL(page);
      await page.goto(path);
      await expect.poll(() => decided(page)).toBe(true);
      // The browser's complaint comes a few frames after a canvas starts drawing, not at once. A
      // first version of this test waited half a second and passed on a build that still logged it.
      await page.waitForTimeout(3000);
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(800);
      expect(warnings).toEqual([]);
    });
  }

  test("draws a lit canvas on a GPU, and leaves the CSS layer where there is none", async ({
    page,
  }) => {
    await watchWebGL(page);
    await page.goto("/");
    await expect.poll(() => decided(page)).toBe(true);
    if (!(await hasFastWebGL(page))) {
      test.info().annotations.push({ type: "webgl", description: "no GPU here, CSS layer only" });
      await expect(page.locator(".ambient-still")).toBeVisible();
      await expect(page.locator(".ambient")).not.toHaveAttribute("data-live", /.*/);
      expect(await draws(page)).toBe(0);
      return;
    }
    await expect(page.locator(".ambient")).toHaveAttribute("data-live", "");
    expect(await page.evaluate(() => (window as unknown as Counters).__lit)).toBe(true);
  });

  test("draws one still frame and no more under reduced motion", async ({ page }) => {
    await watchWebGL(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    test.skip(!(await hasFastWebGL(page)), "no GPU in this browser; run with --headed");
    await expect(page.locator(".ambient")).toHaveAttribute("data-live", "");
    const first = await draws(page);
    expect(first).toBeGreaterThan(0);
    await page.waitForTimeout(600);
    expect(await draws(page)).toBe(first);
  });

  test("animates while on screen and stops when the header is scrolled away", async ({ page }) => {
    await watchWebGL(page);
    await page.goto("/");
    test.skip(!(await hasFastWebGL(page)), "no GPU in this browser; run with --headed");
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

  // The chip's accent words fall short of 4.5:1 over a cover's light, so it must not be see-through.
  for (const scheme of ["light", "dark"] as const) {
    test(`the play chip in the header stands on its own opaque container, ${scheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      const colours = await page.evaluate(() => {
        const probe = document.createElement("i");
        probe.style.backgroundColor = "var(--chip-bg)";
        document.body.append(probe);
        const container = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const chip = document.querySelector(".hero .chip");
        return { container, chip: chip ? getComputedStyle(chip).backgroundColor : null };
      });
      expect(colours.chip).toBe(colours.container);
      expect(colours.chip).not.toBe("rgba(0, 0, 0, 0)");
    });
  }

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
