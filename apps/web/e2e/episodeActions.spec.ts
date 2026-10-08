import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, hydrated, test } from "./fixtures";
import { PASSPHRASE_REQUIRED } from "./passphrase";

const ID = "ep-20261007-1930";
const SENT = PASSPHRASE_REQUIRED ? "correct horse battery staple" : "open";

const regenerate = (page: Page) => page.getByRole("button", { name: "Regenerate", exact: true });
const remove = (page: Page) => page.getByRole("button", { name: "Delete", exact: true });
const panel = (page: Page) => page.locator("dialog.regen-sheet");
const confirm = (page: Page) => page.locator("dialog.confirm-dialog");
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
  test("Regenerate sends the exact body and the indicator takes over", async ({ page }) => {
    const bodies = await mock(page, [
      { run_id: 77, state: "running", step: null },
      { run_id: 77, state: "completed", step: null, outcome: "published" },
    ]);
    await open(page);
    await regenerate(page).click();
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
    await expect(regenerate(page)).toHaveAccessibleDescription(
      "Unavailable while this episode is being updated.",
    );
    await expect(indicator(page)).toHaveText("Episode ready", { timeout: 15_000 });
    await expect(regenerate(page)).not.toHaveAttribute("aria-disabled", "true");
  });

  test("empty feedback is refused inline and nothing is sent", async ({ page }) => {
    const bodies = await mock(page, [{ run_id: 77, state: "queued", step: null }]);
    await open(page);
    await regenerate(page).click();
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
    await regenerate(page).click();
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
    await remove(page).click();
    await expect(confirm(page)).toBeVisible();
    await expect(confirm(page)).toContainText("Delete this episode?");
    await expect(confirm(page)).toContainText("It is removed from the Library for everyone.");
    await confirm(page).getByRole("button", { name: "Cancel" }).click();
    await expect(confirm(page)).toBeHidden();
    await expect(remove(page)).toBeFocused();
    expect(bodies).toHaveLength(0);
    await expect(page).toHaveURL(new RegExp(`/e/${ID}$`));
  });

  test("Delete sends the exact body, then lands on the Library when the run completes", async ({
    page,
  }) => {
    const bodies = await mock(page, [
      { run_id: 77, state: "running", step: null },
      { run_id: 77, state: "completed", step: null, outcome: "published" },
    ]);
    await open(page);
    await remove(page).click();
    await fillPassphrase(confirm(page));
    await confirm(page).getByRole("button", { name: "Delete", exact: true }).click();

    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({ passphrase: SENT, action: "delete", id: ID });
    await expect(confirm(page)).toBeHidden();
    await expect(indicator(page)).toHaveText("Removing the episode", { timeout: 10_000 });
    await expect(page).toHaveURL(/\/library$/, { timeout: 15_000 });
    await expect(indicator(page)).toHaveText("Episode removed");
  });

  test.describe("a refusal", () => {
    // The browser logs the 429 it was served on purpose.
    test.use({ allowNetworkErrors: true });

    test("shows its reason in the panel", async ({ page }) => {
      await page.route("**/api/podcast", (route) =>
        route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({ status: 429, error: "cooldown", retry_after_s: 90 }),
        }),
      );
      await open(page);
      await regenerate(page).click();
      await fillPassphrase(panel(page));
      await panel(page).getByLabel("What should change?").fill("More depth");
      await panel(page).getByRole("button", { name: "Regenerate episode" }).click();
      await expect(panel(page).getByRole("alert")).toContainText("Try again in 2 minutes.");
      await expect(panel(page)).toBeVisible();
    });
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`axe finds nothing with the panel open, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      await regenerate(page).click();
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
      await remove(page).click();
      await expect(confirm(page)).toBeVisible();
      await page.waitForTimeout(500);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations.map((v) => v.id)).toEqual([]);
    });
  }
});
