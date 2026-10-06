import { expect, line, test, touchDrag } from "./lab";

/** Progress of the sheet read from its transform: 1 at rest open, 0 fully below the screen. */
async function sheetProgress(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".player-panel");
    if (!panel) return 0;
    const match = /translate3d\(0px, ([\d.]+)px/.exec(panel.style.transform);
    const offset = match ? Number(match[1]) : 0;
    return 1 - offset / panel.getBoundingClientRect().height;
  });
}

test.describe("touch gestures on the sheet", () => {
  test("swiping up on the mini player opens the sheet interactively, following the finger", async ({ lab, page }) => {
    await lab.open();
    await lab.play();
    const bar = await page.locator(".mini-open").boundingBox();
    if (!bar) throw new Error("mini player not found");
    const start = { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 };
    // Halfway up the screen, slowly, and hold: the sheet is mid-gesture and follows the finger.
    await touchDrag(page, line(start, { x: start.x, y: start.y - 360 }, 18), 20, true);
    await expect(page.locator("html")).toHaveAttribute("data-player", "open");
    const held = await sheetProgress(page);
    expect(held).toBeGreaterThan(0.3);
    expect(held).toBeLessThan(0.95);
    // The cover is morphing between the mini player's cover and its resting place.
    const cover = await page.locator(".player-cover-frame[data-size=player]").evaluate((element) => element.style.transform);
    expect(cover).toMatch(/scale\(0\.\d+\)/);
    const client = await page.context().newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await lab.settled();
    expect(await sheetProgress(page)).toBeCloseTo(1, 2);
    await expect(page.locator(".mini-open .player-cover-frame")).toHaveCSS("visibility", "hidden");
  });

  test("a short, slow swipe up springs back closed without opening", async ({ lab, page }) => {
    await lab.open();
    await lab.play();
    const bar = await page.locator(".mini-open").boundingBox();
    if (!bar) throw new Error("mini player not found");
    const start = { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 };
    await touchDrag(page, line(start, { x: start.x, y: start.y - 60 }, 6), 60);
    await expect(page.locator("html")).toHaveAttribute("data-player", "closed", { timeout: 4_000 });
    await expect(lab.panel).toHaveCount(0);
  });

  test("a flick up opens the sheet even when the finger travelled little", async ({ lab, page }) => {
    await lab.open();
    await lab.play();
    const bar = await page.locator(".mini-open").boundingBox();
    if (!bar) throw new Error("mini player not found");
    const start = { x: bar.x + bar.width / 2, y: bar.y + bar.height / 2 };
    await touchDrag(page, line(start, { x: start.x, y: start.y - 120 }, 6), 8);
    await lab.settled();
    await expect(page.locator("html")).toHaveAttribute("data-player", "open");
    expect(await sheetProgress(page)).toBeCloseTo(1, 2);
  });

  test("a flick down on the header dismisses the sheet along its spring", async ({ lab, page }) => {
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    await touchDrag(page, line({ x: 195, y: 130 }, { x: 195, y: 360 }, 6), 8);
    await expect(page.locator("html")).toHaveAttribute("data-player", "closed", { timeout: 4_000 });
    await expect(lab.panel).toHaveCount(0);
    await expect(lab.mini).toHaveAttribute("data-visible", "true");
  });

  test("a slow, short drag down snaps back open, because release decides", async ({ lab, page }) => {
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    await touchDrag(page, line({ x: 195, y: 130 }, { x: 195, y: 250 }, 8), 50);
    await lab.settled();
    await expect(page.locator("html")).toHaveAttribute("data-player", "open");
    expect(await sheetProgress(page)).toBeCloseTo(1, 2);
  });

  test("a long, slow drag down past the threshold dismisses on release", async ({ lab, page }) => {
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    await touchDrag(page, line({ x: 195, y: 130 }, { x: 195, y: 560 }, 10), 60);
    await expect(page.locator("html")).toHaveAttribute("data-player", "closed", { timeout: 4_000 });
  });

  test("never dismisses mid-drag: the sheet follows the finger and waits for the lift", async ({ lab, page }) => {
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    await touchDrag(page, line({ x: 195, y: 130 }, { x: 195, y: 700 }, 12), 30, true);
    await expect(page.locator("html")).toHaveAttribute("data-player", "open");
    expect(await sheetProgress(page)).toBeLessThan(0.45);
    const client = await page.context().newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.locator("html")).toHaveAttribute("data-player", "closed", { timeout: 4_000 });
  });

  test("scrolling the chapter list never drags the sheet", async ({ lab, page }) => {
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    await touchDrag(page, line({ x: 195, y: 700 }, { x: 195, y: 820 }, 6), 8);
    await lab.settled();
    expect(await sheetProgress(page)).toBeCloseTo(1, 2);
    await expect(page.locator("html")).toHaveAttribute("data-player", "open");
  });
});

test.describe("closing the sheet", () => {
  test("closes from the button and gives the page back with the mini player in place", async ({ lab, page }) => {
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    await page.getByRole("button", { name: "Close the player" }).tap();
    await expect(page.locator("html")).toHaveAttribute("data-player", "closed", { timeout: 4_000 });
    await expect(lab.panel).toHaveCount(0);
    await expect(page.locator(".mini-open .player-cover-frame")).toHaveCSS("visibility", "visible");
  });

  test("closes with Escape and returns focus to the control that opened it", async ({ lab, page }) => {
    await lab.open();
    await lab.play();
    await page.locator(".mini-open").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-player", "open");
    await lab.settled();
    await page.keyboard.press("Escape");
    await expect(page.locator("html")).toHaveAttribute("data-player", "closed", { timeout: 4_000 });
    await expect(page.locator(".mini-open")).toBeFocused();
  });

  test("traps focus inside the open player and makes the page inert", async ({ lab, page }) => {
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    for (let press = 0; press < 14; press += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => Boolean(document.activeElement?.closest(".player-panel")));
      expect(inside).toBe(true);
    }
  });
});
