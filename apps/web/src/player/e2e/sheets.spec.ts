import type { Page, Route } from "@playwright/test";
import { expect, test } from "./lab";
import { enterPassphrase, PASSPHRASE_ON, PASSPHRASE_REQUIRED } from "./passphrase";

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
  const dialog = page.getByRole("dialog", { name: "New briefing" });
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
    const generate = page.getByRole("dialog", { name: "New briefing" });
    await generate.getByRole("button", { name: "Generate briefing" }).click();
    await expect(generate.getByRole("alert")).toBeVisible();
  });
});

test.describe("the Generate sheet", () => {
  test("with the passphrase step off, asks for nothing and sends the run request", async ({
    lab,
    page,
  }) => {
    test.skip(PASSPHRASE_REQUIRED, PASSPHRASE_ON);
    let sent: unknown = null;
    await page.route("**/api/generate", (route) => {
      sent = route.request().postDataJSON();
      return reply(route, 503, { error: "unavailable" });
    });
    await lab.open();
    const dialog = await openGenerate(page);
    await expect(dialog.getByLabel("Passphrase")).toHaveCount(0);
    await expect(dialog.getByText(/passphrase/i)).toHaveCount(0);
    await dialog.getByRole("button", { name: "Generate briefing" }).tap();
    // The one error left to show still has a place, without a field to sit under.
    await expect(dialog.getByRole("alert")).toContainText("not available right now");
    expect(sent).toEqual({ passphrase: "open" });
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
    await enterPassphrase(dialog);
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
    await enterPassphrase(dialog);
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
    // Back to the form: the field while a passphrase is asked for, the button either way.
    if (PASSPHRASE_REQUIRED) await expect(dialog.getByLabel("Passphrase")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Generate briefing" })).toBeVisible();
  });
});
