import type { Page } from "@playwright/test";
import { expect, expectNoViolationsInEitherScheme, test, violations } from "./fixtures";

const PREFERENCES_KEY = "singularity:preferences";

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

/** The Sound and voice page, where the switch and the volume live. */
const SOUNDS = "/settings/sound";
/** The Appearance page, where the theme, the mood and the hue live. */
const APPEARANCE = "/settings/appearance";
const theme = (page: Page) => page.getByRole("combobox", { name: "Theme" });
const sounds = (page: Page) => page.getByRole("switch", { name: "Sounds", exact: true });
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
    const mainOf = async (path: string) => {
      const html = await (await page.request.get(path)).text();
      return html.slice(html.indexOf("<main"), html.indexOf("</main>"));
    };
    const main = await mainOf("/settings");
    expect(main).toContain("data-settings");
    expect(main).not.toMatch(/\schecked\b/);
    expect(main).not.toContain("data-ready");
    expect(main).toMatch(/<section[^>]*data-install-hint[^>]*hidden/);
    // The Theme select ships with no option chosen.
    const appearance = await mainOf(APPEARANCE);
    const themeSelect = appearance.slice(appearance.indexOf('id="settings-theme"'));
    expect(themeSelect.slice(0, themeSelect.indexOf("</select>"))).not.toMatch(/\sselected\b/);
  });

  // The owner's report (2026-10-27): the Settings page took about a second to show the chosen theme.
  // The select drew nothing until the page's script ran; the stored choice is now in it before the
  // first paint, with that script not even loaded.
  test("shows the stored theme before the page's script has run", async ({ page }) => {
    // Served empty, not refused, so the suite's console check stays quiet: the page never wires up.
    await page.route(/\/_astro\/appearance\.astro_astro_type_script[^/]*\.js$/, (route) =>
      route.fulfill({ contentType: "text/javascript", body: "" }),
    );
    await page.addInitScript(
      ([key]) => localStorage.setItem(key as string, JSON.stringify({ theme: "dark" })),
      [PREFERENCES_KEY],
    );
    await page.goto(APPEARANCE);
    await expect(page.locator("[data-settings]")).not.toHaveAttribute("data-ready", /.*/);
    await expect(theme(page)).toHaveValue("dark");
    await expect(theme(page)).not.toHaveCSS("color", "rgba(0, 0, 0, 0)");
    // Nor can it take a choice yet, by keyboard either: the change would not be saved, and the page's
    // first draw would put the stored theme back (CodeRabbit, PR 391, second round).
    const reachable = await page.evaluate(() => {
      const select = document.getElementById("settings-theme");
      select?.focus();
      return document.activeElement === select;
    });
    expect(reachable).toBe(false);
  });

  test("each theme choice sets the theme on the root and survives a reload", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openSettings(page, APPEARANCE);
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

  test("a client-side navigation from the podcast fills the controls in", async ({ page }) => {
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
    await page.getByRole("link", { name: /^Appearance/ }).click();
    await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
    await expect(theme(page)).toHaveValue("dark");
    await settingsLink(page).click();
    await page.getByRole("link", { name: /^Sound and voice/ }).click();
    await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
    await expect(sounds(page)).not.toBeChecked();
    await expect(volume(page)).toBeDisabled();
    await expect(volume(page)).toHaveValue("0.35");
  });

  test("the controls still work on a second visit in the same session", async ({ page }) => {
    await openSettings(page, APPEARANCE);
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
    await page.getByRole("link", { name: /^Appearance/ }).click();
    await expect(page).toHaveURL(/\/settings\/appearance$/);
    await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
    await expect(theme(page)).toHaveValue("dark");

    await theme(page).selectOption("light");
    await expect.poll(async () => (await stored(page)).theme).toBe("light");
  });
});

test.describe("settings page, Home Screen hint", () => {
  test("stays hidden in a browser that cannot add to the Home Screen", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("singularity:install-hint-visits", "5"));
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

test.describe("profile page", () => {
  // The bug it prevents: a bundled page script runs once per session, so the picker worked on the first
  // visit to /profile and was an empty, dead row on every visit after it, reached by a link.
  test("the edit button's sheet changes the avatar, on a first visit and on a second", async ({
    page,
  }) => {
    await page.goto("/settings");
    const toProfile = async () => {
      await page.getByRole("link", { name: "Your profile", exact: true }).click();
      await page.getByRole("button", { name: "Change picture" }).click();
      await expect(page.getByRole("dialog", { name: "Avatar" })).toBeVisible();
    };
    await toProfile();
    const sheet = page.getByRole("dialog", { name: "Avatar" });
    const second = sheet.locator("[data-shape]").nth(1);
    const shape = await second.getAttribute("data-shape");
    await second.click();
    await expect(sheet).toBeHidden();
    expect((await stored(page)).avatar).toBe(shape);

    await settingsLink(page).click();
    await toProfile();
    await expect(sheet.locator("[data-shape]")).not.toHaveCount(0);
    await expect(sheet.locator(`[data-shape="${shape}"]`)).toHaveAttribute("aria-pressed", "true");
  });

  // The bug it prevents (D353): a tap that starts a show it never ends, a morph that leaves the avatar
  // in another shape, or a show that plays for a reader who asked for calm.
  test("a tap on the avatar plays shows, a morph comes home, and a calm reader gets none", async ({
    page,
  }) => {
    const watch = () =>
      page.evaluate(() => {
        const seen = { plays: [] as string[], shapes: [] as string[] };
        (window as unknown as { __avatar: typeof seen }).__avatar = seen;
        const face = document.querySelector(".profile-face > *");
        new MutationObserver((changes) => {
          for (const change of changes) {
            const value = (change.target as HTMLElement).getAttribute(change.attributeName ?? "");
            if (!value) continue;
            (change.attributeName === "data-play" ? seen.plays : seen.shapes).push(value);
          }
        }).observe(face as Element, {
          attributes: true,
          attributeFilter: ["data-play", "data-shape"],
        });
      });
    const seen = () =>
      page.evaluate(
        () => (window as unknown as { __avatar: { plays: string[]; shapes: string[] } }).__avatar,
      );

    await page.clock.install();
    await page.goto("/profile");
    const face = page.locator(".profile-face > *");
    await expect(face).toHaveAttribute("data-shape", /./);
    const home = await face.getAttribute("data-shape");
    await watch();
    for (let tap = 0; tap < 5; tap++) {
      await face.click();
      await page.clock.runFor(2500);
    }
    const { plays, shapes } = await seen();
    expect(new Set(plays).size, "five taps, five different shows").toBeGreaterThan(3);
    expect(new Set(shapes).size, "a morph passed through other shapes").toBeGreaterThan(1);
    await expect(face).toHaveAttribute("data-shape", home ?? "");
    await expect(face).not.toHaveAttribute("data-play");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await expect(face).toHaveAttribute("data-shape", /./);
    await watch();
    await face.click();
    await page.clock.runFor(2500);
    expect((await seen()).plays).toEqual([]);
  });
});
