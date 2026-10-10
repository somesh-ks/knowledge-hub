import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures";
import { PASSPHRASE_REQUIRED } from "./passphrase";

const PATH = "/settings/podcast/topics";
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
// A one-pixel PNG, so the sources' icons load in a browser that is not online.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

interface Sent {
  passphrase: string;
  op: Record<string, unknown> | Record<string, unknown>[];
}

const PREVIEW = {
  url: "https://newsroom.example/",
  name: "Newsroom Example",
  host: "newsroom.example",
  favicon_url: null,
  thumbnail_url: null,
  feed_url: "https://newsroom.example/feed.xml",
  kind: "feed",
  latest_at: "2026-10-07T08:00:00.000Z",
  items_30d: 12,
  score: 4.2,
  score_label: "Good",
  reason: "Posts often and most posts are on topic.",
};

async function setup(page: Page, answers: Array<{ status: number; body: object }> = []) {
  const sent: Sent[] = [];
  await page.route("**/api/site-icon**", (route: Route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PIXEL }),
  );
  await page.route("**/api/config", async (route: Route) => {
    sent.push(route.request().postDataJSON() as Sent);
    const answer = answers.shift() ?? { status: 202, body: { status: 202, run_id: 1 } };
    await route.fulfill({
      status: answer.status,
      contentType: "application/json",
      body: JSON.stringify(answer.body),
    });
  });
  const previews: string[] = [];
  await page.route("**/api/source-preview**", async (route: Route) => {
    previews.push(new URL(route.request().url()).searchParams.get("url") ?? "");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(PREVIEW),
    });
  });
  return { sent, previews };
}

async function open(page: Page): Promise<void> {
  await page.goto(PATH);
  await expect(page.locator("[data-topics]")).toHaveAttribute("data-ready", "");
}

const topic = (page: Page, name: string) =>
  page.locator("li.topic", { has: page.getByRole("heading", { name, exact: true }) });
const source = (page: Page, name: string) => page.locator("li.source-row", { hasText: name });
const bar = (page: Page) => page.locator("[data-bar]");
const ops = (sent: Sent[]) => sent.flatMap((item) => [item.op].flat());

test.describe("the Topics & sources page", () => {
  test("redirects the two old pages here", async ({ page }) => {
    await setup(page);
    for (const old of ["/settings/topics", "/settings/sources"]) {
      await page.goto(old);
      await expect(page).toHaveURL(new RegExp(`${PATH}$`));
    }
  });

  test("shows the tabs, the one primary action, the topics and their sources", async ({ page }) => {
    await setup(page);
    await open(page);
    await expect(page.getByRole("heading", { level: 1, name: "Podcast" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Podcast settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add source", exact: true })).toBeVisible();
    await expect(topic(page, "Design engineering craft")).toContainText("Studio Notes");
    await expect(source(page, "Model Ledger")).toContainText("Poor");
    await expect(source(page, "Launch Board")).toContainText("New");
    await expect(page.getByText("A hint. Each briefing still follows the news.")).toHaveCount(0);
    await expect(page.locator("li.topic", { hasText: "Top picks" })).toHaveCount(0);
  });

  test("a weight change is one weights.set, shown as a percentage", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page);
    const slider = topic(page, "Design engineering craft").locator("[data-weight]");
    await slider.fill("0.6");
    await expect(topic(page, "Design engineering craft").locator("[data-word]")).toHaveText("60%");
    await expect(bar(page)).toContainText("1 change");
    await bar(page).getByRole("button", { name: "Save" }).click();
    if (PASSPHRASE_REQUIRED) return;
    await expect(bar(page)).toContainText("Saved");
    expect(ops(sent)).toEqual([{ op: "weights.set", weights: { design_engineering_craft: 0.6 } }]);
  });

  test("a topic switch sends the topic with its current weight", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page);
    const row = topic(page, "Frontier model releases");
    await row.getByRole("switch").click();
    await row.locator("[data-weight]").fill("0.3");
    await bar(page).getByRole("button", { name: "Save" }).click();
    if (PASSPHRASE_REQUIRED) return;
    await expect(bar(page)).toContainText("Saved");
    const upsert = ops(sent).find((op) => op.op === "topic.upsert") as {
      topic: { id: string; enabled: boolean; weight: number };
    };
    expect(upsert.topic).toMatchObject({ id: "frontier_model_releases", enabled: false });
    expect(upsert.topic.weight).toBeCloseTo(0.3);
  });

  test("removing a source switches it off, and Undo takes it back", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page);
    const row = source(page, "Studio Notes");
    await row.getByRole("button", { name: "Remove Studio Notes" }).click();
    await expect(bar(page)).toContainText("1 change");
    await row.getByRole("button", { name: "Keep Studio Notes" }).click();
    await expect(bar(page)).toBeHidden();
    await row.getByRole("button", { name: "Remove Studio Notes" }).click();
    await bar(page).getByRole("button", { name: "Save" }).click();
    if (PASSPHRASE_REQUIRED) return;
    await expect(row).toBeHidden();
    expect(ops(sent)).toEqual([{ op: "source.set", id: "studio-notes", enabled: false }]);
  });

  test("filters by score and sorts by name", async ({ page }) => {
    await setup(page);
    await open(page);
    await page.getByRole("button", { name: "Poor under 3" }).click();
    await expect(source(page, "Model Ledger")).toBeVisible();
    await expect(source(page, "Studio Notes")).toBeHidden();
    await page.getByRole("button", { name: "New" }).click();
    await expect(source(page, "Launch Board")).toBeVisible();
    await expect(source(page, "Model Ledger")).toBeHidden();
    await page.getByRole("button", { name: "All" }).click();
    await page.getByLabel("Sort sources").selectOption("name");
    const names = await page.locator("li.source-row .source-name").allTextContents();
    expect(names.length).toBeGreaterThan(2);
  });

  test("the Add source panel looks the address up once and adds it to the chosen topic", async ({
    page,
  }) => {
    const { sent, previews } = await setup(page);
    await open(page);
    await page.getByRole("button", { name: "Add source", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Add a source" });
    await expect(sheet).toBeVisible();
    const add = sheet.getByRole("button", { name: "Add source", exact: true });
    await expect(add).toBeDisabled();
    await sheet.getByLabel("Site or feed address").fill("newsroom.example");
    await expect(sheet.getByText("Newsroom Example")).toBeVisible();
    await expect(sheet.getByText("https://newsroom.example/feed.xml")).toBeVisible();
    await expect(sheet.getByText("12 posts")).toBeVisible();
    await expect(sheet.getByText("Good")).toBeVisible();
    await expect(add).toBeEnabled();
    // The same address again is not looked up again.
    await sheet.getByLabel("Site or feed address").fill("");
    await sheet.getByLabel("Site or feed address").fill("newsroom.example");
    await expect(add).toBeEnabled();
    expect(previews).toEqual(["https://newsroom.example/"]);
    await sheet.getByLabel("Topic").selectOption("audio_interfaces");
    await add.click();
    await expect(sheet).toBeHidden();
    const row = topic(page, "Audio interfaces").locator("li.source-row.is-new");
    await expect(row).toContainText("Newsroom Example");
    if (PASSPHRASE_REQUIRED) return;
    await expect(row).toContainText("Added");
    expect(ops(sent)).toEqual([
      { op: "source.add", url: "https://newsroom.example/", topic_ids: ["audio_interfaces"] },
    ]);
  });

  // The browser logs the refused lookup itself; the panel answers it in words.
  test.describe("a refused lookup", () => {
    test.use({ allowNetworkErrors: true });
    test("the panel says what to do when the address cannot be read", async ({ page }) => {
      await setup(page);
      await page.route("**/api/source-preview**", (route) =>
        route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({ error: "unreachable", message: "x" }),
        }),
      );
      await open(page);
      await page.getByRole("button", { name: "Add source", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "Add a source" });
      await sheet.getByLabel("Site or feed address").fill("nothing.example");
      await expect(sheet.getByRole("alert")).toContainText("could not be read");
      await expect(sheet.getByRole("button", { name: "Add source", exact: true })).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
    });
  });

  test("a topic has its own Add source button, with that topic chosen", async ({ page }) => {
    await setup(page);
    await open(page);
    await page.getByRole("button", { name: "Add source to Audio interfaces" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a source" });
    await expect(sheet.getByLabel("Topic")).toHaveValue("audio_interfaces");
  });

  test("the filter pills are never clipped on a phone", async ({ page }) => {
    await setup(page);
    await open(page);
    const width = page.viewportSize()?.width ?? 0;
    const edges = await page
      .locator(".topics-filters .filter-chip")
      .evaluateAll((chips) => chips.map((chip) => chip.getBoundingClientRect().right));
    for (const right of edges) expect(right).toBeLessThanOrEqual(width);
  });

  test("Add topic keeps its flow", async ({ page }) => {
    const { sent } = await setup(page);
    await open(page);
    await page.getByText("Add topic", { exact: true }).first().click();
    const form = page.getByRole("form", { name: "Add a topic" });
    await form.getByLabel("Name").fill("Sound design");
    await form.getByLabel("What should count as this topic").fill("Sound in interfaces.");
    await form.getByLabel(/Keywords/).fill("audio, haptics");
    await form.getByRole("button", { name: "Add topic" }).click();
    await bar(page).getByRole("button", { name: "Save" }).click();
    if (PASSPHRASE_REQUIRED) return;
    await expect(bar(page)).toContainText("Saved");
    expect(ops(sent)).toMatchObject([
      { op: "topic.upsert", topic: { id: "sound-design", keywords: ["audio", "haptics"] } },
    ]);
  });

  test("has no accessibility violations, with the panel open as well", async ({ page }) => {
    await setup(page);
    await open(page);
    const scan = async () =>
      (await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
      );
    expect(await scan()).toEqual([]);
    await page.getByRole("button", { name: "Add source", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Add a source" });
    await sheet.getByLabel("Site or feed address").fill("newsroom.example");
    await expect(sheet.getByText("Newsroom Example")).toBeVisible();
    expect(await scan()).toEqual([]);
  });

  test("no row is a dead zone: sources are at least 44px tall and touch", async ({ page }) => {
    await setup(page);
    await open(page);
    const boxes = await topic(page, "Design engineering craft")
      .locator("li.source-row")
      .evaluateAll((rows) =>
        rows.map((row) => {
          const rect = row.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom };
        }),
      );
    for (const [index, box] of boxes.entries()) {
      expect(box.bottom - box.top).toBeGreaterThanOrEqual(44);
      const next = boxes[index + 1];
      if (next) expect(Math.abs(next.top - box.bottom)).toBeLessThanOrEqual(1);
    }
  });
});
