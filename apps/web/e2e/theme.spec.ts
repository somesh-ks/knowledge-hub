import type { Page } from "@playwright/test";
import { computedColor, expectColor, SURFACE_DARK, SURFACE_LIGHT } from "./colors";
import { expect, test } from "./fixtures";

const bodyBackground = (page: Page) => computedColor(page.locator("body"), "backgroundColor");

/** Records the theme the moment the body first exists, which is before anything can be painted. */
async function recordThemeAtBodyStart(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (!document.body) return;
      (window as unknown as { __themeAtBody: string | null }).__themeAtBody =
        document.documentElement.getAttribute("data-theme");
      observer.disconnect();
    });
    // The document element does not exist yet when this runs, so watch the document itself.
    observer.observe(document, { childList: true, subtree: true });
  });
}

test.describe("theme", () => {
  test("follows the system when nothing is stored", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
    await expectColor(page, await bodyBackground(page), SURFACE_DARK);
    await page.emulateMedia({ colorScheme: "light" });
    await expectColor(page, await bodyBackground(page), SURFACE_LIGHT);
  });

  test("applies a stored choice before first paint, so it never flashes", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript(() =>
      localStorage.setItem("dispatch:preferences", JSON.stringify({ theme: "dark" })),
    );
    await recordThemeAtBodyStart(page);
    await page.goto("/");
    expect(
      await page.evaluate(
        () => (window as unknown as { __themeAtBody: string | null }).__themeAtBody,
      ),
    ).toBe("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expectColor(page, await bodyBackground(page), SURFACE_DARK);
  });

  test("a stored light choice wins over a dark system", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(() =>
      localStorage.setItem("dispatch:preferences", JSON.stringify({ theme: "light" })),
    );
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expectColor(page, await bodyBackground(page), SURFACE_LIGHT);
  });

  test("ignores a stored value that is not a theme", async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem("dispatch:preferences", JSON.stringify({ theme: "sepia" })),
    );
    await page.goto("/");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
  });

  test("survives a client-side navigation", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript(() =>
      localStorage.setItem("dispatch:preferences", JSON.stringify({ theme: "dark" })),
    );
    await page.goto("/");
    await page.getByRole("link", { name: "See all" }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expectColor(page, await bodyBackground(page), SURFACE_DARK);
  });

  test("a theme set while the page is open also survives navigation", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    // Through the real control. Writing storage behind the app's back raced the player's own copy
    // of the preferences, and passed or failed by which loaded first.
    await page.goto("/settings");
    await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
    await page
      .getByRole("radiogroup", { name: "Theme" })
      .getByRole("radio", { name: "Dark" })
      .check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Library", exact: true })
      .click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    // And it is still there on the page after that.
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Today", exact: true })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});
