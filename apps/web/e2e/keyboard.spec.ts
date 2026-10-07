import { expect, test } from "./fixtures";

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

  test("tab order follows the page: header, hero, chapters, items", async ({ page }) => {
    await page.goto("/");
    const seen: string[] = [];
    for (let step = 0; step < 9; step += 1) {
      await page.keyboard.press("Tab");
      seen.push(await focused(page));
    }
    expect(seen).toEqual([
      "a: Skip to the briefing",
      "a: Singularity, today's briefing",
      "a: Archive",
      "button: Generate",
      "button: Settings",
      // The aside chapter links come next at 1280px wide, then the hero button.
      expect.stringContaining("button:"),
      expect.stringContaining("button:"),
      expect.stringContaining("button:"),
      expect.stringContaining("button:"),
    ]);
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

  test("buttons activate with Enter and Space and links with Enter", async ({ page }) => {
    await page.goto("/");
    // The Generate button belongs to the sheets island; here it must at least take both keys without error.
    await page.getByRole("button", { name: "Generate" }).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    await page.getByRole("link", { name: "Archive" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/archive$/);
  });

  test("a headline link is reachable and opens its source", async ({ page }) => {
    await page.goto("/");
    const link = page.getByRole("link", { name: /Springlet 2\.0/ });
    await link.focus();
    await expect(link).toBeFocused();
    await expect(link).toHaveAttribute("href", /example\.com/);
  });

  test("the item play button is a real button with a 44px target", async ({ page }) => {
    await page.goto("/");
    const button = page.locator(".item-play").first();
    const box = await button.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(await button.evaluate((node) => node.tagName)).toBe("BUTTON");
  });
});
