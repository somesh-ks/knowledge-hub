import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const PREFERENCES_KEY = "dispatch:preferences";

/** Safari on an iPhone: the one browser the Home Screen hint is written for. */
const IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

async function violations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(" "))
        .join(", ")}`,
  );
}

function stored(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), PREFERENCES_KEY);
}

/** Opens the page and waits until its script has filled the controls in. */
async function openSettings(page: Page): Promise<void> {
  await page.goto("/settings");
  await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
}

/** Both islands have hydrated, so a [data-open] click reaches the sheets. */
async function islandsReady(page: Page): Promise<void> {
  await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
}

const theme = (page: Page) => page.getByRole("radiogroup", { name: "Theme" });
const speed = (page: Page) => page.getByRole("radiogroup", { name: "Default speed" });
const sounds = (page: Page) => page.getByRole("switch", { name: "Interface sounds" });
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
      name: "Today",
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
    expect(main).not.toContain("data-ready");
    expect(main).toMatch(/<section[^>]*data-install-hint[^>]*hidden/);
  });

  test("each theme choice sets the theme on the root and survives a reload", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openSettings(page);
    const root = page.locator("html");
    await expect(theme(page).getByRole("radio", { name: "System" })).toBeChecked();
    await expect(root).not.toHaveAttribute("data-theme", /.*/);

    await theme(page).getByRole("radio", { name: "Dark" }).check();
    await expect(root).toHaveAttribute("data-theme", "dark");
    await expect.poll(async () => (await stored(page)).theme).toBe("dark");
    await page.reload();
    await expect(root).toHaveAttribute("data-theme", "dark");
    await expect(theme(page).getByRole("radio", { name: "Dark" })).toBeChecked();

    await theme(page).getByRole("radio", { name: "Light" }).check();
    await expect(root).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(root).toHaveAttribute("data-theme", "light");
    await expect(theme(page).getByRole("radio", { name: "Light" })).toBeChecked();

    await theme(page).getByRole("radio", { name: "System" }).check();
    await expect(root).not.toHaveAttribute("data-theme", /.*/);
    await expect.poll(async () => (await stored(page)).theme).toBe("system");
    await page.reload();
    await expect(root).not.toHaveAttribute("data-theme", /.*/);
    await expect(theme(page).getByRole("radio", { name: "System" })).toBeChecked();
  });

  test("arrow keys move the theme choice", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openSettings(page);
    const root = page.locator("html");
    await theme(page).getByRole("radio", { name: "System" }).focus();

    await page.keyboard.press("ArrowRight");
    await expect(theme(page).getByRole("radio", { name: "Light" })).toBeChecked();
    await expect(theme(page).getByRole("radio", { name: "Light" })).toBeFocused();
    await expect(root).toHaveAttribute("data-theme", "light");

    await page.keyboard.press("ArrowRight");
    await expect(theme(page).getByRole("radio", { name: "Dark" })).toBeChecked();
    await expect(root).toHaveAttribute("data-theme", "dark");

    await page.keyboard.press("ArrowLeft");
    await expect(theme(page).getByRole("radio", { name: "Light" })).toBeChecked();
    await expect(root).toHaveAttribute("data-theme", "light");
    await expect.poll(async () => (await stored(page)).theme).toBe("light");
  });

  test("turning interface sounds off disables the volume, and back on enables it", async ({
    page,
  }) => {
    await openSettings(page);
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
    await openSettings(page);
    await expect(sounds(page)).not.toBeChecked();
    await expect(volume(page)).toBeDisabled();
  });

  test("sets the volume from the keyboard, fills the track to match and persists it", async ({
    page,
  }) => {
    await openSettings(page);
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

  test("the default speed persists and reaches the player", async ({ page }) => {
    await openSettings(page);
    // The player announces once its island has hydrated.
    await islandsReady(page);
    await expect(speed(page).getByRole("radio", { name: "1x", exact: true })).toBeChecked();

    await speed(page).getByRole("radio", { name: "1.5x" }).check();
    await expect.poll(async () => (await stored(page)).rate).toBe(1.5);
    // The player store announces a speed change, so hearing it means the live player took the rate.
    await expect(page.locator("[data-announcer]").filter({ hasText: "Speed 1.5x." })).toHaveCount(
      1,
    );

    await page.reload();
    await expect(speed(page).getByRole("radio", { name: "1.5x" })).toBeChecked();
    await expect(speed(page).getByRole("radio", { name: "1x", exact: true })).not.toBeChecked();
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
    await expect(theme(page).getByRole("radio", { name: "Dark" })).toBeChecked();
    await expect(speed(page).getByRole("radio", { name: "1.25x" })).toBeChecked();
    await expect(sounds(page)).not.toBeChecked();
    await expect(volume(page)).toBeDisabled();
    await expect(volume(page)).toHaveValue("0.35");
  });

  test("the controls still work on a second visit in the same session", async ({ page }) => {
    await openSettings(page);
    await speed(page).getByRole("radio", { name: "2x" }).check();
    await expect.poll(async () => (await stored(page)).rate).toBe(2);

    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Library" })
      .click();
    await expect(page).toHaveURL(/\/library$/);
    // The page's script has already run once; this time only the router's event can start it.
    await settingsLink(page).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
    await expect(speed(page).getByRole("radio", { name: "2x" })).toBeChecked();

    await speed(page).getByRole("radio", { name: "1.25x" }).check();
    await expect.poll(async () => (await stored(page)).rate).toBe(1.25);
    await sounds(page).click();
    await expect(volume(page)).toBeDisabled();
  });

  test("nothing overflows at 320px and the segmented choices take the row's width", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await openSettings(page);
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
    // The column is measured, not assumed: a desktop browser keeps a scrollbar's width back from it.
    const column = await page.locator("[data-settings]").boundingBox();
    expect(column?.x ?? 0).toBeGreaterThanOrEqual(16);
    for (const group of [theme(page), speed(page)]) {
      const box = await group.boundingBox();
      // Under its label and as wide as the column, so four speeds never fight the label for room.
      expect(box?.x ?? 0).toBeCloseTo(column?.x ?? -1, 0);
      expect(box?.width ?? 0).toBeCloseTo(column?.width ?? -1, 0);
      const segments = await group
        .getByRole("radio")
        .evaluateAll((inputs) =>
          inputs.map((input) => Math.round(input.getBoundingClientRect().width)),
        );
      expect(Math.min(...segments)).toBeGreaterThanOrEqual(44);
    }
  });

  test("every control has a 44px target", async ({ page }) => {
    await openSettings(page);
    const small = await page.evaluate(() => {
      const found: string[] = [];
      const report = (name: string, width: number, height: number) => {
        if (width < 44 || height < 44)
          found.push(`${name} ${Math.round(width)}x${Math.round(height)}`);
      };
      const controls = document.querySelectorAll<HTMLElement>(
        "[data-settings] input, [data-settings] button",
      );
      for (const control of controls) {
        const rect = control.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const name = control.getAttribute("name") ?? control.textContent?.trim().slice(0, 24) ?? "";
        if (control.matches('[role="switch"]')) {
          // The track is 32px tall; its target reaches 6px past it above and below.
          control.scrollIntoView({ block: "center" });
          const box = control.getBoundingClientRect();
          const x = box.left + box.width / 2;
          const above = document.elementFromPoint(x, box.top - 5);
          const below = document.elementFromPoint(x, box.bottom + 5);
          const reaches = above === control && below === control;
          report(name, box.width, reaches ? box.height + 12 : box.height);
        } else {
          report(name, rect.width, rect.height);
        }
      }
      return found;
    });
    expect(small).toEqual([]);
  });
});

test.describe("settings page, Home Screen hint", () => {
  test("stays hidden in a browser that cannot add to the Home Screen", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("dispatch:install-hint-visits", "5"));
    await openSettings(page);
    await expect(page.getByRole("heading", { name: "This device" })).toBeHidden();
  });

  test.describe("in Safari on iOS", () => {
    test.use({ userAgent: IOS_SAFARI });

    test("appears on the second visit and stays gone once hidden", async ({ page }) => {
      await openSettings(page);
      const heading = page.getByRole("heading", { name: "This device" });
      await expect(heading).toBeHidden();

      await page.reload();
      await expect(page.locator("[data-settings]")).toHaveAttribute("data-ready", "true");
      await expect(heading).toBeVisible();
      await expect(page.getByText("Add Singularity to your Home Screen")).toBeVisible();
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

for (const scheme of ["light", "dark"] as const) {
  test.describe(`settings page, axe, ${scheme} scheme`, () => {
    test("the page has no WCAG 2.2 AA violations", async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openSettings(page);
      await page.evaluate(() => document.fonts.ready);
      expect(await violations(page)).toEqual([]);
    });

    test("the page with sounds off has no violations", async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await openSettings(page);
      await expect(volume(page)).toBeDisabled();
      expect(await violations(page)).toEqual([]);
    });
  });
}

test.describe("settings page, explicit theme against the system", () => {
  for (const choice of ["light", "dark"] as const) {
    test(`has no violations with ${choice} chosen`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: choice === "light" ? "dark" : "light" });
      await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
        PREFERENCES_KEY,
        JSON.stringify({ theme: choice }),
      ] as const);
      await openSettings(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", choice);
      expect(await violations(page)).toEqual([]);
    });
  }
});
