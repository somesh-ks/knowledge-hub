import {
  expect,
  expectNoViolationsInEitherScheme,
  hydrated,
  ROUTES,
  test,
  violations,
} from "./fixtures";

for (const scheme of ["light", "dark"] as const) {
  test.describe(`axe, ${scheme} scheme`, { tag: "@both" }, () => {
    for (const route of ROUTES) {
      test(`${route.name} has no WCAG 2.2 AA violations`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(route.path);
        await page.evaluate(() => document.fonts.ready);
        expect(await violations(page)).toEqual([]);
      });
    }
  });
}

test("axe, home with each theme chosen against the system", async ({ page }) => {
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light" });
    await page.goto("/");
    await page.evaluate(
      (value) => localStorage.setItem("dispatch:preferences", JSON.stringify({ theme: value })),
      theme,
    );
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(await violations(page), `${theme} chosen`).toEqual([]);
  }
});

test.describe("axe, banners and live states", () => {
  test("the offline banner has no violations", async ({ page, context }) => {
    await page.goto("/");
    // Let the islands finish hydrating before the network goes away.
    await page.waitForLoadState("networkidle");
    await hydrated(page);
    // The click cues load at idle or at the first gesture: have them here before the network goes,
    // so the press below is not the one that needs it.
    await page.evaluate(() => window.dispatchEvent(new Event("pointerdown")));
    await page.waitForFunction(() =>
      performance.getEntriesByType("resource").some((entry) => /\/uiClicks\./.test(entry.name)),
    );
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    const banner = page.locator('[data-banner="offline"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("You are offline");
    await expect(banner.locator(".banner-body")).toHaveCount(0);
    await expect(page.locator(".hero [data-play-digest]")).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator("[data-play-item]").first()).toBeHidden();
    // New episode needs the network: it is disabled, and a press opens no sheet.
    const creates = page.locator("[data-create-open]");
    const disabled = () =>
      creates.evaluateAll((all) => all.map((each) => each.getAttribute("aria-disabled")));
    await expect.poll(disabled).not.toContain(null);
    const create = creates.filter({ visible: true }).first();
    if ((await creates.filter({ visible: true }).count()) > 0) {
      // Forced: an aria-disabled control is one Playwright will not press on its own.
      await create.click({ force: true });
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page).toHaveURL(/\/$/);
    }
    expect(await violations(page)).toEqual([]);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => (await disabled()).every((each) => each === null)).toBe(true);
  });

  test("reader state written by the player has no violations, in either scheme", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await hydrated(page);
    await page.evaluate(() => {
      const root = document.documentElement;
      root.dataset.playerState = "playing";
      root.dataset.mini = "visible";
      const face = (chip: Element | null | undefined, state: string, label: string): void => {
        chip?.setAttribute("data-state", state);
        chip?.setAttribute("data-playing", String(label === "Playing"));
        const text = chip?.querySelector("[data-chip-label]");
        if (text) text.textContent = label;
      };
      const stories = document.querySelectorAll<HTMLElement>(".story");
      stories[0]?.setAttribute("data-state", "played");
      face(stories[0]?.querySelector("[data-play-item]"), "played", "Played");
      stories[1]?.setAttribute("data-state", "current");
      face(stories[1]?.querySelector("[data-play-item]"), "current", "Playing");
      face(stories[2]?.querySelector("[data-play-item]"), "preparing", "Loading");
      face(document.querySelector(".hero [data-play-digest]"), "current", "Playing");
    });
    await expectNoViolationsInEitherScheme(page);
  });

  test("the section in view is announced as current on the tabs", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      document.querySelector("#c-research")?.scrollIntoView({ block: "start" });
    });
    await expect(page.locator('.tab[aria-current="true"]')).toHaveText("Research");
    expect(await violations(page)).toEqual([]);
  });
});
