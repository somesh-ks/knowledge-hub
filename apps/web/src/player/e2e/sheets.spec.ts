import type { Page, Route } from "@playwright/test";
import { expect, test } from "./lab";

type Json = Record<string, unknown>;

function reply(route: Route, status: number, body: Json, headers: Record<string, string> = {}) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers,
    body: JSON.stringify(body),
  });
}

/** Answers /api/status with the given bodies in order, then repeats the last one. */
async function scriptStatus(page: Page, bodies: Json[]): Promise<{ calls: () => number }> {
  let calls = 0;
  await page.route("**/api/status**", (route) => {
    const body = bodies[Math.min(calls, bodies.length - 1)] ?? {};
    calls += 1;
    return reply(route, 200, body);
  });
  return { calls: () => calls };
}

async function openGenerate(page: Page) {
  await page.locator('[data-open-sheet="generate"]').tap();
  const dialog = page.getByRole("dialog", { name: "Generate a new briefing" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("with a mouse", () => {
  test("every control inside a sheet takes a mouse click, not only a tap", async ({
    lab,
    page,
  }) => {
    await lab.open();
    await page.locator('[data-open-sheet="settings"]').click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await expect(dialog).toBeVisible();
    const toggle = dialog.getByRole("switch", { name: "Interface sounds" });
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await dialog.getByLabel("2x").click({ force: true });
    await expect(dialog.getByLabel("2x")).toBeChecked();
    await dialog.getByRole("button", { name: "Close settings" }).click();
    await expect(dialog).toBeHidden();
    await page.locator('[data-open-sheet="generate"]').click();
    const generate = page.getByRole("dialog", { name: "Generate a new briefing" });
    await generate.getByRole("button", { name: "Generate briefing" }).click();
    await expect(generate.getByRole("alert")).toBeVisible();
  });

  test("the expanded player takes mouse clicks on its controls", async ({ lab, page }) => {
    await lab.open();
    await lab.cta.click();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    await page.locator(".mini-open").click();
    await lab.settled();
    await page.getByRole("button", { name: "Next item" }).click();
    await expect(page.locator(".player-meta .player-section")).toContainText("2 of 6");
    await page.getByRole("button", { name: "Pause" }).first().click();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "paused");
    await page.getByRole("button", { name: "Close the player" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-player", "closed", { timeout: 4_000 });
  });
});

test.describe("the Generate sheet", () => {
  test("opens from the header button, labelled and focused on the field", async ({ lab, page }) => {
    await lab.open();
    await page.locator('[data-open-sheet="generate"]').focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Generate a new briefing" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Passphrase")).toBeFocused();
    await expect(dialog.getByLabel("Passphrase")).toHaveAttribute("type", "password");
    const size = await dialog
      .getByLabel("Passphrase")
      .evaluate((input) => Number.parseFloat(getComputedStyle(input).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-open-sheet="generate"]')).toBeFocused();
  });

  test("explains an empty submit inline and keeps focus on the field", async ({ lab, page }) => {
    await lab.open();
    const dialog = await openGenerate(page);
    await dialog.getByRole("button", { name: "Generate briefing" }).tap();
    await expect(dialog.getByRole("alert")).toHaveText("Enter the passphrase to continue.");
    await expect(dialog.getByLabel("Passphrase")).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByLabel("Passphrase")).toBeFocused();
  });

  test("explains a wrong passphrase, selecting the text so retyping is one motion", async ({
    lab,
    page,
  }) => {
    await page.route("**/api/generate", (route) =>
      reply(route, 401, { error: "wrong_passphrase" }),
    );
    await lab.open();
    const dialog = await openGenerate(page);
    await dialog.getByLabel("Passphrase").fill("nope");
    await dialog.getByRole("button", { name: "Generate briefing" }).tap();
    await expect(dialog.getByRole("alert")).toHaveText(
      "That passphrase does not match. Check it and try again.",
    );
    const selected = await dialog
      .getByLabel("Passphrase")
      .evaluate(
        (input: HTMLInputElement) => input.selectionEnd === 4 && input.selectionStart === 0,
      );
    expect(selected).toBe(true);
    await dialog.getByLabel("Passphrase").press("x");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
  });

  test("tells the time remaining on a cooldown", async ({ lab, page }) => {
    await page.route("**/api/generate", (route) =>
      reply(route, 429, { error: "cooldown", retry_after_s: 5 * 3600 + 12 * 60 }),
    );
    await lab.open();
    const dialog = await openGenerate(page);
    await dialog.getByLabel("Passphrase").fill("secret");
    await dialog.getByRole("button", { name: "Generate briefing" }).tap();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Generate is on cooldown. Try again in 5 hours 12 minutes.",
    );
  });

  test("explains an unavailable service", async ({ lab, page }) => {
    await page.route("**/api/generate", (route) => reply(route, 503, { error: "unavailable" }));
    await lab.open();
    const dialog = await openGenerate(page);
    await dialog.getByLabel("Passphrase").fill("secret");
    await dialog.getByRole("button", { name: "Generate briefing" }).tap();
    await expect(dialog.getByRole("alert")).toContainText("not available right now");
  });

  test("shows the six steps while a run goes, then offers the new briefing", async ({
    lab,
    page,
  }) => {
    await page.route("**/api/generate", (route) =>
      reply(route, 202, { run_id: 77, started_at: "2026-01-14T07:13:00Z" }),
    );
    await scriptStatus(page, [
      { run_id: 77, state: "queued", step: null },
      { run_id: 77, state: "running", step: "reading" },
      { run_id: 77, state: "running", step: "writing" },
      {
        run_id: 77,
        state: "completed",
        step: "publishing",
        outcome: "published",
        digest_id: "2026-01-16",
      },
    ]);
    await lab.open();
    const dialog = await openGenerate(page);
    await dialog.getByLabel("Passphrase").fill("secret");
    await dialog.getByRole("button", { name: "Generate briefing" }).tap();
    const steps = dialog.getByRole("list", { name: "Progress" }).getByRole("listitem");
    await expect(steps).toHaveCount(6);
    await expect(steps.nth(0)).toContainText("In progress");
    await expect(dialog.getByRole("button", { name: "Generating" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(steps.nth(1)).toContainText("In progress", { timeout: 10_000 });
    await expect(steps.nth(0)).toContainText("Done");
    await expect(steps.nth(3)).toContainText("In progress", { timeout: 10_000 });
    await expect(dialog.getByText("Briefing ready")).toBeVisible({ timeout: 10_000 });
    for (let index = 0; index < 6; index += 1) await expect(steps.nth(index)).toContainText("Done");
    await dialog.getByRole("button", { name: "Open the new briefing" }).tap();
    await expect(page).toHaveURL(/\/d\/2026-01-16/);
  });

  test("says nothing cleared the bar when the run has nothing to publish", async ({
    lab,
    page,
  }) => {
    await page.route("**/api/generate", (route) =>
      reply(route, 202, { run_id: 78, started_at: "2026-01-14T07:13:00Z" }),
    );
    await scriptStatus(page, [
      { run_id: 78, state: "completed", step: "publishing", outcome: "nothing" },
    ]);
    await lab.open();
    const dialog = await openGenerate(page);
    await dialog.getByLabel("Passphrase").fill("secret");
    await dialog.getByRole("button", { name: "Generate briefing" }).tap();
    await expect(dialog.getByText("Nothing cleared the bar.")).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByRole("button", { name: "Close", exact: true }).last()).toBeVisible();
  });

  test("names the step that failed and links to the run", async ({ lab, page }) => {
    await page.route("**/api/generate", (route) =>
      reply(route, 202, { run_id: 79, started_at: "2026-01-14T07:13:00Z" }),
    );
    await scriptStatus(page, [
      { run_id: 79, state: "running", step: "writing" },
      {
        run_id: 79,
        state: "completed",
        step: "writing",
        outcome: "failed",
        run_url: "https://github.com/example/dispatch/actions/runs/79",
      },
    ]);
    await lab.open();
    const dialog = await openGenerate(page);
    await dialog.getByLabel("Passphrase").fill("secret");
    await dialog.getByRole("button", { name: "Generate briefing" }).tap();
    await expect(
      dialog.getByRole("alert").filter({ hasText: "The run failed while writing" }),
    ).toBeVisible({ timeout: 12_000 });
    await expect(dialog.getByRole("link", { name: "View the run" })).toHaveAttribute(
      "href",
      /runs\/79/,
    );
    const failed = dialog.getByRole("list", { name: "Progress" }).getByRole("listitem").nth(3);
    await expect(failed).toContainText("Failed");
    await dialog.getByRole("button", { name: "Try again" }).tap();
    await expect(dialog.getByLabel("Passphrase")).toBeVisible();
  });

  test("keeps a run going when the sheet closes and resumes it on reopen", async ({
    lab,
    page,
  }) => {
    await page.route("**/api/generate", (route) =>
      reply(route, 202, { run_id: 80, started_at: "2026-01-14T07:13:00Z" }),
    );
    const status = await scriptStatus(page, [{ run_id: 80, state: "running", step: "judging" }]);
    await lab.open();
    const dialog = await openGenerate(page);
    await dialog.getByLabel("Passphrase").fill("secret");
    await dialog.getByRole("button", { name: "Generate briefing" }).tap();
    await expect(
      dialog.getByRole("list", { name: "Progress" }).getByRole("listitem").nth(2),
    ).toContainText("In progress", {
      timeout: 10_000,
    });
    expect(await page.evaluate(() => sessionStorage.getItem("dispatch:generate:run"))).toContain(
      '"runId":80',
    );
    await dialog.getByRole("button", { name: "Close", exact: true }).first().tap();
    await expect(dialog).toBeHidden();
    const whileClosed = status.calls();
    await page.waitForTimeout(4_500);
    // Closed, the check slows from every 3 seconds to every 15.
    expect(status.calls()).toBe(whileClosed);
    const reopened = await openGenerate(page);
    await expect(
      reopened.getByRole("list", { name: "Progress" }).getByRole("listitem").nth(2),
    ).toContainText("In progress");
    await expect.poll(() => status.calls()).toBeGreaterThan(whileClosed);
  });

  test("shows a toast when a run finishes while the sheet is closed", async ({ lab, page }) => {
    await page.route("**/api/generate", (route) =>
      reply(route, 202, { run_id: 81, started_at: "2026-01-14T07:13:00Z" }),
    );
    await scriptStatus(page, [
      { run_id: 81, state: "running", step: "reading" },
      {
        run_id: 81,
        state: "completed",
        step: "publishing",
        outcome: "published",
        digest_id: "2026-01-16",
      },
    ]);
    await lab.open();
    // A short background cadence for the test: the store reads its timers from the page clock.
    await page.clock.install();
    const dialog = await openGenerate(page);
    await dialog.getByLabel("Passphrase").fill("secret");
    await dialog.getByRole("button", { name: "Generate briefing" }).tap();
    await page.clock.runFor(3_100);
    await dialog.getByRole("button", { name: "Close", exact: true }).first().tap();
    await page.clock.runFor(16_000);
    const toast = page.locator(".toast");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("Briefing ready");
    await toast.getByRole("button", { name: "Open" }).tap();
    await expect(page).toHaveURL(/\/d\/2026-01-16/);
  });
});
