import { expect, hydrated, test } from "./fixtures";

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

test.describe("keyboard", { tag: "@desktop" }, () => {
  test("the skip link is the first thing Tab reaches and jumps to the briefing", async ({
    page,
  }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    expect(await focused(page)).toBe("a: Skip to the briefing");
    await expect(page.locator(".skip-link")).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
  });

  test("tab order follows the page: navigation, header, then each story's chip and source", async ({
    page,
  }) => {
    await page.goto("/");
    const seen: string[] = [];
    for (let step = 0; step < 15; step += 1) {
      await page.keyboard.press("Tab");
      seen.push(await focused(page));
    }
    expect(seen).toEqual([
      "a: Skip to the briefing",
      "a: Singularity, latest briefing",
      // Create is first in the side column.
      "a: New episode",
      "a: Latest",
      "a: Library",
      "a: Settings",
      "button: More actions",
      "button: Play the briefing, 1 min",
      // A story is its headline link, then its play chip, then its like, dislike and options; the
      // publisher beside the chip is only attribution, out of the tab order and hidden from screen
      // readers.
      "a: Springlet 2.0 retargets springs mid-flight, so interrupted drawers keep their velocity (opens in a new tab)",
      "button: Play from here, 0:03: Springlet 2.0 retargets springs mid-flight, so interrupted drawers keep their velocity",
      "button: Like: Springlet 2.0 retargets springs mid-flight, so interrupted drawers keep their velocity",
      "button: Dislike: Springlet 2.0 retargets springs mid-flight, so interrupted drawers keep their velocity",
      "button: Story options: Springlet 2.0 retargets springs mid-flight, so interrupted drawers keep their velocity",
      "a: A dither shader that stays sharp at any pixel density (opens in a new tab)",
      "button: Play from here, 0:03: A dither shader that stays sharp at any pixel density",
    ]);
  });

  test("every interactive control shows a focus ring", async ({ page }) => {
    await page.goto("/");
    // A control taken out of the tab order (the hero cover's pointer-only play button, a story's
    // publisher link) is never reached by keyboard, so it has no ring to show.
    const controls = await page
      .locator('a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), summary')
      .all();
    let checked = 0;
    for (const control of controls) {
      if (!(await control.isVisible())) continue;
      await control.focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      const ring = await control.evaluate((node) => {
        // A headline link draws its ring round the whole headline, clear of its words.
        const headline = node.matches(".story-link") ? node.parentElement : null;
        return {
          name: node.getAttribute("aria-label") ?? node.textContent?.trim() ?? "",
          focusVisible: node.matches(":focus-visible"),
          line: getComputedStyle(headline ?? node).outlineStyle,
        };
      });
      expect(ring.focusVisible, `${ring.name} matches :focus-visible after Tab`).toBe(true);
      expect(ring.line, `${ring.name} shows a ring`).not.toBe("none");
      checked += 1;
    }
    expect(checked).toBeGreaterThan(20);
  });

  test("a chip plays with Enter and pauses with Space, and a link follows with Enter", async ({
    page,
  }) => {
    await page.goto("/");
    await hydrated(page);
    const chip = page.locator(".hero [data-play-digest]");
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
});
