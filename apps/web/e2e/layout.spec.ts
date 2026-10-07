import { expect, ROUTES, test } from "./fixtures";

const WIDTHS = [320, 390, 820, 1280] as const;

test.describe("layout", () => {
  for (const width of WIDTHS) {
    test(`nothing scrolls sideways at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ROUTES) {
        await page.goto(route.path);
        const overflow = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect(overflow.scroll, `${route.path} at ${width}px`).toBeLessThanOrEqual(overflow.client);
      }
    });
  }

  test("every control is at least 44px in both directions", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    for (const path of ["/", "/archive", "/d/2026-10-05"]) {
      await page.goto(path);
      const small = await page.evaluate(() => {
        const found: string[] = [];
        const controls = document.querySelectorAll<HTMLElement>("a[href], button, summary");
        for (const control of controls) {
          const rect = control.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const label = (control.getAttribute("aria-label") ?? control.textContent ?? "")
            .trim()
            .slice(0, 30);
          // Headlines are text links inside running content; the item button beside them is the target.
          if (control.closest(".item-title") || control.closest(".skip-link")) continue;
          if (rect.height < 44 || rect.width < 44) {
            found.push(
              `${control.className || control.tagName} "${label}" ${Math.round(rect.width)}x${Math.round(rect.height)}`,
            );
          }
        }
        return found;
      });
      expect(small, `controls under 44px on ${path}`).toEqual([]);
    }
  });

  test("the reading column holds the measure on a wide screen", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto("/");
    const column = await page
      .locator("main")
      .evaluate((node) => node.getBoundingClientRect().width);
    expect(column).toBeLessThanOrEqual(640);
    const summary = await page
      .locator(".item-summary")
      .first()
      .evaluate((node) => {
        const style = getComputedStyle(node);
        return { family: style.fontFamily, maxWidth: node.getBoundingClientRect().width };
      });
    expect(summary.family).toContain("Google Sans Flex");
  });

  test("shows the chapters aside from 64rem and hides it below", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await expect(page.locator(".aside")).toBeVisible();
    await expect(page.locator(".aside-link")).toHaveCount(6);
    await page.setViewportSize({ width: 1000, height: 900 });
    await expect(page.locator(".aside")).toBeHidden();
  });

  test("the header spans aside and column on desktop and keeps the wordmark over the aside", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    const wordmark = await page.locator(".wordmark").boundingBox();
    const aside = await page.locator(".aside").boundingBox();
    expect(Math.abs((wordmark?.x ?? 0) - (aside?.x ?? 999))).toBeLessThan(40);
  });

  test("the Archive link shows from 40rem and not on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/");
    await expect(page.locator(".nav-archive")).toBeHidden();
    await page.setViewportSize({ width: 820, height: 900 });
    await expect(page.locator(".nav-archive")).toBeVisible();
  });

  test("the hero stacks the cover above the date below 23.5rem", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto("/");
    const cover = await page.locator(".hero .cover").boundingBox();
    const heading = await page.locator(".hero h1").boundingBox();
    expect(heading?.y ?? 0).toBeGreaterThan((cover?.y ?? 0) + (cover?.height ?? 0) - 1);
    expect(cover?.width).toBeCloseTo(104, 0);
  });

  test("fonts are self-hosted with a metric-matched fallback", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const faces = await page.evaluate(() =>
      [...document.fonts].map((face) => `${face.family}:${face.status}`),
    );
    expect(faces.join(" ")).toContain("Google Sans Flex Variable");
    expect(faces.join(" ")).toContain("Google Sans Flex Fallback");
    expect(requests.every((url) => new URL(url).hostname === "127.0.0.1")).toBe(true);
    expect(requests.some((url) => url.endsWith(".woff2"))).toBe(true);
  });

  test("reduced motion keeps the layout and removes movement", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const durations = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        enter: style.getPropertyValue("--duration-enter").trim(),
        sheet: style.getPropertyValue("--duration-sheet-in").trim(),
        state: style.getPropertyValue("--duration-state").trim(),
      };
    });
    expect(Number.parseFloat(durations.enter)).toBeCloseTo(0.01, 3);
    expect(Number.parseFloat(durations.sheet)).toBeCloseTo(0.01, 3);
    expect(
      Number.parseFloat(durations.state) * (durations.state.endsWith("ms") ? 1 : 1000),
    ).toBeCloseTo(200, 0);
  });

  test("scroll behavior lives in the stylesheet", async ({ page }) => {
    await page.goto("/");
    const overscroll = await page.evaluate(
      () => getComputedStyle(document.documentElement).overscrollBehaviorY,
    );
    expect(overscroll).toBe("none");
  });

  test("uses the safe area variables with a zero fallback", async ({ page }) => {
    await page.goto("/");
    const safe = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return ["--safe-top", "--safe-right", "--safe-bottom", "--safe-left"].map((name) =>
        style.getPropertyValue(name).trim(),
      );
    });
    // A zero inset is a real answer: every variable resolves, and the layout works at 0px.
    expect(safe).toEqual(["0px", "0px", "0px", "0px"]);
  });
});
