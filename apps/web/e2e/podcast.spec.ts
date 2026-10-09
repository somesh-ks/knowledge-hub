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
  await page.goto("/settings/podcast");
  await expect(page.locator("[data-manage]")).toHaveAttribute("data-loaded", "");
  // The voices fill in after the page is up; a test that reads them waits for this.
  await expect(page.locator("[data-manage]")).toHaveAttribute("data-voices", "");
}

/** The rows of one profile. Its fields are named by it, so the three never share an id. */
const profile = (page: Page, id: "daily" | "weekly" | "custom") =>
  page.locator(`[data-profile=${id}]`);

/** Opens a profile with the switch at the top of the page. */
async function show(page: Page, name: "Daily" | "Weekly" | "Custom"): Promise<void> {
  await page.getByRole("radiogroup", { name: "Podcast" }).getByRole("radio", { name }).check();
}

const bar = (page: Page) => page.locator("[data-bar]");
const barText = (page: Page) => bar(page).locator("[data-bar-text]");
const combo = (page: Page) => page.getByRole("combobox", { name: "Model" });
const options = (page: Page, name?: RegExp) =>
  page.getByRole("listbox", { name: "Models" }).getByRole("option", name ? { name } : undefined);

/** Types a query into the model field and picks the option that matches. */
async function pick(page: Page, query: string, name: RegExp): Promise<void> {
  await combo(page).fill(query);
  await options(page, name).click();
}

async function save(page: Page, passphrase = "correct horse"): Promise<void> {
  await bar(page).getByRole("button", { name: "Save" }).click();
  if (!PASSPHRASE_REQUIRED) return;
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Passphrase").fill(passphrase);
  await dialog.getByRole("button", { name: "Continue" }).click();
}

test.describe("podcast settings", () => {
  test("is reached from the one row on Settings", async ({ page }) => {
    await page.goto("/settings");
    const row = page.getByRole("link", { name: /^Podcast/ });
    await expect(row).toContainText("Daily 07:00 \u00b7 Weekly Sun \u00b7 Readout");
    await row.click();
    await expect(page.getByRole("heading", { level: 1, name: "Podcast" })).toBeVisible();
    await expect(page).toHaveTitle("Podcast, Singularity");
    await expect(page.locator("main").getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  test("old routes land on the one page", async ({ page }) => {
    for (const old of ["/settings/daily", "/settings/schedule", "/settings/model"]) {
      await page.goto(old);
      await expect(page).toHaveURL(/\/settings\/podcast$/);
      await expect(page.getByRole("heading", { level: 1, name: "Podcast" })).toBeVisible();
    }
  });

  test("shows the saved Daily values, the model, the next briefing and the tabs", async ({
    page,
  }) => {
    await open(page);
    const daily = profile(page, "daily");
    // Nothing is saved in the fixtures, so the defaults show.
    await expect(page.locator("#daily-hour")).toHaveValue("7");
    await expect(page.locator("#daily-hour option:checked")).toHaveText("07:00");
    await expect(daily.getByText("Stockholm time")).toBeVisible();
    await expect(page.locator("#daily-cadence")).toHaveValue("2");
    await expect(daily.getByRole("radio", { name: "Readout" })).toBeChecked();
    await expect(daily.getByRole("radio", { name: "10 min", exact: true })).toBeChecked();
    await expect(combo(page)).toHaveValue("Automatic");
    await expect(daily.locator("[data-next]")).toHaveText(
      /^Next briefing: about (today|tomorrow|[A-Z][a-z]+day) at 07:00$/,
    );
    const tabs = page.getByRole("navigation", { name: "Podcast settings" });
    await expect(tabs.getByRole("link", { name: "General" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(tabs.getByRole("link", { name: "Topics & sources" })).toHaveAttribute(
      "href",
      "/settings/podcast/topics",
    );
    // Headlines is no longer offered.
    await expect(page.getByRole("radio", { name: "Headlines" })).toHaveCount(0);
  });

  test("the switch swaps the fields of Daily, Weekly and Custom", async ({ page }) => {
    await open(page);
    await expect(profile(page, "daily")).toBeVisible();
    await expect(profile(page, "weekly")).toBeHidden();
    await show(page, "Weekly");
    await expect(profile(page, "daily")).toBeHidden();
    await expect(page.getByRole("switch", { name: "Weekly podcast" })).toBeChecked();
    await expect(page.locator("#weekly-day")).toHaveValue("0");
    await expect(page.locator("#weekly-hour")).toHaveValue("7");
    await expect(profile(page, "weekly").locator("[data-next]")).toHaveText(
      /^Next weekly: about (today|tomorrow|Sunday) at 07:00$/,
    );
    await show(page, "Custom");
    await expect(
      profile(page, "custom").getByText("What the Create panel starts from."),
    ).toBeVisible();
    await expect(profile(page, "custom").getByText("Stockholm time")).toHaveCount(0);
    await expect(
      profile(page, "custom").getByRole("radio", { name: "5 min", exact: true }),
    ).toBeChecked();
    // Switching profiles is not a change.
    await expect(bar(page)).toBeHidden();
  });

  test("Readout has one voice select, Discussion two, filled from the voice list", async ({
    page,
  }) => {
    await open(page);
    const daily = profile(page, "daily");
    await expect(daily.getByLabel("Voice (Ada)")).toBeVisible();
    await expect(daily.getByLabel("Voice (Ada)").locator("option")).toHaveText([
      "Default",
      "Ada, female",
      "Leo, male",
      "Nora, female",
    ]);
    await expect(daily.locator("[data-voice-row=voice_b]")).toBeHidden();
    await daily.getByRole("radio", { name: "Discussion" }).check();
    await expect(daily.getByText("Ada", { exact: true })).toBeVisible();
    await expect(daily.getByText("Leo", { exact: true })).toBeVisible();
    await expect(daily.locator("#daily-voice_b")).toBeVisible();
    await daily.getByRole("radio", { name: "Readout" }).check();
    await expect(daily.locator("[data-voice-row=voice_b]")).toBeHidden();
  });

  test("a voice with a sample gets a play button", async ({ page }) => {
    await open(page);
    const daily = profile(page, "daily");
    const play = daily.locator("[data-voice-row=voice] [data-preview]");
    await expect(play).toBeHidden();
    await daily.locator("#daily-voice").selectOption("voice-ada");
    await expect(play).toBeVisible();
    await daily.locator("#daily-voice").selectOption("voice-leo");
    await expect(play).toBeHidden();
  });

  test("Weekly and Custom changes go in one schedule.set, each in its own profile", async ({
    page,
  }) => {
    const sent = await mockConfig(page);
    await open(page);
    await show(page, "Weekly");
    await page.locator("#weekly-day").selectOption("5");
    await page.getByRole("switch", { name: "Weekly podcast" }).uncheck();
    await show(page, "Custom");
    await profile(page, "custom").getByRole("radio", { name: "Discussion" }).check();
    await page.locator("#custom-voice").selectOption("voice-ada");
    await page.locator("#custom-voice_b").selectOption("voice-leo");
    await expect(barText(page)).toHaveText("1 change");
    await save(page);
    await expect(barText(page)).toContainText("Saved.");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.op).toEqual({
      op: "schedule.set",
      weekly: { enabled: false, day: 5 },
      custom: { format: "discussion", voice_id: "voice-ada", voice_id_b: "voice-leo" },
    });
  });

  test("has 44px targets", async ({ page }) => {
    await open(page);
    for (const target of [
      page.locator("#daily-hour"),
      page.locator("#daily-cadence"),
      page.locator("#daily-voice"),
      combo(page),
      page.getByLabel("Provider"),
    ]) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test("a change queues, and moving it back drops it", async ({ page }) => {
    await open(page);
    await expect(bar(page)).toBeHidden();
    await page.locator("#daily-hour").selectOption("9");
    await expect(bar(page)).toBeVisible();
    await expect(barText(page)).toHaveText("1 change");
    await page.locator("#daily-hour").selectOption("7");
    await expect(bar(page)).toBeHidden();
    await profile(page, "daily").getByRole("radio", { name: "Discussion" }).check();
    await expect(barText(page)).toHaveText("1 change");
    await profile(page, "daily").getByRole("radio", { name: "Readout" }).check();
    await expect(bar(page)).toBeHidden();
  });

  test("Save sends one schedule.set with only what changed (202)", async ({ page }) => {
    const sent = await mockConfig(page);
    await open(page);
    await page.locator("#daily-hour").selectOption("9");
    await page.locator("#daily-cadence").selectOption("1");
    await profile(page, "daily").getByRole("radio", { name: "Discussion" }).check();
    await profile(page, "daily").getByRole("radio", { name: "15 min" }).check();
    await save(page);
    await expect(barText(page)).toContainText(
      "Saved. The changes appear after the next build, in about a minute.",
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.op).toEqual({
      op: "schedule.set",
      hour: 9,
      cadence_days: 1,
      format: "discussion",
      length_minutes: 15,
    });
    // Saved is the new starting point: putting the time back is a change again.
    await bar(page).getByRole("button", { name: "Dismiss" }).click();
    await page.locator("#daily-hour").selectOption("7");
    await expect(barText(page)).toHaveText("1 change");
  });

  test("says the time could not be changed when the token may not write variables", async ({
    page,
  }) => {
    await mockConfig(page, [
      { status: 202, body: { status: 202, run_id: 1, time_changed: false } },
    ]);
    await open(page);
    await page.locator("#daily-hour").selectOption("9");
    await save(page);
    await expect(barText(page)).toHaveText(
      "The topics and cadence are saved. The time could not be changed: the site's GitHub token needs permission to write repository variables.",
    );
  });

  test("lists Automatic and the live models in the combobox, with Automatic chosen", async ({
    page,
  }) => {
    await open(page);
    await expect(combo(page)).toHaveValue("Automatic");
    await expect(page.getByLabel("Provider")).toHaveValue("nebius");
    await combo(page).click();
    await page.getByRole("button", { name: "Show all models" }).click();
    await expect(options(page)).toHaveCount(4);
    await expect(options(page, /^Llama-3\.3-70B-Instruct/)).toContainText(
      "meta-llama, 128k context",
    );
    await expect(bar(page)).toBeHidden();
  });

  test("typing filters the list and announces the count", async ({ page }) => {
    await open(page);
    await combo(page).fill("QWEN");
    await expect(options(page)).toHaveCount(1);
    await expect(options(page, /^Qwen3-235B/)).toBeVisible();
    await expect(page.locator("[data-count]")).toHaveText("1 model");
    await combo(page).fill("zzz");
    await expect(options(page)).toHaveCount(0);
    await expect(page.locator("[data-count]")).toHaveText("No models match");
  });

  test("the keyboard moves, picks and closes", async ({ page }) => {
    await open(page);
    await combo(page).focus();
    await page.keyboard.press("ArrowDown");
    await expect(combo(page)).toHaveAttribute("aria-expanded", "true");
    await combo(page).fill("llama");
    await page.keyboard.press("Enter");
    await expect(combo(page)).toHaveValue("Llama-3.3-70B-Instruct");
    await expect(combo(page)).toHaveAttribute("aria-expanded", "false");
    await expect(barText(page)).toHaveText("1 change");
    // Escape closes without choosing, and the field goes back to the chosen name.
    await combo(page).fill("qw");
    await expect(options(page)).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(combo(page)).toHaveValue("Llama-3.3-70B-Instruct");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(combo(page)).not.toHaveValue("Llama-3.3-70B-Instruct");
  });

  test("a long list shows the recommended models first, then the rest", async ({ page }) => {
    const models = [
      ["deepseek-ai/DeepSeek-V3.2", 163840],
      ["Qwen/Qwen3-235B-A22B-Instruct-2507", 262144],
      ["moonshotai/Kimi-K2-Instruct", 131072],
      ["openai/gpt-oss-120b", 131072],
      ["zai-org/GLM-4.5", 131072],
      ["meta-llama/Meta-Llama-3.1-8B-Instruct", 131072],
      ["Qwen/Qwen2.5-VL-72B-Instruct", 32768],
    ].map(([id, context_length]) => ({ id, context_length }));
    await page.route("**/api/models", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ provider: "nebius", models }),
      }),
    );
    await open(page);
    await page.getByRole("button", { name: "Show all models" }).click();
    // Automatic, five recommended and two others, with a caption over each group.
    await expect(options(page)).toHaveCount(8);
    await expect(page.getByText("Recommended", { exact: true })).toBeVisible();
    await expect(page.getByText("All models", { exact: true })).toBeVisible();
    await combo(page).fill("llama");
    await expect(page.locator("[data-count]")).toHaveText("1 model");
  });

  test("choosing a model and a length saves both in one request", async ({ page }) => {
    const sent = await mockConfig(page);
    await open(page);
    await pick(page, "llama", /^Llama-3\.3-70B-Instruct/);
    await expect(barText(page)).toHaveText("1 change");
    await profile(page, "daily").getByRole("radio", { name: "5 min", exact: true }).check();
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
    await pick(page, "auto", /^Automatic/);
    await expect(barText(page)).toHaveText("1 change");
  });

  test("Anthropic offers the two Claude models, without asking for the live list", async ({
    page,
  }) => {
    const sent = await mockConfig(page);
    await open(page);
    let asked = 0;
    await page.route("**/api/models", (route) => {
      asked += 1;
      return route.abort();
    });
    await page.getByLabel("Provider").selectOption("anthropic");
    await expect(combo(page)).toHaveValue("Claude Sonnet 5.5");
    await combo(page).click();
    await page.getByRole("button", { name: "Show all models" }).click();
    await expect(options(page)).toHaveCount(2);
    await expect(options(page, /^Claude Haiku 5\.5/)).toBeVisible();
    expect(asked).toBe(0);
    await page.keyboard.press("Escape");
    await pick(page, "haiku", /^Claude Haiku 5\.5/);
    await save(page);
    await expect(barText(page)).toContainText("Saved.");
    const ops = sent.flatMap((request) => (Array.isArray(request.op) ? request.op : [request.op]));
    expect(ops).toContainEqual({
      op: "writer.set",
      provider: "anthropic",
      model: "claude-haiku-5-5",
    });
  });

  test("going back to the saved provider and model drops the change", async ({ page }) => {
    await open(page);
    await page.getByLabel("Provider").selectOption("anthropic");
    await expect(bar(page)).toBeVisible();
    await page.getByLabel("Provider").selectOption("nebius");
    await expect(combo(page)).toHaveValue("Automatic");
    await expect(bar(page)).toBeHidden();
  });

  test("the open model list has equal padding above and below and stays on screen", async ({
    page,
  }) => {
    await open(page);
    await combo(page).focus();
    await page.keyboard.press("ArrowDown");
    const list = page.getByRole("listbox", { name: "Models" });
    await expect(list).toBeVisible();
    const gaps = await list.evaluate((element) => {
      const panel = element.getBoundingClientRect();
      const rows = [...element.querySelectorAll("li")].map((row) => row.getBoundingClientRect());
      const first = rows[0] as DOMRect;
      const last = rows[rows.length - 1] as DOMRect;
      const style = getComputedStyle(element);
      return {
        padTop: Number.parseFloat(style.paddingTop),
        padBottom: Number.parseFloat(style.paddingBottom),
        top: first.top - panel.top,
        bottom: panel.bottom - last.bottom,
        scrolls: element.scrollHeight > element.clientHeight,
        inside: panel.top >= 0 && panel.bottom <= window.innerHeight,
      };
    });
    expect(Math.abs(gaps.padTop - gaps.padBottom)).toBeLessThanOrEqual(1);
    // Scrolled to the top, the first row sits a padding under the panel's edge (the border adds one).
    if (!gaps.scrolls) expect(Math.abs(gaps.top - gaps.bottom)).toBeLessThanOrEqual(2);
    expect(gaps.inside).toBe(true);
  });

  test.describe("offline", () => {
    test.use({ allowNetworkErrors: true });

    test("an unreachable site is said plainly", async ({ page }) => {
      await page.route("**/api/config", (route) => route.abort("connectionrefused"));
      await open(page);
      await page.locator("#daily-hour").selectOption("9");
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
      await expect(combo(page)).toHaveValue("Automatic");

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
    await page.goto("/settings/podcast");
    await expect(page.locator("#daily-hour")).toHaveValue("7");
    await expect(
      page.locator("p.manage-note", { hasText: "Changing the podcast needs JavaScript" }),
    ).toBeVisible();
    await context.close();
  });
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`axe, ${scheme} scheme`, () => {
    test("podcast settings have no WCAG 2.2 AA violations", async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      await page.evaluate(() => document.fonts.ready);
      expect(await violations(page)).toEqual([]);
    });

    test("podcast settings have none with the pending bar open", async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      await page.locator("#daily-hour").selectOption("9");
      await expect(bar(page)).toBeVisible();
      await page.waitForTimeout(400);
      expect(await violations(page)).toEqual([]);
    });
  });
}
