import type { Page, Route } from "@playwright/test";
import { GAP_MS } from "../src/scripts/managePageSave";
import { expect, test } from "./fixtures";

/**
 * A change held by the server's ten seconds between edits, its page left, and the held request then
 * answered while another settings page is open. The page on screen stays quiet while it goes through,
 * and says when it failed, with Retry: never a change shown as saved that is going nowhere.
 */

const SAVED = "Saved.";
const NOT_SAVED_NOTE = "Not saved yet. It goes with your next change.";

interface Sent {
  op: Record<string, unknown> | Record<string, unknown>[];
}

/** Answers /api/config in order (a status, or "abort" for a connection lost), then 202. */
async function mockConfig(page: Page, answers: Array<number | "abort">) {
  const sent: Sent[] = [];
  await page.route("**/api/config", async (route: Route) => {
    sent.push(route.request().postDataJSON() as Sent);
    const answer = answers.shift() ?? 202;
    if (answer === "abort") return route.abort("internetdisconnected");
    await route.fulfill({
      status: answer,
      contentType: "application/json",
      body: JSON.stringify(answer === 202 ? { status: 202, run_id: 1 } : { status: answer }),
    });
  });
  return sent;
}

const ops = (sent: Sent[]) => sent.flatMap((request) => [request.op].flat());
const toastText = (page: Page) => page.locator("[data-bar] [data-bar-text]");
/** A save that went through shows no toast; a screen reader hears it. */
const spoken = (page: Page) => page.locator("[data-live]");
const note = (page: Page) => page.locator("[data-saved-note]");
const pendingStored = (page: Page) =>
  page.evaluate(() => (localStorage.getItem("dispatch:saved-edits") ?? "").includes('"pending"'));

/** Daily: Time saved, Length changed inside the gap, Back to Settings, and Daily opened again. */
async function holdDailyLength(page: Page): Promise<void> {
  await page.goto("/settings");
  await page.getByRole("link", { name: /^Daily/ }).click();
  await expect(page.locator("[data-manage]")).toHaveAttribute("data-voices", "");
  await page.locator("#daily-hour").selectOption("9");
  await expect(spoken(page)).toHaveText(SAVED);
  await page.locator("#daily-length").selectOption("3");
  await page.goBack();
  await expect(page).toHaveURL(/\/settings$/);
}

async function openDaily(page: Page): Promise<void> {
  await page.getByRole("link", { name: /^Daily/ }).click();
  await expect(page.locator("[data-manage]")).toHaveAttribute("data-voices", "");
}

test.describe("a change held in the server's gap when its page is left", () => {
  // The held request is refused or cut on purpose, which the browser logs.
  test.use({ allowNetworkErrors: true });

  for (const lost of [500, "abort"] as const) {
    test(`Daily says it was not saved when the held request ${lost === 500 ? "is refused" : "loses the connection"}, and Retry sends it once`, async ({
      page,
    }) => {
      await page.clock.install();
      const sent = await mockConfig(page, [202, lost]);
      await holdDailyLength(page);
      await openDaily(page);
      await expect(page.locator("#daily-length")).toHaveValue("3");
      await expect(note(page)).toBeHidden();
      // The held request fails: the page says so at once, in the toast and to a screen reader.
      await page.clock.runFor(GAP_MS);
      await expect.poll(() => sent.length).toBe(2);
      await expect(note(page)).toBeVisible();
      await expect(note(page)).toHaveText(NOT_SAVED_NOTE);
      const failure =
        lost === 500
          ? "The server crashed before it could answer. Not saved yet."
          : "Couldn't reach the site. Not saved yet.";
      await expect(toastText(page)).toHaveText(failure);
      await expect(page.locator("[data-alert]")).toHaveText(failure);
      expect(await pendingStored(page)).toBe(false);
      // Retry sends the held change, once, and the page says it is saved.
      await page.locator("[data-bar] [data-act=retry]").click();
      await page.clock.runFor(GAP_MS);
      await expect.poll(() => sent.length).toBe(3);
      expect(ops(sent).at(-1)).toEqual({ op: "schedule.set", length_minutes: 3 });
      await expect(spoken(page)).toHaveText(SAVED);
      await expect(note(page)).toBeHidden();
      await expect(toastText(page)).toBeHidden();
      await page.clock.runFor(GAP_MS);
      expect(sent).toHaveLength(3);
      // A reload agrees: both changes are saved.
      await page.reload();
      await expect(page.locator("[data-manage]")).toHaveAttribute("data-voices", "");
      await expect(page.locator("#daily-hour")).toHaveValue("9");
      await expect(page.locator("#daily-length")).toHaveValue("3");
    });
  }

  test("a refused held change is not shown as saved after a reload", async ({ page }) => {
    await page.clock.install();
    const sent = await mockConfig(page, [202, 500]);
    await holdDailyLength(page);
    await openDaily(page);
    await page.clock.runFor(GAP_MS);
    await expect.poll(() => sent.length).toBe(2);
    await expect(note(page)).toBeVisible();
    await page.reload();
    await expect(page.locator("[data-manage]")).toHaveAttribute("data-voices", "");
    await expect(page.locator("#daily-length")).not.toHaveValue("3");
    await expect(note(page)).toHaveCount(0);
  });

  test("Daily stays quiet when the held request goes through", async ({ page }) => {
    await page.clock.install();
    const sent = await mockConfig(page, []);
    await holdDailyLength(page);
    await openDaily(page);
    await page.clock.runFor(GAP_MS);
    await expect.poll(() => sent.length).toBe(2);
    await expect(note(page)).toBeHidden();
    await expect(toastText(page)).toBeHidden();
    await expect(page.locator("#daily-length")).toHaveValue("3");
    expect(await pendingStored(page)).toBe(false);
  });

  test("the Settings index row goes back, and says so, when the held change fails", async ({
    page,
  }) => {
    await page.clock.install();
    const sent = await mockConfig(page, [202, 500]);
    await page.goto("/settings");
    await openDaily(page);
    await page.locator("#daily-hour").selectOption("9");
    await expect(spoken(page)).toHaveText(SAVED);
    await page.locator("#daily-cadence").selectOption("1");
    await page.goBack();
    const row = page.getByRole("link", { name: /^Daily/ });
    await expect(row).toContainText("Every day at 9");
    await page.clock.runFor(GAP_MS);
    await expect.poll(() => sent.length).toBe(2);
    await expect(row).not.toContainText("Every day");
    await expect(row).toContainText("at 9");
    await expect(page.getByRole("alert").filter({ hasText: "not saved" })).toHaveText(
      "Your last change was not saved.",
    );
    const shown = await row.textContent();
    await page.reload();
    await expect(page.getByRole("link", { name: /^Daily/ })).toHaveText(shown ?? "");
  });

  test("a topic's page says it was not saved, and Retry sends it once", async ({ page }) => {
    await page.clock.install();
    const sent = await mockConfig(page, [202, 500]);
    await page.goto("/settings/topics");
    await page.locator('a.row-action[href="/settings/topics/design"]').click();
    const root = page.locator("[data-topics]");
    await expect(root).toHaveAttribute("data-ready", "");
    await page.getByRole("checkbox", { name: "Read Studio Notes" }).uncheck();
    await expect(spoken(page)).toHaveText(SAVED);
    await page.getByRole("checkbox", { name: "Read Type and Grid" }).uncheck();
    await page.goBack();
    await expect(page).toHaveURL(/\/settings\/topics$/);
    await page.locator('a.row-action[href="/settings/topics/design"]').click();
    await expect(page).toHaveURL(/\/design$/);
    await expect(page.getByRole("checkbox", { name: "Read Type and Grid" })).not.toBeChecked();
    await expect(note(page)).toBeHidden();
    await page.clock.runFor(GAP_MS);
    await expect.poll(() => sent.length).toBe(2);
    await expect(note(page)).toBeVisible();
    await expect(toastText(page)).toHaveText(
      "The server crashed before it could answer. Not saved yet.",
    );
    await page.locator("[data-bar] [data-act=retry]").click();
    await page.clock.runFor(GAP_MS);
    await expect.poll(() => sent.length).toBe(3);
    expect(ops(sent).at(-1)).toEqual({ op: "source.set", id: "type-and-grid", enabled: false });
    await expect(note(page)).toBeHidden();
    await page.clock.runFor(GAP_MS);
    expect(sent).toHaveLength(3);
  });
});
