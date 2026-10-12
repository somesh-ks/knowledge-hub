import type { Page } from "@playwright/test";
import { expect, test } from "./lab";

/**
 * Measured geometry of the open player and the bar: one left edge for the chapters, the phone's
 * vertical rhythm, the bar on the page's grid, and nothing said twice on a wide touch screen.
 */

const box = async (page: Page, selector: string) =>
  page.evaluate((query) => {
    const element = document.querySelector<HTMLElement>(query);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      contentLeft: rect.left + Number.parseFloat(style.paddingLeft),
    };
  }, selector);

test.describe("player geometry @surface", () => {
  test("the chapters start at one left edge with their headings", async ({ lab, page }) => {
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    const title = await box(page, "[data-player-page] .story-row-title");
    const heading = await box(page, "[data-player-page] .story-group-title");
    expect(title && heading).toBeTruthy();
    expect(Math.abs((title?.left ?? 0) - (heading?.contentLeft ?? 0))).toBeLessThanOrEqual(1);
  });

  test("the phone's open player keeps an even rhythm with the first chapter above the fold", async ({
    lab,
    page,
  }, info) => {
    test.skip(info.project.name !== "site-phone", "measured at 390x844");
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    const handle = await box(page, "[data-player-page] .player-handle");
    const art = await box(page, "[data-player-page] .player-cover-frame");
    const track = await box(page, "[data-player-page] .scrubber-track");
    const times = await box(page, "[data-player-page] .scrubber-times");
    const row = await box(page, "[data-player-page] .story-row");
    expect(handle?.top ?? 0).toBeGreaterThanOrEqual(14);
    expect(handle?.top ?? 0).toBeLessThanOrEqual(18);
    expect(art?.top ?? 0).toBeGreaterThanOrEqual(36);
    expect(art?.top ?? 0).toBeLessThanOrEqual(44);
    // The times read the track above them: closer to it than to the transport.
    expect((times?.top ?? 0) - (track?.bottom ?? 0)).toBeLessThanOrEqual(16);
    expect(row?.top ?? 900).toBeLessThan(844);
  });

  test("from 40rem to 64rem the bar lines up with the page's column", async ({
    lab,
    page,
  }, info) => {
    test.skip(info.project.name !== "site-phone", "a touch tablet");
    await page.setViewportSize({ width: 820, height: 1100 });
    await lab.open();
    await lab.play();
    await lab.dockSettled();
    const thumb = await box(page, ".player-dock .player-thumb");
    const next = await box(page, '.player-dock [aria-label="Next story"]');
    const column = await page.evaluate(() =>
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--layout-column"),
      ),
    );
    expect(column).toBeGreaterThan(0);
    // Centred: the same inset at either end, and well inside the window's edge gutter.
    expect(Math.abs((thumb?.left ?? 0) - (820 - (next?.right ?? 0)))).toBeLessThanOrEqual(2);
    expect(thumb?.left ?? 0).toBeGreaterThan(80);
  });

  test("on a wide touch screen the bar does not repeat the open page's transport", async ({
    lab,
    page,
  }, info) => {
    test.skip(info.project.name !== "site-phone", "a touch screen");
    await page.setViewportSize({ width: 1180, height: 820 });
    await lab.open();
    await lab.play();
    await expect(page.locator(".player-dock .dock-transport")).toBeVisible();
    await lab.openPlayer();
    await expect(page.locator(".player-dock .dock-transport")).toBeHidden();
    await expect(page.getByRole("button", { name: "Next story" })).toHaveCount(1);
  });

  test("at tablet width a mouse sees a way to close the open page @surface", async ({
    lab,
    page,
  }, info) => {
    test.skip(info.project.name !== "site-desktop", "a mouse");
    await page.setViewportSize({ width: 820, height: 1000 });
    await lab.open();
    await lab.play();
    await lab.dockSettled();
    await lab.openPlayer();
    const toggle = page.locator(".player-dock .dock-toggle");
    await expect(toggle).toBeVisible();
    // Open, the chevron closes the page, so it points up.
    await expect(toggle.locator("svg")).toHaveCSS("rotate", "180deg");
    await toggle.focus();
    await page.keyboard.press("Enter");
    await lab.collapsed();
    // The chevron hid with the page: focus is on the bar's open control, not lost to the body.
    await expect(lab.openButton).toBeFocused();
  });

  test("small things on the open page: the title keeps its last dot, the speed rows apart, the clock centred @surface", async ({
    lab,
    page,
  }, info) => {
    test.skip(info.project.name !== "site-desktop", "a mouse at 64rem");
    await lab.open();
    await lab.play();
    await lab.dockSettled();
    await lab.openPlayer();
    const px = (selector: string, property: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((el, name) => getComputedStyle(el).getPropertyValue(name), property);
    expect(parseFloat(await px(".player-title", "padding-inline-start"))).toBeGreaterThan(0);
    expect(await px(".dock-time", "align-items")).toBe("center");
    await page.locator(".speed-btn").first().click();
    expect(parseFloat(await px(".speed-panel-body", "row-gap"))).toBeGreaterThan(0);
  });

  test("with a mouse the clock sits by the seek line while the page is open, and the middle holds still @surface", async ({
    lab,
    page,
  }, info) => {
    test.skip(info.project.name !== "site-desktop", "a mouse");
    await lab.open();
    await lab.play();
    await lab.dockSettled();
    const middle = await box(page, ".player-dock .dock-open");
    await lab.openPlayer();
    const clock = await box(page, ".player-dock .dock-time");
    const after = await box(page, ".player-dock .dock-open");
    // No room is kept for the hidden buttons: the clock starts at the bar's own inset.
    expect(clock?.left ?? 999).toBeLessThan(64);
    expect(Math.abs((after?.left ?? 0) - (middle?.left ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.abs((after?.width ?? 0) - (middle?.width ?? 0))).toBeLessThanOrEqual(1);
  });

  test("in short wide windows the open page fits at rest, and the open bar's clock is centred @surface", async ({
    lab,
    page,
  }, info) => {
    test.skip(info.project.name !== "site-desktop", "a mouse");
    await lab.open();
    await lab.play();
    await lab.dockSettled();
    await lab.openPlayer();
    for (const [width, height] of [
      [1280, 600],
      [1280, 680],
      [1366, 650],
      [1280, 800],
    ] as const) {
      await page.setViewportSize({ width, height });
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const sheet = document.querySelector<HTMLElement>("[data-player-page]");
              return sheet ? sheet.scrollHeight - sheet.clientHeight : -1;
            }),
          { message: `overflow at ${width}x${height}` },
        )
        .toBeLessThanOrEqual(1);
    }
    // With the transport's buttons gone the clock is centred on the bar's row, level with the cover.
    const clock = await box(page, ".player-dock .dock-time");
    const thumb = await box(page, ".player-dock .player-thumb");
    const middle = (b: typeof clock) => ((b?.top ?? 0) + (b?.bottom ?? 0)) / 2;
    expect(Math.abs(middle(clock) - middle(thumb))).toBeLessThanOrEqual(2);
  });

  test("a very wide window gives the cover more room and keeps the source", async ({
    lab,
    page,
  }, info) => {
    test.skip(info.project.name !== "site-desktop", "a mouse on a wide screen");
    await page.setViewportSize({ width: 1920, height: 1080 });
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    const cover = await box(page, "[data-player-page] .player-cover-frame");
    expect(cover?.width ?? 0).toBeGreaterThan(460);
    await expect(lab.dialog.locator(".player-source-link")).toBeVisible();
  });
});
