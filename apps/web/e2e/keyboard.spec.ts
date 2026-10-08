import { expect, hydrated, targetSize, test } from "./fixtures";

/** The accessible name and tag of whatever has focus. */
async function focused(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element) return "none";
    const name =
      element.getAttribute("aria-label") ?? element.textContent?.trim().replace(/\s+/g, " ") ?? "";
    return `${element.tagName.toLowerCase()}: ${name}`;
  });
}

test.describe("keyboard", () => {
  test.skip(({ isMobile }) => isMobile, "Keyboard order is checked on the desktop project");

  test("the skip link is the first thing Tab reaches and jumps to the briefing", async ({
    page,
  }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    expect(await focused(page)).toBe("a: Skip to the briefing");
    const box = await page.locator(".skip-link").boundingBox();
    expect(box?.y ?? -100).toBeGreaterThanOrEqual(0);
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
  });

  test("tab order follows the page: navigation, header, then each story's chip and source", async ({
    page,
  }) => {
    await page.goto("/");
    const seen: string[] = [];
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press("Tab");
      seen.push(await focused(page));
    }
    expect(seen).toEqual([
      "a: Skip to the briefing",
      "a: Singularity, today's briefing",
      "a: Today",
      "a: Library",
      "a: Create",
      "a: Settings",
      "button: Play the briefing, 1 min",
      "button: Share this briefing",
      "button: Play from here, 0:03: Springlet 2.0 retargets springs mid-flight, so interrupted drawers keep their velocity",
      "a: Read at example.com, opens in a new tab",
      "button: Play from here, 0:03: A dither shader that stays sharp at any pixel density",
      "a: Read at example.com, opens in a new tab",
    ]);
  });

  test("the contents list comes after the briefing, not before it", async ({ page }) => {
    await page.goto("/");
    const order = await page.evaluate(() => {
      const controls = [...document.querySelectorAll<HTMLElement>("a[href], button")];
      const lastInMain = controls.findLast((control) => control.closest("main") !== null);
      const firstInList = controls.find((control) => control.closest(".aside") !== null);
      if (!lastInMain || !firstInList) return null;
      return controls.indexOf(firstInList) - controls.indexOf(lastInMain);
    });
    expect(order).toBe(1);
  });

  test("every interactive control shows a two layer focus ring", async ({ page }) => {
    await page.goto("/");
    const controls = await page.locator("a[href], button:not([disabled]), summary").all();
    expect(controls.length).toBeGreaterThan(20);
    let checked = 0;
    for (const control of controls) {
      if (!(await control.isVisible())) continue;
      await control.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      const ring = await control.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          focusVisible: node.matches(":focus-visible"),
          width: style.outlineWidth,
          lineStyle: style.outlineStyle,
          offset: style.outlineOffset,
          gap: style.boxShadow,
        };
      });
      expect(
        ring.focusVisible,
        "the control should match :focus-visible after keyboard focus",
      ).toBe(true);
      expect(ring.width).toBe("2px");
      expect(ring.lineStyle).toBe("solid");
      expect(ring.offset).toBe("2px");
      expect(ring.gap).not.toBe("none");
      checked += 1;
    }
    expect(checked).toBeGreaterThan(20);
  });

  test("a focus ring in the contents list is not clipped by the list's own edge", async ({
    page,
  }) => {
    await page.goto("/");
    const fits = await page
      .locator(".aside-link")
      .first()
      .evaluate((node) => {
        const list = node.closest(".aside")?.getBoundingClientRect();
        const box = node.getBoundingClientRect();
        // The ring reaches 4px past the entry: a 2px gap and a 2px line.
        return list ? box.left - 4 >= list.left && box.right + 4 <= list.right : false;
      });
    expect(fits).toBe(true);
  });

  test("a chip plays with Enter and pauses with Space, and a link follows with Enter", async ({
    page,
  }) => {
    await page.goto("/");
    await hydrated(page);
    const chip = page.locator("[data-play-digest]");
    await chip.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    await expect(chip).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "paused");
    await page.getByRole("link", { name: "Library", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/library$/);
  });

  test("a story's source link is reachable and leaves for its source", async ({ page }) => {
    await page.goto("/");
    const link = page.locator(".story .source-link").first();
    await link.focus();
    await expect(link).toBeFocused();
    await expect(link).toHaveAttribute("href", /example\.com/);
    await expect(link).toHaveAttribute("target", "_blank");
  });

  test("the story chip is a real button with a 44px target", async ({ page }) => {
    await page.goto("/");
    const chip = page.locator("[data-play-item]").first();
    expect(await chip.evaluate((node) => node.tagName)).toBe("BUTTON");
    const size = await targetSize(chip);
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
    // The pill itself is 36px tall: the target is larger than what is drawn.
    expect((await chip.boundingBox())?.height).toBeCloseTo(36, 0);
  });
});
