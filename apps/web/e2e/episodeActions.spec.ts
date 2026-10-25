import type { Page } from "@playwright/test";
import { expect, expectNoViolationsInEitherScheme, hydrated, test } from "./fixtures";

const ID = "ep-20261007-1930";

const more = (page: Page) => page.getByRole("button", { name: "More actions" });
const menu = (page: Page) => page.getByRole("menu", { name: "More actions" });
const regenerate = (page: Page) => page.locator('[data-episode-action="regenerate"]');
const remove = (page: Page) => page.locator('[data-episode-action="delete"]');

/**
 * Opens the More menu and picks one of its items, until its dialog is open: a press that lands
 * before the page's script is ready opens nothing.
 */
async function choose(page: Page, item: "Regenerate" | "Delete"): Promise<void> {
  await expect(async () => {
    if (!(await menu(page).isVisible())) await more(page).click();
    await menu(page).getByRole("menuitem", { name: item }).click({ timeout: 2000 });
    await expect(item === "Delete" ? confirm(page) : panel(page)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
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

test.describe("regenerate and delete an episode", () => {
  test("one More button holds the far end of the title row and opens a menu of two items", async ({
    page,
  }) => {
    await open(page);
    const button = more(page);
    await expect(button).toHaveAttribute("aria-haspopup", "menu");
    await expect(menu(page)).toBeHidden();
    // Share sits beside Play (D153, owner 2026-10-24), not in the menu. The button is a 44px target
    // at the header's far end, level with the title.
    const a = await button.boundingBox();
    const title = await page.locator(".hero h1").boundingBox();
    const row = await page.locator(".hero").boundingBox();
    expect(a?.width).toBeGreaterThanOrEqual(44);
    expect(a?.y).toBeLessThanOrEqual((title?.y ?? 0) + 4);
    expect((a?.x ?? 0) + (a?.width ?? 0)).toBeGreaterThan((row?.x ?? 0) + (row?.width ?? 0) - 12);
    await button.click();
    await expect(menu(page)).toBeVisible();
    const items = menu(page).getByRole("menuitem");
    await expect(items).toHaveText(["Regenerate", "Delete"]);
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
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu(page)).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("a pick closes the menu before its panel opens", async ({ page }) => {
    await open(page);
    await choose(page, "Regenerate");
    await expect(panel(page)).toBeVisible();
    await expect(menu(page)).toBeHidden();
    await page.keyboard.press("Escape");
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
    await panel(page).getByLabel("Comments (optional)").fill("  Shorter intro, more on design  ");
    await panel(page).getByRole("button", { name: "Regenerate episode" }).click();

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({
      action: "regenerate",
      id: ID,
      feedback: "Shorter intro, more on design",
    });
    await expect(panel(page)).toBeHidden();
    await expect(indicator(page)).toHaveText(/Rewrite queued|Rewriting your episode/);
    await expect(indicator(page)).toHaveText("Rewriting your episode", { timeout: 10_000 });
    // Both actions wait for the run, and say why.
    await expect(regenerate(page)).toHaveAttribute("aria-disabled", "true");
    await expect(remove(page)).toHaveAttribute("aria-disabled", "true");
    await more(page).click();
    await expect(
      menu(page).getByRole("menuitem", { name: "Regenerate" }),
    ).toHaveAccessibleDescription("Unavailable while this episode is being updated.");
    await page.keyboard.press("Escape");
    await expect(indicator(page)).toHaveText("Rewritten. Live in about a minute.", {
      timeout: 15_000,
    });
    await expect(regenerate(page)).not.toHaveAttribute("aria-disabled", "true");
  });

  test("an episode reached while offline has both items disabled, with the reason, until the connection is back", async ({
    page,
  }) => {
    // A page opened with the device already offline: the page's own scripts decide, not a change.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    });
    await open(page);
    for (const item of [regenerate(page), remove(page)]) {
      await expect(item).toHaveAttribute("aria-disabled", "true");
      await expect(item).toHaveAttribute("aria-describedby", "offline-reason");
    }
    await expect(page.locator("#offline-reason")).toHaveText(/\S/);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
      window.dispatchEvent(new Event("online"));
    });
    for (const item of [regenerate(page), remove(page)]) {
      await expect(item).not.toHaveAttribute("aria-disabled", "true");
      await expect(item).not.toHaveAttribute("aria-describedby", /.+/);
    }
  });

  test("topics start from the episode's own, one must stay, and a changed set is sent without comments", async ({
    page,
  }) => {
    const bodies = await mock(page, [{ run_id: 77, state: "queued", step: null }]);
    await open(page);
    await choose(page, "Regenerate");
    const on = panel(page).locator("label.filter-chip:has(input:checked)");
    const off = panel(page).locator("label.filter-chip:has(input:not(:checked))");
    await expect(on.first()).toBeVisible();
    const other = (await off.first().innerText()).trim();
    // Dropping every topic is refused inline and sends nothing.
    while ((await on.count()) > 0) await on.first().click();
    await panel(page).getByRole("button", { name: "Regenerate episode" }).click();
    await expect(panel(page).getByRole("alert")).toHaveText("Pick at least one category.");
    expect(bodies).toHaveLength(0);
    // One topic that was not ticked: sent as this regeneration's topics, comments left out.
    await panel(page).locator("label.filter-chip", { hasText: other }).click();
    await panel(page).getByRole("button", { name: "Regenerate episode" }).click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toMatchObject({ action: "regenerate", id: ID });
    expect(bodies[0]).not.toHaveProperty("feedback");
    expect((bodies[0] as { topic_ids: string[] }).topic_ids.length).toBeGreaterThan(0);
  });

  test("the character count shows only near the limit", async ({ page }) => {
    await open(page);
    await choose(page, "Regenerate");
    const field = panel(page).getByLabel("Comments (optional)");
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
    await expect(confirm(page)).toContainText(
      "It will be removed from the Library on every device. This cannot be undone.",
    );
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
    await confirm(page).getByRole("button", { name: "Delete", exact: true }).click();

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({ action: "delete", id: ID });
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

  test("Delete returns to the Library as it was left, and counts what is there", async ({
    page,
  }) => {
    const bodies = await mock(page, [{ run_id: 77, state: "queued", step: null }]);
    // The Library filtered to Episodes, oldest first, then the episode from it.
    await page.goto("/library?show=custom");
    await expect(page.locator("[data-library]")).toHaveAttribute("data-ready", "");
    await page.locator(`[data-card] a[href="/e/${ID}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/e/${ID}$`));
    await hydrated(page);
    await choose(page, "Delete");
    await confirm(page).getByRole("button", { name: "Delete", exact: true }).click();
    await expect.poll(() => bodies.length).toBe(1);
    await expect(page).toHaveURL(/\/library\?show=custom$/, { timeout: 5_000 });
    await expect(card(page)).toHaveCount(0);
    // A full load of it counts the cards that are there, not the one that was taken out.
    await page.reload();
    await expect(page.locator("[data-library]")).toHaveAttribute("data-ready", "");
    await expect
      .poll(async () => {
        const shown = await page.locator("[data-card]:not([hidden])").count();
        const status = (await page.locator("[data-library-status]").textContent()) ?? "";
        return status.includes(`${shown}`);
      })
      .toBe(true);
  });

  test("Back after Delete stays in the Library as it was left", async ({ page }) => {
    await mock(page, [{ run_id: 77, state: "queued", step: null }]);
    await page.goto("/library?show=custom");
    await expect(page.locator("[data-library]")).toHaveAttribute("data-ready", "");
    await page.locator(`[data-card] a[href="/e/${ID}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/e/${ID}$`));
    await hydrated(page);
    await choose(page, "Delete");
    await confirm(page).getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page).toHaveURL(/\/library\?show=custom$/, { timeout: 5_000 });
    // The entry behind it is the deleted episode's page, which sends the person to the Library they
    // left, with its filter and order, not to a bare one.
    await page.goBack();
    await expect(page).toHaveURL(/\/library\?show=custom$/, { timeout: 5_000 });
    await expect(card(page)).toHaveCount(0);
  });

  test("a rewrite's line goes when the episode is deleted, and does not read out afterwards", async ({
    page,
  }) => {
    await mock(page, [
      { run_id: 77, state: "running", step: null },
      { run_id: 77, state: "completed", step: null, outcome: "published" },
    ]);
    await open(page);
    await choose(page, "Regenerate");
    await panel(page).getByLabel("Comments (optional)").fill("Shorter intro");
    await panel(page).getByRole("button", { name: "Regenerate episode" }).click();
    await expect(indicator(page)).toHaveText("Rewritten. Live in about a minute.", {
      timeout: 15_000,
    });
    await expect(page.locator("[data-run-announce]")).toHaveText(
      "Rewritten. Live in about a minute.",
    );
    await choose(page, "Delete");
    await confirm(page).getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page).toHaveURL(/\/library$/, { timeout: 5_000 });
    // The episode is gone, so is what the line said about it, to the eye and to a screen reader.
    await expect(page.locator("[data-run-card]")).toBeHidden();
    await expect(page.locator("[data-run-announce]")).toHaveText("");
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
      await confirm(page).getByRole("button", { name: "Delete", exact: true }).click();
      await expect(confirm(page).getByRole("alert")).toContainText(
        "You can do that again in 2 minutes.",
      );
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
      await panel(page).getByLabel("Comments (optional)").fill("More depth");
      await panel(page).getByRole("button", { name: "Regenerate episode" }).click();
      await expect(panel(page).getByRole("alert")).toContainText(
        "You can do that again in 2 minutes.",
      );
      await expect(panel(page)).toBeVisible();
    });
  });

  test("axe finds nothing with the menu, the panel or the confirm open", async ({ page }) => {
    // Six scans on one page load.
    test.setTimeout(60_000);
    await open(page);
    await more(page).click();
    await expect(menu(page)).toBeVisible();
    await expectNoViolationsInEitherScheme(page);
    await page.keyboard.press("Escape");
    await choose(page, "Regenerate");
    await expect(panel(page)).toBeVisible();
    await expectNoViolationsInEitherScheme(page);
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
    await choose(page, "Delete");
    await expect(confirm(page)).toBeVisible();
    await expectNoViolationsInEitherScheme(page);
  });
});
