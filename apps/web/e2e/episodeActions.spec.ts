import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, hydrated, test } from "./fixtures";
import { PASSPHRASE_REQUIRED } from "./passphrase";

const ID = "ep-20261007-1930";
const SENT = PASSPHRASE_REQUIRED ? "correct horse battery staple" : "open";

const more = (page: Page) => page.getByRole("button", { name: "More actions" });
const menu = (page: Page) => page.getByRole("menu", { name: "More actions" });
const regenerate = (page: Page) => page.locator('[data-episode-action="regenerate"]');
const remove = (page: Page) => page.locator('[data-episode-action="delete"]');

/** Opens the More menu and picks one of its two items. */
async function choose(page: Page, item: "Regenerate" | "Delete"): Promise<void> {
  await more(page).click();
  await menu(page).getByRole("menuitem", { name: item }).click();
}
const panel = (page: Page) => page.locator("dialog.regen-sheet");
const confirm = (page: Page) => page.locator("dialog.confirm-dialog");
const card = (page: Page) => page.locator(`[data-card] a[href="/e/${ID}"]`);
const indicator = (page: Page) => page.locator("[data-run-text]");

async function open(page: Page): Promise<void> {
  await page.goto(`/e/${ID}`);
  await page.evaluate(() => document.fonts.ready);
  await hydrated(page);
}

async function mock(page: Page, states: unknown[]): Promise<Array<Record<string, unknown>>> {
  const bodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/podcast", async (route) => {
    bodies.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ status: 202, run_id: 77, started_at: "x" }),
    });
  });
  let asked = 0;
  await page.route("**/api/status?**", async (route) => {
    const next = states[Math.min(asked, states.length - 1)];
    asked += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(next),
    });
  });
  return bodies;
}

async function fillPassphrase(dialog: ReturnType<typeof panel>): Promise<void> {
  if (PASSPHRASE_REQUIRED) await dialog.getByLabel("Passphrase").fill(SENT);
}

test.describe("regenerate and delete an episode", () => {
  test("one More button holds the far end of the title row and opens a menu of three items", async ({
    page,
  }) => {
    await open(page);
    const button = more(page);
    await expect(button).toHaveAttribute("aria-haspopup", "menu");
    await expect(menu(page)).toBeHidden();
    // No standalone Share: it lives in the menu. The button is a 44px target level with the title.
    await expect(page.getByRole("button", { name: "Share this episode" })).toHaveCount(0);
    const a = await button.boundingBox();
    const title = await page.locator(".hero h1").boundingBox();
    const row = await page.locator(".hero-title-row").boundingBox();
    expect(a?.width).toBeGreaterThanOrEqual(44);
    expect(a?.y).toBeLessThanOrEqual((title?.y ?? 0) + 4);
    expect((a?.x ?? 0) + (a?.width ?? 0)).toBeGreaterThan((row?.x ?? 0) + (row?.width ?? 0) - 12);
    await button.click();
    await expect(menu(page)).toBeVisible();
    const items = menu(page).getByRole("menuitem");
    await expect(items).toHaveText(["Share", "Regenerate", "Delete"]);
    await expect(items.first()).toBeFocused();
    // The menu hangs under the button, not at the edge of the page.
    const m = await menu(page).boundingBox();
    expect(m?.y).toBeGreaterThanOrEqual((a?.y ?? 0) + (a?.height ?? 0));
    expect(Math.abs((m?.x ?? 0) + (m?.width ?? 0) - ((a?.x ?? 0) + (a?.width ?? 0)))).toBeLessThan(
      2,
    );
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.nth(2)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(items.nth(2)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("a pick closes the menu before its panel opens", async ({ page }) => {
    await open(page);
    await choose(page, "Regenerate");
    await expect(panel(page)).toBeVisible();
    await expect(menu(page)).toBeHidden();
    await panel(page).getByRole("button", { name: "Close" }).click();
    await expect(more(page)).toBeFocused();
  });

  test("Regenerate sends the exact body and the indicator takes over", async ({ page }) => {
    const bodies = await mock(page, [
      { run_id: 77, state: "running", step: null },
      { run_id: 77, state: "completed", step: null, outcome: "published" },
    ]);
    await open(page);
    await choose(page, "Regenerate");
    await expect(panel(page)).toBeVisible();
    await expect(
      panel(page).getByRole("heading", { name: "Regenerate this episode" }),
    ).toBeVisible();
    await panel(page).getByLabel("What should change?").fill("  Shorter intro, more on design  ");
    await fillPassphrase(panel(page));
    await panel(page).getByRole("button", { name: "Regenerate episode" }).click();

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({
      passphrase: SENT,
      action: "regenerate",
      id: ID,
      feedback: "Shorter intro, more on design",
    });
    await expect(panel(page)).toBeHidden();
    await expect(indicator(page)).toHaveText(/Waiting to start|Rewriting your episode/);
    await expect(indicator(page)).toHaveText("Rewriting your episode", { timeout: 10_000 });
    // Both actions wait for the run, and say why.
    await expect(regenerate(page)).toHaveAttribute("aria-disabled", "true");
    await expect(remove(page)).toHaveAttribute("aria-disabled", "true");
    await more(page).click();
    await expect(
      menu(page).getByRole("menuitem", { name: "Regenerate" }),
    ).toHaveAccessibleDescription("Unavailable while this episode is being updated.");
    await page.keyboard.press("Escape");
    await expect(indicator(page)).toHaveText("Episode ready", { timeout: 15_000 });
    await expect(regenerate(page)).not.toHaveAttribute("aria-disabled", "true");
  });

  test("empty feedback is refused inline and nothing is sent", async ({ page }) => {
    const bodies = await mock(page, [{ run_id: 77, state: "queued", step: null }]);
    await open(page);
    await choose(page, "Regenerate");
    await fillPassphrase(panel(page));
    await panel(page).getByLabel("What should change?").fill("   ");
    await panel(page).getByRole("button", { name: "Regenerate episode" }).click();
    await expect(panel(page).getByRole("alert")).toHaveText("Describe what should change.");
    await expect(panel(page).getByLabel("What should change?")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(bodies).toHaveLength(0);
    await expect(panel(page)).toBeVisible();
  });

  test("the character count shows only near the limit", async ({ page }) => {
    await open(page);
    await choose(page, "Regenerate");
    const field = panel(page).getByLabel("What should change?");
    const count = panel(page).locator("[data-count]");
    await field.fill("a".repeat(100));
    await expect(count).toBeHidden();
    await field.fill("a".repeat(460));
    await expect(count).toBeVisible();
    await expect(count).toHaveText("40 characters left");
  });

  test("Delete asks first, and Cancel sends nothing", async ({ page }) => {
    const bodies = await mock(page, [{ run_id: 77, state: "queued", step: null }]);
    await open(page);
    await choose(page, "Delete");
    await expect(confirm(page)).toBeVisible();
    await expect(confirm(page)).toContainText("Delete this episode?");
    await expect(confirm(page)).toContainText("It is removed from the Library for everyone.");
    await confirm(page).getByRole("button", { name: "Cancel" }).click();
    await expect(confirm(page)).toBeHidden();
    await expect(more(page)).toBeFocused();
    expect(bodies).toHaveLength(0);
    await expect(page).toHaveURL(new RegExp(`/e/${ID}$`));
  });

  test("Delete sends the exact body, lands on the Library at once and hides the episode", async ({
    page,
  }) => {
    const bodies = await mock(page, [{ run_id: 77, state: "queued", step: null }]);
    await open(page);
    await choose(page, "Delete");
    await fillPassphrase(confirm(page));
    await confirm(page).getByRole("button", { name: "Delete", exact: true }).click();

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({ passphrase: SENT, action: "delete", id: ID });
    await expect(page).toHaveURL(/\/library$/, { timeout: 5_000 });
    // No progress to watch, and the card is gone while the site still has it.
    await expect(indicator(page)).toBeHidden();
    await expect(page.locator(".library-grid")).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    await expect(page.locator("[data-card]").first()).toBeVisible();
    // A reload and the episode's own address agree.
    await page.reload();
    await expect(card(page)).toHaveCount(0);
    await page.goto(`/e/${ID}`);
    await expect(page).toHaveURL(/\/library$/);
    await expect(card(page)).toHaveCount(0);
  });

  test.describe("a refusal", () => {
    // The browser logs the 429 it was served on purpose.
    test.use({ allowNetworkErrors: true });

    test("a refused delete hides nothing", async ({ page }) => {
      await page.route("**/api/podcast", (route) =>
        route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({ status: 429, error: "cooldown", retry_after_s: 90 }),
        }),
      );
      await open(page);
      await choose(page, "Delete");
      await fillPassphrase(confirm(page));
      await confirm(page).getByRole("button", { name: "Delete", exact: true }).click();
      await expect(confirm(page).getByRole("alert")).toContainText("Try again in 2 minutes.");
      await expect(page).toHaveURL(new RegExp(`/e/${ID}$`));
      await page.goto("/library");
      await expect(card(page)).toHaveCount(1);
    });

    test("shows its reason in the panel", async ({ page }) => {
      await page.route("**/api/podcast", (route) =>
        route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({ status: 429, error: "cooldown", retry_after_s: 90 }),
        }),
      );
      await open(page);
      await choose(page, "Regenerate");
      await fillPassphrase(panel(page));
      await panel(page).getByLabel("What should change?").fill("More depth");
      await panel(page).getByRole("button", { name: "Regenerate episode" }).click();
      await expect(panel(page).getByRole("alert")).toContainText("Try again in 2 minutes.");
      await expect(panel(page)).toBeVisible();
    });
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`axe finds nothing with the menu open, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      await more(page).click();
      await expect(menu(page)).toBeVisible();
      await page.waitForTimeout(500);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    });

    test(`axe finds nothing with the panel open, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      await choose(page, "Regenerate");
      await expect(panel(page)).toBeVisible();
      await page.waitForTimeout(500);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    });

    test(`axe finds nothing with the confirm open, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      await choose(page, "Delete");
      await expect(confirm(page)).toBeVisible();
      await page.waitForTimeout(500);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    });
  }
});
