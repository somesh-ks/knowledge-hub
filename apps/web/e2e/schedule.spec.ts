import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures";
import { PASSPHRASE_REQUIRED } from "./passphrase";

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

interface Sent {
  passphrase: string;
  op: Record<string, unknown>;
}

/** Answers /api/config and records what was sent. `answers` are used in order, then 202. */
async function mockConfig(page: Page, answers: Array<{ status: number; body: object }> = []) {
  const sent: Sent[] = [];
  await page.route("**/api/config", async (route: Route) => {
    sent.push(route.request().postDataJSON() as Sent);
    const answer = answers.shift() ?? { status: 202, body: { status: 202, run_id: 1 } };
    await route.fulfill({
      status: answer.status,
      contentType: "application/json",
      body: JSON.stringify(answer.body),
    });
  });
  return sent;
}

async function open(page: Page): Promise<void> {
  await page.goto("/settings/schedule");
  await expect(page.locator("[data-manage]")).toHaveAttribute("data-ready", "");
}

const bar = (page: Page) => page.locator("[data-bar]");
const barText = (page: Page) => bar(page).locator("[data-bar-text]");

async function save(page: Page, passphrase = "correct horse"): Promise<void> {
  await bar(page).getByRole("button", { name: "Save" }).click();
  if (!PASSPHRASE_REQUIRED) return;
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Passphrase").fill(passphrase);
  await dialog.getByRole("button", { name: "Continue" }).click();
}

test.describe("schedule", () => {
  test("is reached from Settings", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("link", { name: /^Schedule/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Schedule" })).toBeVisible();
    await expect(page).toHaveTitle("Schedule, Singularity");
    await expect(page.locator("main").getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  test("shows the saved values, the topics on, and the next briefing", async ({ page }) => {
    await open(page);
    // Nothing is saved in the fixtures, so the defaults show.
    await expect(page.getByLabel("Time")).toHaveValue("7");
    await expect(page.getByLabel("Time").locator("option:checked")).toHaveText("07:00");
    await expect(page.getByText("Stockholm time")).toBeVisible();
    await expect(page.getByLabel("How often")).toHaveValue("2");
    await expect(page.getByLabel("How often").locator("option:checked")).toHaveText(
      "Every second day",
    );
    // Top picks is always in; a topic that is off has no row.
    await expect(page.getByRole("checkbox", { name: /^Top picks/ })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /^Top picks/ })).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: /^AI Products/ })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /^Audio interfaces/ })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /^Tech Product Launches/ })).toHaveCount(0);
    await expect(page.locator("[data-next]")).toHaveText(
      /^Next briefing: about (today|tomorrow|[A-Z][a-z]+day) at 07:00$/,
    );
    await expect(page.getByRole("link", { name: "Add a topic" })).toHaveAttribute(
      "href",
      "/settings/topics#add-topic",
    );
  });

  test("has 44px targets", async ({ page }) => {
    await open(page);
    for (const target of [
      page.getByLabel("Time"),
      page.getByLabel("How often"),
      page.getByRole("link", { name: "Add a topic" }),
      page.locator("label.manage-pick", { hasText: "AI Products" }),
    ]) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test("a change queues, and moving it back drops it", async ({ page }) => {
    await open(page);
    await expect(bar(page)).toBeHidden();
    await page.getByLabel("Time").selectOption("9");
    await expect(bar(page)).toBeVisible();
    await expect(barText(page)).toHaveText("1 change");
    await page.getByLabel("Time").selectOption("7");
    await expect(bar(page)).toBeHidden();
  });

  test("Save sends one schedule.set with the chosen hour, cadence and topics (202)", async ({
    page,
  }) => {
    const sent = await mockConfig(page);
    await open(page);
    await page.getByLabel("Time").selectOption("9");
    await page.getByLabel("How often").selectOption("1");
    await page.getByRole("checkbox", { name: /^Trending/ }).uncheck();
    await save(page);
    await expect(barText(page)).toContainText(
      "Saved. The changes appear after the next build, in about a minute.",
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.op).toEqual({
      op: "schedule.set",
      hour: 9,
      cadence_days: 1,
      sections: ["design", "ui-craft", "ai", "audio_interfaces"],
    });
    // Saved is the new starting point: putting the time back is a change again.
    await bar(page).getByRole("button", { name: "Dismiss" }).click();
    await page.getByLabel("Time").selectOption("7");
    await expect(barText(page)).toHaveText("1 change");
  });

  test("every topic ticked is sent as null, so a topic added later is covered", async ({
    page,
  }) => {
    const sent = await mockConfig(page);
    await open(page);
    await page.getByLabel("How often").selectOption("7");
    await save(page);
    await expect(barText(page)).toContainText("Saved.");
    expect(sent[0]?.op).toMatchObject({ op: "schedule.set", cadence_days: 7, sections: null });
  });

  test("says the time could not be changed when the token may not write variables", async ({
    page,
  }) => {
    await mockConfig(page, [
      { status: 202, body: { status: 202, run_id: 1, time_changed: false } },
    ]);
    await open(page);
    await page.getByLabel("Time").selectOption("9");
    await save(page);
    await expect(barText(page)).toHaveText(
      "The topics and cadence are saved. The time could not be changed: the site's GitHub token needs permission to write repository variables.",
    );
  });

  test("never sends a schedule with no topic ticked", async ({ page }) => {
    const sent = await mockConfig(page);
    await open(page);
    for (const name of [/^Design Engineering/, /^AI Products/, /^Trending/, /^Audio interfaces/]) {
      await page.getByRole("checkbox", { name }).uncheck();
    }
    await page.getByRole("checkbox", { name: /^Design(?! Engineering)/ }).uncheck();
    await expect(barText(page)).toHaveText("Pick at least one topic.");
    await expect(bar(page).getByRole("button", { name: "Save" })).toBeHidden();
    expect(sent).toHaveLength(0);
  });

  test.describe("offline", () => {
    test.use({ allowNetworkErrors: true });

    test("an unreachable site is said plainly", async ({ page }) => {
      await page.route("**/api/config", (route) => route.abort("connectionrefused"));
      await open(page);
      await page.getByLabel("Time").selectOption("9");
      await save(page);
      await expect(barText(page)).toHaveText(
        "The site could not be reached. Your changes are still waiting.",
      );
    });
  });

  test("read with scripts off", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/settings/schedule");
    await expect(page.getByLabel("Time")).toHaveValue("7");
    await expect(
      page.locator("p.manage-note", { hasText: "Changing the schedule needs JavaScript" }),
    ).toBeVisible();
    await context.close();
  });
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`axe, ${scheme} scheme`, () => {
    test("schedule has no WCAG 2.2 AA violations", async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      await page.evaluate(() => document.fonts.ready);
      expect(await violations(page)).toEqual([]);
    });

    test("schedule has none with the pending bar open", async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      await page.getByLabel("Time").selectOption("9");
      await expect(bar(page)).toBeVisible();
      await page.waitForTimeout(400);
      expect(await violations(page)).toEqual([]);
    });
  });
}
