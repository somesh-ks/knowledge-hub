import { expect, hydrated, test } from "./fixtures";

/**
 * The play button over a cover: on a card in a list, and on the hero of a page. It shows for a
 * mouse and for keyboard focus, and is not there at all on a touch screen.
 */

test.describe("the play button over a cover", () => {
  test("is not there on a touch screen, where a card only opens", async ({ page }, info) => {
    test.skip(info.project.name !== "phone", "touch only");
    await page.goto("/library");
    await hydrated(page);
    await expect(page.locator("[data-cover-play]").first()).toBeHidden();
  });

  test("a card's button appears on hover and plays that briefing on its page", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "desktop", "needs a mouse");
    await page.goto("/library");
    await hydrated(page);
    const card = page.locator("[data-card]", { has: page.locator('a[href="/d/2026-10-07"]') });
    const button = card.getByRole("button", { name: "Play Wednesday 7 October" });
    await expect(card.locator(".cover-over")).toHaveCSS("opacity", "0");
    await card.locator(".cover").hover({ position: { x: 12, y: 12 } });
    await expect(card.locator(".cover-over")).toHaveCSS("opacity", "1");
    await button.click();
    await expect(page).toHaveURL(/\/d\/2026-10-07$/);
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
  });

  test("the hero's button plays in place, shows pause while it plays, and pauses", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "desktop", "needs a mouse");
    await page.goto("/d/2026-10-07");
    await hydrated(page);
    // For a pointer only: the play chip beside it is the named, focusable control.
    const button = page.locator(".hero [data-cover-play]");
    await expect(button).toHaveAttribute("aria-hidden", "true");
    await expect(button).toHaveAttribute("tabindex", "-1");
    await page.locator(".hero .cover").hover({ position: { x: 12, y: 12 } });
    await button.click();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    await expect(page.locator(".hero .cover-over")).toHaveAttribute("data-playing", "true");
    await button.click();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "paused");
    await expect(page.locator(".hero .cover-over")).toHaveAttribute("data-playing", "false");
  });

  test("shows on keyboard focus, and Space plays", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "needs a mouse");
    await page.goto("/library");
    await hydrated(page);
    const card = page.locator("[data-card]", { has: page.locator('a[href="/d/2026-10-07"]') });
    await card.locator("a.card-link").focus();
    await page.keyboard.press("Tab");
    await expect(card.locator("[data-cover-play]")).toBeFocused();
    await expect(card.locator(".cover-over")).toHaveCSS("opacity", "1");
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/\/d\/2026-10-07$/);
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
  });
});
