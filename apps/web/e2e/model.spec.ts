import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures";
import { PASSPHRASE_REQUIRED } from "./passphrase";

interface Sent {
  passphrase: string;
  op: Record<string, unknown>;
}

/** Answers /api/config and records what was sent. */
async function mockConfig(page: Page) {
  const sent: Sent[] = [];
  await page.route("**/api/config", async (route: Route) => {
    sent.push(route.request().postDataJSON() as Sent);
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ status: 202, run_id: 1 }),
    });
  });
  return sent;
}

async function open(page: Page): Promise<void> {
  await page.goto("/settings/model");
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

test.describe("model", () => {
  test("is reached from Settings", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("link", { name: /^Model/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Model" })).toBeVisible();
    await expect(page).toHaveTitle("Model, Singularity");
  });

  test("lists Automatic and the live models, with Automatic chosen", async ({ page }) => {
    await open(page);
    await expect(page.getByLabel("Provider")).toHaveValue("nebius");
    await expect(radio(page, /^Automatic/)).toBeChecked();
    await expect(page.getByRole("radio")).toHaveCount(4);
    const llama = radio(page, /^Llama-3\.3-70B-Instruct/);
    await expect(llama).not.toBeChecked();
    await expect(
      page.locator("label.manage-pick", { hasText: "Llama-3.3-70B-Instruct" }),
    ).toContainText("meta-llama, 128k context");
    await expect(bar(page)).toBeHidden();
  });

  test("rows and fields are at least 44px tall", async ({ page }) => {
    await open(page);
    for (const target of [
      page.getByLabel("Provider"),
      page.getByLabel("Filter models"),
      ...(await page.locator("label.manage-pick").all()),
    ]) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test("the filter narrows the list and announces the count", async ({ page }) => {
    await open(page);
    await page.getByLabel("Filter models").fill("QWEN");
    await expect(page.getByRole("radio")).toHaveCount(2);
    await expect(radio(page, /^Qwen3-235B/)).toBeVisible();
    await expect(page.locator("[data-count]")).toHaveText("1 model");
    await expect(page.locator("[data-count]")).toHaveAttribute("aria-live", "polite");
    await page.getByLabel("Filter models").fill("zzz");
    await expect(page.locator("[data-count]")).toHaveText("No models match");
    await page.getByLabel("Filter models").fill("");
    await expect(page.getByRole("radio")).toHaveCount(4);
  });

  test("the filter keeps the chosen row visible", async ({ page }) => {
    await open(page);
    await radio(page, /^Llama-3\.3-70B-Instruct/).check();
    await page.getByLabel("Filter models").fill("qwen");
    await expect(radio(page, /^Llama-3\.3-70B-Instruct/)).toBeVisible();
    await expect(radio(page, /^Llama-3\.3-70B-Instruct/)).toBeChecked();
  });

  test("choosing a model enables Save and sends writer.set with that id", async ({ page }) => {
    const sent = await mockConfig(page);
    await open(page);
    await radio(page, /^Llama-3\.3-70B-Instruct/).check();
    await expect(bar(page)).toBeVisible();
    await expect(barText(page)).toHaveText("1 change");
    await save(page);
    await expect(barText(page)).toContainText("Saved.");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.op).toEqual({
      op: "writer.set",
      provider: "nebius",
      model: "meta-llama/Llama-3.3-70B-Instruct",
    });
    // Saved is the new starting point: going back to Automatic is a change again.
    await bar(page).getByRole("button", { name: "Dismiss" }).click();
    await radio(page, /^Automatic/).check();
    await expect(barText(page)).toHaveText("1 change");
  });

  test("going back to the saved choice drops the change", async ({ page }) => {
    await open(page);
    await radio(page, /^Qwen3-235B/).check();
    await expect(bar(page)).toBeVisible();
    await radio(page, /^Automatic/).check();
    await expect(bar(page)).toBeHidden();
  });

  test("has no WCAG 2.2 AA violations", async ({ page }) => {
    await open(page);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  test.describe("when the list is not available", () => {
    test.use({ allowNetworkErrors: true });

    test("shows Automatic and a field for typing a model id", async ({ page }) => {
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
      await expect(page.getByRole("radio")).toHaveCount(1);
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
});
