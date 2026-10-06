import {
  ACCENT_LIGHT,
  computedColor,
  expectColor,
  INK_LIGHT,
  SURFACE_LIGHT,
  toRgb,
} from "./colors";
import { expect, test } from "./fixtures";

/**
 * The player writes state onto the reader and the stylesheet reacts (design spec section 10). These
 * tests write the same attributes by hand, so the reader side of the contract is verified on its own,
 * before the player exists and after it changes. Colors are compared as sRGB, in the light theme.
 */

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/");
});

test("an upcoming item has a hollow node and a played one is filled", async ({ page }) => {
  const node = page.locator(".item").nth(0).locator(".node");
  await expectColor(page, await computedColor(node, "backgroundColor"), SURFACE_LIGHT);
  await page
    .locator(".item")
    .nth(0)
    .evaluate((element) => element.setAttribute("data-state", "played"));
  await page.waitForTimeout(250);
  await expectColor(page, await computedColor(node, "backgroundColor"), ACCENT_LIGHT);
});

test("the current item scales its node and halos it", async ({ page }) => {
  const item = page.locator(".item").nth(1);
  await item.evaluate((element) => element.setAttribute("data-state", "current"));
  await page.waitForTimeout(250);
  const node = item.locator(".node");
  expect(await node.evaluate((element) => getComputedStyle(element).transform)).toMatch(
    /^matrix\(1\.35/,
  );
  expect(await node.evaluate((element) => getComputedStyle(element).boxShadow)).toContain("5px");
});

test("a chapter node fills when its chapter is current or played", async ({ page }) => {
  const chapter = page.locator(".chapter").first();
  const node = chapter.locator(".chapter-node");
  await expectColor(page, await computedColor(node, "backgroundColor"), SURFACE_LIGHT);
  await chapter.evaluate((element) => element.setAttribute("data-state", "current"));
  await page.waitForTimeout(250);
  await expectColor(page, await computedColor(node, "backgroundColor"), ACCENT_LIGHT);
});

test("while listening, summaries step back by color and titles keep full ink", async ({ page }) => {
  const summary = page.locator(".item").nth(2).locator(".item-summary");
  const title = page.locator(".item").nth(2).locator(".item-title");
  const readingColor = await toRgb(page, await computedColor(summary, "color"));
  await page.locator(".briefing").evaluate((element) => element.setAttribute("data-live", ""));
  await page
    .locator(".item")
    .nth(1)
    .evaluate((element) => element.setAttribute("data-state", "current"));
  await page.waitForTimeout(250);
  const dimmed = await toRgb(page, await computedColor(summary, "color"));
  expect([...dimmed]).not.toEqual([...readingColor]);
  // Color carries the change, never opacity, so every line keeps its contrast.
  expect(await summary.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
  await expectColor(page, await computedColor(title, "color"), INK_LIGHT);
  // The current item's own summary stays at full ink.
  const currentSummary = page.locator(".item").nth(1).locator(".item-summary");
  expect([...(await toRgb(page, await computedColor(currentSummary, "color")))]).toEqual([
    ...readingColor,
  ]);
});

test("the rail fill scales with --player-progress on a leaf element", async ({ page }) => {
  const fill = page.locator(".rail-fill");
  expect(await fill.evaluate((node) => getComputedStyle(node).transform)).toBe(
    "matrix(1, 0, 0, 0, 0, 0)",
  );
  await fill.evaluate((node) =>
    (node as HTMLElement).style.setProperty("--player-progress", "0.5"),
  );
  expect(await fill.evaluate((node) => getComputedStyle(node).transform)).toBe(
    "matrix(1, 0, 0, 0.5, 0, 0)",
  );
  expect(await fill.evaluate((node) => getComputedStyle(node).transformOrigin)).toMatch(
    /^[\d.]+px 0px$/,
  );
  // The fill has no children, so writing its progress cannot restyle content.
  expect(await fill.evaluate((node) => node.children.length)).toBe(0);
});

test("a seek glides the fill and playing does not", async ({ page }) => {
  // Reduced motion collapses movement durations by design, so this one runs with motion allowed.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const fill = page.locator(".rail-fill");
  expect(await fill.evaluate((node) => getComputedStyle(node).transitionDuration)).toBe("0s");
  await fill.evaluate((node) => node.setAttribute("data-seeking", ""));
  expect(await fill.evaluate((node) => getComputedStyle(node).transitionProperty)).toBe(
    "transform",
  );
  expect(await fill.evaluate((node) => getComputedStyle(node).transitionDuration)).toBe("0.3s");
});

test("the item play button changes face for the current item and while playing", async ({
  page,
}) => {
  const button = page.locator(".item-play").nth(1);
  const face = button.locator(".item-play-face");
  const upcoming = await toRgb(page, await computedColor(face, "backgroundColor"));
  await button.evaluate((node) => node.setAttribute("data-current", "true"));
  await page.waitForTimeout(250);
  const current = await toRgb(page, await computedColor(face, "backgroundColor"));
  await button.evaluate((node) => node.setAttribute("data-playing", "true"));
  await page.waitForTimeout(250);
  const playing = await computedColor(face, "backgroundColor");
  expect(new Set([upcoming.join(), current.join()]).size).toBe(2);
  await expectColor(page, playing, ACCENT_LIGHT);
});

test("the play and pause glyphs swap on data-playing", async ({ page }) => {
  const button = page.locator(".cta");
  const opacities = async () => ({
    play: await button.locator(".swap-paused").evaluate((node) => getComputedStyle(node).opacity),
    pause: await button.locator(".swap-playing").evaluate((node) => getComputedStyle(node).opacity),
  });
  expect(await opacities()).toEqual({ play: "1", pause: "0" });
  await button.evaluate((node) => node.setAttribute("data-playing", "true"));
  await page.waitForTimeout(250);
  expect(await opacities()).toEqual({ play: "0", pause: "1" });
});

test("a loading call to action swaps its glyph for a spinner", async ({ page }) => {
  const button = page.locator(".cta");
  expect(await button.locator(".spinner").evaluate((node) => getComputedStyle(node).display)).toBe(
    "none",
  );
  await button.evaluate((node) => node.setAttribute("data-loading", "true"));
  expect(await button.locator(".spinner").evaluate((node) => getComputedStyle(node).display)).toBe(
    "block",
  );
  expect(await button.locator(".swap").evaluate((node) => getComputedStyle(node).display)).toBe(
    "none",
  );
});

test("room is reserved for the mini player once it shows", async ({ page }) => {
  const before = await page
    .locator("main")
    .evaluate((node) => getComputedStyle(node).paddingBottom);
  await page.evaluate(() => {
    document.documentElement.dataset.mini = "visible";
  });
  const after = await page.locator("main").evaluate((node) => getComputedStyle(node).paddingBottom);
  // 44px control, two insets, the bottom inset and 32px of air.
  expect(Number.parseFloat(after) - Number.parseFloat(before)).toBeGreaterThanOrEqual(100);
});

test("while offline the play controls step out of the way", async ({ page }) => {
  await page.evaluate(() => {
    document.documentElement.dataset.offline = "";
  });
  await expect(page.locator(".item-play").first()).toBeHidden();
  await expect(page.locator(".rail-hit")).toBeHidden();
  await expect(page.locator(".cta")).toBeVisible();
});

test("an aria-disabled control swallows clicks before any other handler sees them", async ({
  page,
}) => {
  await page.goto("/d/2026-10-05");
  await page.evaluate(() => {
    (window as unknown as { __clicks: number }).__clicks = 0;
    document.addEventListener("click", () => {
      (window as unknown as { __clicks: number }).__clicks += 1;
    });
  });
  // Playwright will not click a disabled control, which is the point; force it as a finger would.
  await page.locator(".cta").click({ force: true });
  expect(await page.evaluate(() => (window as unknown as { __clicks: number }).__clicks)).toBe(0);
});
