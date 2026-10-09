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
  op: Record<string, unknown> | Record<string, unknown>[];
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
  await page.goto("/settings/daily");
  await expect(page.locator("[data-manage]")).toHaveAttribute("data-loaded", "");
}

const bar = (page: Page) => page.locator("[data-bar]");
const barText = (page: Page) => bar(page).locator("[data-bar-text]");
const radio = (page: Page, name: RegExp | string) => page.getByRole("radio", { name });

async function save(page: Page, passphrase = "correct horse"): Promise<void> {
  await bar(page).getByRole("button", { name: "Save" }).click();
  if (!PASSPHRASE_REQUIRED) return;
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Passphrase").fill(passphrase);
  await dialog.getByRole("button", { name: "Continue" }).click();
}

test.describe("daily podcast", () => {
  test("is reached from the one row on Settings", async ({ page }) => {
    await page.goto("/settings");
    const row = page.getByRole("link", { name: /^Daily podcast/ });
    await expect(row).toContainText("07:00, every second day, Readout, 10 min");
    await row.click();
    await expect(page.getByRole("heading", { level: 1, name: "Daily podcast" })).toBeVisible();
    await expect(page).toHaveTitle("Daily podcast, Singularity");
    await expect(page.locator("main").getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  test("shows the saved values, the model, the next briefing and two links", async ({ page }) => {
    await open(page);
    // Nothing is saved in the fixtures, so the defaults show.
    await expect(page.getByLabel("Time")).toHaveValue("7");
    await expect(page.getByLabel("Time").locator("option:checked")).toHaveText("07:00");
    await expect(page.getByText("Stockholm time")).toBeVisible();
    await expect(page.getByLabel("How often")).toHaveValue("2");
    await expect(page.getByRole("radio", { name: "Readout" })).toBeChecked();
    await expect(page.getByRole("radio", { name: "10 min" })).toBeChecked();
    await expect(radio(page, /^Automatic/)).toBeChecked();
    await expect(page.locator("[data-next]")).toHaveText(
      /^Next briefing: about (today|tomorrow|[A-Z][a-z]+day) at 07:00$/,
    );
    await expect(page.getByRole("link", { name: /^Topics/ })).toHaveAttribute(
      "href",
      "/settings/topics",
    );
    await expect(page.getByRole("link", { name: /^Sources/ })).toHaveAttribute(
      "href",
      "/settings/sources",
    );
  });

  test("has 44px targets", async ({ page }) => {
    await open(page);
    for (const target of [
      page.getByLabel("Time"),
      page.getByLabel("How often"),
      page.getByRole("link", { name: /^Topics/ }),
      page.locator("label.manage-pick").first(),
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
    await page.getByRole("radio", { name: "Headlines" }).check();
    await expect(barText(page)).toHaveText("1 change");
    await page.getByRole("radio", { name: "Readout" }).check();
    await expect(bar(page)).toBeHidden();
  });

  test("Save sends one schedule.set with the time, rhythm, type and length (202)", async ({
    page,
  }) => {
    const sent = await mockConfig(page);
    await open(page);
    await page.getByLabel("Time").selectOption("9");
    await page.getByLabel("How often").selectOption("1");
    await page.getByRole("radio", { name: "Discussion" }).check();
    await page.getByRole("radio", { name: "15 min" }).check();
    await save(page);
    await expect(barText(page)).toContainText(
      "Saved. The changes appear after the next build, in about a minute.",
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.op).toEqual({
      op: "schedule.set",
      hour: 9,
      cadence_days: 1,
      sections: null,
      format: "discussion",
      length_minutes: 15,
    });
    // Saved is the new starting point: putting the time back is a change again.
    await bar(page).getByRole("button", { name: "Dismiss" }).click();
    await page.getByLabel("Time").selectOption("7");
    await expect(barText(page)).toHaveText("1 change");
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

  test("lists Automatic and the live models, with Automatic chosen", async ({ page }) => {
    await open(page);
    await expect(radio(page, /^Automatic/)).toBeChecked();
    await expect(page.locator("input[name=model]")).toHaveCount(4);
    const llama = radio(page, /^Llama-3\.3-70B-Instruct/);
    await expect(llama).not.toBeChecked();
    await expect(
      page.locator("label.manage-pick", { hasText: "Llama-3.3-70B-Instruct" }),
    ).toContainText("meta-llama, 128k context");
    await expect(bar(page)).toBeHidden();
  });

  test("the filter narrows the list and announces the count", async ({ page }) => {
    await open(page);
    await page.getByLabel("Filter models").fill("QWEN");
    await expect(page.locator("input[name=model]:visible")).toHaveCount(2);
    await expect(radio(page, /^Qwen3-235B/)).toBeVisible();
    await expect(page.locator("[data-count]")).toHaveText("1 model");
    await page.getByLabel("Filter models").fill("zzz");
    await expect(page.locator("[data-count]")).toHaveText("No models match");
    await page.getByLabel("Filter models").fill("");
    await expect(page.locator("input[name=model]:visible")).toHaveCount(4);
  });

  test("choosing a model and a length saves both in one request", async ({ page }) => {
    const sent = await mockConfig(page);
    await open(page);
    await radio(page, /^Llama-3\.3-70B-Instruct/).check();
    await expect(barText(page)).toHaveText("1 change");
    await page.getByRole("radio", { name: "5 min" }).check();
    await expect(barText(page)).toHaveText("2 changes");
    await save(page);
    await expect(barText(page)).toContainText("Saved.");
    const ops = sent.flatMap((request) => (Array.isArray(request.op) ? request.op : [request.op]));
    expect(ops).toContainEqual({
      op: "writer.set",
      provider: "nebius",
      model: "meta-llama/Llama-3.3-70B-Instruct",
    });
    expect(ops).toContainEqual(expect.objectContaining({ op: "schedule.set", length_minutes: 5 }));
    // Saved is the new starting point: going back to Automatic is a change again.
    await bar(page).getByRole("button", { name: "Dismiss" }).click();
    await radio(page, /^Automatic/).check();
    await expect(barText(page)).toHaveText("1 change");
  });

  test("going back to the saved model drops the change", async ({ page }) => {
    await open(page);
    await radio(page, /^Qwen3-235B/).check();
    await expect(bar(page)).toBeVisible();
    await radio(page, /^Automatic/).check();
    await expect(bar(page)).toBeHidden();
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

    test("without the model list there is Automatic and a field for a model id", async ({
      page,
    }) => {
      await page.route("**/api/models", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "unavailable" }),
        }),
      );
      const sent = await mockConfig(page);
      await open(page);
      await expect(page.getByText("The model list is not available right now.")).toBeVisible();
      await expect(page.locator("input[name=model]")).toHaveCount(1);
      await expect(radio(page, /^Automatic/)).toBeChecked();

      const typed = page.getByLabel("Model id");
      await typed.fill("not valid!");
      await expect(typed).toHaveAttribute("aria-invalid", "");
      await expect(bar(page)).toBeHidden();

      await typed.fill("acme/Fast-1:beta");
      await expect(barText(page)).toHaveText("1 change");
      await save(page);
      await expect(barText(page)).toContainText("Saved.");
      expect(sent[0]?.op).toEqual({
        op: "writer.set",
        provider: "nebius",
        model: "acme/Fast-1:beta",
      });
    });
  });

  test("read with scripts off", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/settings/daily");
    await expect(page.getByLabel("Time")).toHaveValue("7");
    await expect(
      page.locator("p.manage-note", { hasText: "Changing the daily podcast needs JavaScript" }),
    ).toBeVisible();
    await context.close();
  });
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`axe, ${scheme} scheme`, () => {
    test("daily podcast has no WCAG 2.2 AA violations", async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      await page.evaluate(() => document.fonts.ready);
      expect(await violations(page)).toEqual([]);
    });

    test("daily podcast has none with the pending bar open", async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      await page.getByLabel("Time").selectOption("9");
      await expect(bar(page)).toBeVisible();
      await page.waitForTimeout(400);
      expect(await violations(page)).toEqual([]);
    });
  });
}
