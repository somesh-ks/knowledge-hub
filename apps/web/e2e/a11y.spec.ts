import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, hydrated, ROUTES, test } from "./fixtures";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

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

for (const scheme of ["light", "dark"] as const) {
  test.describe(`axe, ${scheme} scheme`, () => {
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

test.describe("axe, explicit theme override", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`home with the ${theme} theme chosen against the system`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme === "light" ? "dark" : "light" });
      await page.addInitScript(
        (value) => localStorage.setItem("dispatch:preferences", JSON.stringify({ theme: value })),
        theme,
      );
      await page.goto("/");
      expect(await violations(page)).toEqual([]);
    });
  }
});

test.describe("axe, banners and live states", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`the stale banner has no violations and no owner-only action, ${scheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      // Eleven days after the newest fixture digest, so the home page shows the stale banner.
      await page.clock.setFixedTime(new Date("2026-10-18T09:00:00+02:00"));
      await page.goto("/");
      const banner = page.locator('[data-banner="stale"]');
      await expect(banner).toBeVisible();
      await expect(banner.locator(".banner-title")).toHaveText("This briefing is 11 days old");
      await expect(banner.locator(".banner-body")).toHaveText(
        "No newer briefing has been published yet.",
      );
      // True for any reader: nothing here opens the owner's passphrase sheet.
      await expect(banner.locator("button, a, [data-open]")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Generate/ })).toHaveCount(0);
      await expect(page.locator("main [data-open], #banners [data-open]")).toHaveCount(0);
      expect(await violations(page)).toEqual([]);
    });
  }

  test("a dated page never shows the stale banner", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-18T09:00:00+02:00"));
    await page.goto("/d/2026-10-05");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Monday 5 October");
    await expect(page.locator('[data-banner="stale"]')).toHaveCount(0);
  });

  test("the offline banner has no violations", async ({ page, context }) => {
    await page.goto("/");
    // Let the islands finish hydrating before the network goes away.
    await page.waitForLoadState("networkidle");
    await hydrated(page);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    const banner = page.locator('[data-banner="offline"]');
    await expect(banner).toBeVisible();
    await expect(banner.locator(".banner-body")).toContainText("Audio needs a connection.");
    await expect(page.locator("[data-play-digest]")).toHaveAttribute("aria-disabled", "true");
    await expect(page.locator("[data-play-item]").first()).toBeHidden();
    expect(await violations(page)).toEqual([]);
    await context.setOffline(false);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`reader state written by the player has no violations, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
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
        face(document.querySelector("[data-play-digest]"), "current", "Playing");
      });
      // Colours change over 200ms; contrast is measured on the settled page.
      await page.waitForTimeout(300);
      expect(await violations(page)).toEqual([]);
    });
  }

  test("a briefing with no audio yet has no violations in either scheme", async ({ page }) => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/d/2026-10-05");
      // Nothing is said under the chip before audio exists; the chip itself is the whole state.
      await expect(page.locator("[data-play-digest]")).toBeVisible();
      await expect(page.locator(".hero-hint")).toHaveCount(0);
      expect(await violations(page)).toEqual([]);
    }
  });

  test("the section in view is announced as current on the tabs", async ({ page, isMobile }) => {
    test.skip(!isMobile, "The tabs show below 80rem");
    await page.goto("/");
    await page.evaluate(() => {
      document.querySelector("#c-research")?.scrollIntoView({ block: "start" });
    });
    await expect(page.locator('.tab[aria-current="true"]')).toHaveText("Research");
    expect(await violations(page)).toEqual([]);
  });
});
