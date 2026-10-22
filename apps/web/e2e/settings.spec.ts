import type { Page } from "@playwright/test";
import { expect, expectNoViolationsInEitherScheme, test, violations } from "./fixtures";

const PREFERENCES_KEY = "dispatch:preferences";

/** Safari on an iPhone: the one browser the Home Screen hint is written for. */
const IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

function stored(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), PREFERENCES_KEY);
}

/** Opens the page and waits until its script has filled the controls in. */
async function openSettings(page: Page, path = "/settings"): Promise<void> {
  await page.goto(path);
  await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
}

/** The Interface sounds page, where the switch and the volume live. */
const SOUNDS = "/settings/sounds";
const theme = (page: Page) => page.getByRole("combobox", { name: "Theme" });
const sounds = (page: Page) => page.getByRole("switch", { name: "Interface sounds", exact: true });
const volume = (page: Page) => page.getByRole("slider", { name: "Volume" });
const settingsLink = (page: Page) =>
  page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Settings" });

test.describe("settings page", () => {
  test("is the current destination in the navigation", async ({ page }) => {
    await openSettings(page);
    await expect(page).toHaveTitle("Settings, Singularity");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await expect(settingsLink(page)).toHaveAttribute("aria-current", "page");
    const today = page.getByRole("navigation", { name: "Primary" }).getByRole("link", {
      name: "Latest",
      exact: true,
    });
    await expect(today).not.toHaveAttribute("aria-current", /.*/);
  });

  test("ships with no choice made, so a stored one never flashes the default first", async ({
    page,
  }) => {
    const html = await (await page.request.get("/settings")).text();
    const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    expect(main).toContain("data-settings");
    expect(main).not.toMatch(/\schecked\b/);
    // The Theme select ships with no option chosen; the model select's saved value is known here.
    const themeSelect = main.slice(main.indexOf('id="settings-theme"'));
    expect(themeSelect.slice(0, themeSelect.indexOf("</select>"))).not.toMatch(/\sselected\b/);
    expect(main).not.toContain("data-ready");
    expect(main).toMatch(/<section[^>]*data-install-hint[^>]*hidden/);
  });

  test("each theme choice sets the theme on the root and survives a reload", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openSettings(page);
    const root = page.locator("html");
    await expect(theme(page)).toHaveValue("system");
    await expect(root).not.toHaveAttribute("data-theme", /.*/);

    await theme(page).selectOption("dark");
    await expect(root).toHaveAttribute("data-theme", "dark");
    await expect.poll(async () => (await stored(page)).theme).toBe("dark");
    await page.reload();
    await expect(root).toHaveAttribute("data-theme", "dark");
    await expect(theme(page)).toHaveValue("dark");

    await theme(page).selectOption("light");
    await expect(root).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(root).toHaveAttribute("data-theme", "light");
    await expect(theme(page)).toHaveValue("light");

    await theme(page).selectOption("system");
    await expect(root).not.toHaveAttribute("data-theme", /.*/);
    await expect.poll(async () => (await stored(page)).theme).toBe("system");
    await page.reload();
    await expect(root).not.toHaveAttribute("data-theme", /.*/);
    await expect(theme(page)).toHaveValue("system");
  });

  test("turning interface sounds off disables the volume, and back on enables it", async ({
    page,
  }) => {
    await openSettings(page, SOUNDS);
    await expect(sounds(page)).toBeChecked();
    await expect(volume(page)).toBeEnabled();

    await sounds(page).click();
    await expect(sounds(page)).not.toBeChecked();
    await expect(volume(page)).toBeDisabled();
    await expect.poll(async () => (await stored(page)).sounds).toBe(false);
    await page.reload();
    await expect(sounds(page)).not.toBeChecked();
    await expect(volume(page)).toBeDisabled();

    await sounds(page).click();
    await expect(sounds(page)).toBeChecked();
    await expect(volume(page)).toBeEnabled();
    await expect.poll(async () => (await stored(page)).sounds).toBe(true);
  });

  test("starts with interface sounds off for a reader who asks for reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openSettings(page, SOUNDS);
    await expect(sounds(page)).not.toBeChecked();
    await expect(volume(page)).toBeDisabled();
  });

  test("sets the volume from the keyboard, fills the track to match and persists it", async ({
    page,
  }) => {
    await openSettings(page, SOUNDS);
    await expect(volume(page)).toHaveValue("0.8");
    await expect(volume(page)).toHaveAttribute("aria-valuetext", "80%");
    await volume(page).focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(volume(page)).toHaveValue("0.7");
    await expect(volume(page)).toHaveAttribute("aria-valuetext", "70%");
    expect(
      await volume(page).evaluate((input: HTMLInputElement) =>
        input.style.getPropertyValue("--range-fill"),
      ),
    ).toBe("70%");
    await expect.poll(async () => (await stored(page)).volume).toBeCloseTo(0.7, 5);
    await page.reload();
    await expect(volume(page)).toHaveValue("0.7");
  });

  test("a client-side navigation from the briefing fills the controls in", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
      PREFERENCES_KEY,
      JSON.stringify({ theme: "dark", rate: 1.25, sounds: false, volume: 0.35 }),
    ] as const);
    await page.goto("/");
    // A mark on the window survives only if the router swaps the page instead of loading a new one.
    await page.evaluate(() => {
      (window as unknown as { __sameDocument?: boolean }).__sameDocument = true;
    });
    await settingsLink(page).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
    expect(
      await page.evaluate(
        () => (window as unknown as { __sameDocument?: boolean }).__sameDocument === true,
      ),
    ).toBe(true);

    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeFocused();
    await expect(settingsLink(page)).toHaveAttribute("aria-current", "page");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(theme(page)).toHaveValue("dark");
    await expect(page.getByRole("link", { name: /^Interface sounds/ })).toContainText("Off");
    await page.getByRole("link", { name: /^Interface sounds/ }).click();
    await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
    await expect(sounds(page)).not.toBeChecked();
    await expect(volume(page)).toBeDisabled();
    await expect(volume(page)).toHaveValue("0.35");
  });

  test("the controls still work on a second visit in the same session", async ({ page }) => {
    await openSettings(page);
    await theme(page).selectOption("dark");
    await expect.poll(async () => (await stored(page)).theme).toBe("dark");

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Library" })
      .click();
    await expect(page).toHaveURL(/\/library$/);
    // The page's script has already run once; this time only the router's event can start it.
    await settingsLink(page).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
    await expect(theme(page)).toHaveValue("dark");

    await theme(page).selectOption("light");
    await expect.poll(async () => (await stored(page)).theme).toBe("light");
  });
});

test.describe("settings page, Home Screen hint", () => {
  test("stays hidden in a browser that cannot add to the Home Screen", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("dispatch:install-hint-visits", "5"));
    await openSettings(page);
    await expect(page.getByText("Add Singularity to your Home Screen")).toBeHidden();
  });

  test.describe("in Safari on iOS", () => {
    test.use({ userAgent: IOS_SAFARI });

    test("appears on the second visit and stays gone once hidden", async ({ page }) => {
      await openSettings(page);
      const heading = page.getByText("Add Singularity to your Home Screen");
      await expect(heading).toBeHidden();

      await page.reload();
      await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
      await expect(heading).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await page.getByRole("button", { name: "Hide this" }).click();
      await expect(heading).toBeHidden();
      await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeFocused();

      await page.reload();
      await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
      await expect(heading).toBeHidden();
    });
  });
});

test.describe("settings page, axe", () => {
  test("the page, then with sounds off, has no WCAG 2.2 AA violations", async ({ page }) => {
    await openSettings(page);
    await expectNoViolationsInEitherScheme(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openSettings(page, SOUNDS);
    await expect(volume(page)).toBeDisabled();
    await expectNoViolationsInEitherScheme(page);
  });

  test("has no violations with each theme chosen against the system", async ({ page }) => {
    for (const choice of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: choice === "light" ? "dark" : "light" });
      await openSettings(page);
      await page.evaluate(([key, value]) => localStorage.setItem(key, value), [
        PREFERENCES_KEY,
        JSON.stringify({ theme: choice }),
      ] as const);
      await openSettings(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", choice);
      expect(await violations(page), `${choice} chosen`).toEqual([]);
    }
  });
});
