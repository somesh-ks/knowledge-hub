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
  // (stored choice, system scheme, expected theme): a stored choice wins, before first paint, and
  // anything else follows the system.
  const cases = [
    { stored: null, system: "dark", theme: null },
    { stored: "dark", system: "light", theme: "dark" },
    { stored: "light", system: "dark", theme: "light" },
    { stored: "sepia", system: "light", theme: null },
  ] as const;
  for (const { stored, system, theme } of cases) {
    test(`stored ${stored ?? "nothing"} on a ${system} system shows ${theme ?? "the system"}, from first paint`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: system });
      if (stored) {
        await page.addInitScript(
          (value) => localStorage.setItem("dispatch:preferences", JSON.stringify({ theme: value })),
          stored,
        );
      }
      await recordThemeAtBodyStart(page);
      await page.goto("/");
      expect(
        await page.evaluate(
          () => (window as unknown as { __themeAtBody: string | null }).__themeAtBody,
        ),
      ).toBe(theme);
      if (theme) await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      else await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.*/);
      const shown = theme ?? system;
      await expectColor(
        page,
        await bodyBackground(page),
        shown === "dark" ? SURFACE_DARK : SURFACE_LIGHT,
      );
    });
  }

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
    await page.getByRole("combobox", { name: "Theme" }).selectOption("dark");
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
      .getByRole("link", { name: "Latest", exact: true })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});
