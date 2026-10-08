import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const PASSPHRASE_KEY = "dispatch:narrate-passphrase";

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

async function open(page: Page, path: "topics" | "sources"): Promise<void> {
  await page.goto(`/settings/${path}`);
  await expect(page.locator("[data-manage]")).toHaveAttribute("data-ready", "");
}

const row = (page: Page, name: string) => page.locator("li.manage-row", { hasText: name });
const bar = (page: Page) => page.locator("[data-bar]");

async function save(page: Page, passphrase = "correct horse"): Promise<void> {
  await bar(page).getByRole("button", { name: "Save" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Passphrase").fill(passphrase);
  await dialog.getByRole("button", { name: "Continue" }).click();
}

test.describe("settings entries", () => {
  test("link to the two pages", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("link", { name: /^Topics/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Topics" })).toBeVisible();
    await page.getByRole("link", { name: "Settings" }).first().click();
    await page.getByRole("link", { name: /^Sources/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Sources" })).toBeVisible();
  });

  test("keep Settings current in the navigation and link back to it", async ({ page }) => {
    await open(page, "topics");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.locator("main").getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings",
    );
    await expect(page).toHaveTitle("Topics, Singularity");
  });
});

test.describe("topics", () => {
  test("render from the config, with the state each topic has", async ({ page }) => {
    await open(page, "topics");
    await expect(page.getByRole("heading", { level: 1, name: "Topics" })).toBeVisible();
    for (const name of [
      "Design engineering craft",
      "Frontier model releases",
      "Consumer tech releases",
      "Audio interfaces",
    ]) {
      await expect(row(page, name)).toBeVisible();
    }
    await expect(page.getByRole("switch", { name: "Design engineering craft" })).toBeChecked();
    await expect(page.getByRole("switch", { name: "Consumer tech releases" })).not.toBeChecked();
    const craft = page.getByRole("slider", { name: /Design engineering craft/ });
    await expect(craft).toHaveAttribute("aria-valuetext", "More");
    await expect(row(page, "Frontier model releases").locator("[data-word]")).toHaveText("Normal");
    // A topic that never publishes is listed and has nothing to change.
    await expect(row(page, "Venture capital and gossip")).toContainText(
      "Left out of every briefing.",
    );
    await expect(row(page, "Venture capital and gossip").getByRole("switch")).toHaveCount(0);
    // Only the topic made on the site can be removed.
    await expect(page.getByRole("button", { name: /^Remove/ })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Remove Audio interfaces" })).toBeVisible();
  });

  test("read with scripts off", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto("/settings/topics");
    await expect(row(page, "Frontier model releases")).toBeVisible();
    await expect(
      page.locator("p.manage-note", { hasText: "Changing topics needs JavaScript" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Add a topic" })).toBeHidden();
    await context.close();
  });

  test("a switch and a slider collect into one pending bar, and moving back drops the change", async ({
    page,
  }) => {
    await open(page, "topics");
    await expect(bar(page)).toBeHidden();
    await page.getByRole("switch", { name: "Frontier model releases" }).click();
    await expect(bar(page)).toBeVisible();
    await expect(bar(page).locator("[data-bar-text]")).toHaveText("1 change");
    await page.getByRole("slider", { name: /Design engineering craft/ }).fill("0.25");
    await expect(bar(page).locator("[data-bar-text]")).toHaveText("2 changes");
    await expect(row(page, "Design engineering craft").locator("[data-word]")).toHaveText(
      "A bit less",
    );
    await page.getByRole("switch", { name: "Frontier model releases" }).click();
    await page.getByRole("slider", { name: /Design engineering craft/ }).fill("1");
    await expect(bar(page)).toBeHidden();
  });

  test("Save asks for the passphrase and sends the edits one at a time, sliders together", async ({
    page,
  }) => {
    const sent = await mockConfig(page);
    await open(page, "topics");
    await page.getByRole("switch", { name: "Frontier model releases" }).click();
    await page.getByRole("slider", { name: /Design engineering craft/ }).fill("0.25");
    await page.getByRole("slider", { name: /Frontier model releases/ }).fill("1");
    await save(page);
    await expect(bar(page).locator("[data-bar-text]")).toContainText(
      "Saved. The changes appear after the next build, in about a minute.",
    );
    expect(sent).toHaveLength(2);
    expect(sent.every((request) => request.passphrase === "correct horse")).toBe(true);
    expect(sent[0]?.op).toMatchObject({
      op: "topic.upsert",
      topic: { id: "frontier_model_releases", enabled: false, weight: 1 },
    });
    expect(sent[1]?.op).toEqual({
      op: "weights.set",
      weights: { design_engineering_craft: 0.25, frontier_model_releases: 1 },
    });
    // Saved changes are the page's new starting point, so the bar goes when it is dismissed.
    await bar(page).getByRole("button", { name: "Dismiss" }).click();
    await expect(bar(page)).toBeHidden();
  });

  test("a topic is added with an id made from its name, and can be cancelled before saving", async ({
    page,
  }) => {
    const sent = await mockConfig(page);
    await open(page, "topics");
    await page.getByLabel("Name", { exact: true }).fill("Spatial computing");
    await page
      .getByLabel("What should count as this topic")
      .fill("Headsets and the interfaces made for them.");
    await page.getByLabel("Keywords, optional").fill("visionOS, headset, , visionOS");
    await page.getByRole("button", { name: "Add topic" }).click();
    await expect(page.getByRole("list", { name: "Waiting to be saved" })).toContainText(
      "Spatial computing",
    );
    await expect(bar(page).locator("[data-bar-text]")).toHaveText("1 change");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");

    await page.getByRole("button", { name: "Cancel adding Spatial computing" }).click();
    await expect(bar(page)).toBeHidden();

    await page.getByLabel("Name", { exact: true }).fill("Spatial computing");
    await page
      .getByLabel("What should count as this topic")
      .fill("Headsets and the interfaces made for them.");
    await page.getByLabel("Keywords, optional").fill("visionOS, headset, , visionOS");
    await page.getByRole("button", { name: "Add topic" }).click();
    await save(page);
    await expect(bar(page).locator("[data-bar-text]")).toContainText("Saved.");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.op).toEqual({
      op: "topic.upsert",
      topic: {
        id: "spatial-computing",
        name: "Spatial computing",
        description: "Headsets and the interfaces made for them.",
        weight: 0.5,
        enabled: true,
        keywords: ["visionOS", "headset"],
        section_id: "tech",
      },
    });
    await expect(page.getByRole("list", { name: "Waiting to be saved" })).toBeHidden();
  });

  test("a removal waits to be saved and is sent last", async ({ page }) => {
    const sent = await mockConfig(page);
    await open(page, "topics");
    await page.getByRole("button", { name: "Remove Audio interfaces" }).click();
    await expect(row(page, "Audio interfaces").locator(".manage-flag")).toBeVisible();
    await page.getByRole("switch", { name: "Frontier model releases" }).click();
    await save(page);
    await expect(bar(page).locator("[data-bar-text]")).toContainText("Saved.");
    expect(sent.map((request) => request.op.op)).toEqual(["topic.upsert", "topic.remove"]);
    expect(sent[1]?.op).toEqual({ op: "topic.remove", id: "audio_interfaces" });
    await expect(row(page, "Audio interfaces")).toBeHidden();
  });
});

test.describe("sources", () => {
  test("render from the config, with the registry, the added sources and the overrides applied", async ({
    page,
  }) => {
    await open(page, "sources");
    await expect(page.getByRole("heading", { level: 1, name: "Sources" })).toBeVisible();
    await expect(row(page, "Studio Notes")).toContainText(
      "studio-notes.example · 12 of 40 stories made a briefing",
    );
    await expect(row(page, "Model Ledger")).toContainText("None of 30 stories made a briefing");
    await expect(row(page, "Launch Board")).toContainText("Not loading lately");
    await expect(row(page, "Sound Desk")).toBeVisible();
    // Removed by an override.
    await expect(row(page, "Pixel Weekly")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pin Studio Notes" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("switch", { name: "Quiet Motion" })).not.toBeChecked();
    // Pinned sources come first.
    await expect(page.locator("li.manage-row .manage-name").first()).toHaveText("Studio Notes");
  });

  test("suggestions come from the candidates, best first, without a feed already in the list", async ({
    page,
  }) => {
    await open(page, "sources");
    const suggested = page.locator("section", {
      has: page.getByRole("heading", { name: "Suggested" }),
    });
    const names = suggested.locator(".manage-name");
    await expect(names).toHaveText(["waveform-journal.example", "listening-lab.example"]);
    await expect(row(page, "waveform-journal.example")).toContainText(
      "Strong match for Audio interfaces, from 8 recent stories",
    );
    await expect(row(page, "listening-lab.example")).toContainText("Good match");
  });

  test("search and the chips filter the list", async ({ page }) => {
    await open(page, "sources");
    const names = page.locator("li.manage-row:visible .manage-name");
    const search = page.getByRole("searchbox", { name: "Search sources" });

    await search.fill("ledger");
    await expect(names).toHaveText(["Model Ledger"]);
    await expect(page.locator("[data-status]")).toHaveText("1 result");
    await expect(page.getByRole("heading", { name: "Suggested" })).toBeHidden();

    await search.fill("zzz");
    await expect(page.getByText("No sources match.")).toBeVisible();
    await search.fill("");
    await expect(page.getByText("No sources match.")).toBeHidden();

    await page.getByRole("button", { name: "Pinned", exact: true }).click();
    await expect(names).toHaveText(["Studio Notes"]);
    await expect(page.getByRole("button", { name: "Pinned", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("button", { name: "All", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await page.getByRole("button", { name: "Off", exact: true }).click();
    await expect(names).toHaveText(["Quiet Motion"]);

    await page.getByRole("button", { name: "Suggested", exact: true }).click();
    await expect(names).toHaveText(["waveform-journal.example", "listening-lab.example"]);
    await expect(page.getByRole("heading", { name: "Your sources" })).toBeHidden();

    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(names).toHaveCount(8);
  });

  test("a pin, a switch, a suggestion and an address each send their own edit", async ({
    page,
  }) => {
    const sent = await mockConfig(page);
    await open(page, "sources");
    await page.getByRole("button", { name: "Pin Model Ledger" }).click();
    await page.getByRole("switch", { name: "Quiet Motion" }).click();
    await page.getByRole("button", { name: "Add waveform-journal.example" }).click();
    await expect(
      page.getByRole("button", { name: "Add waveform-journal.example" }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByLabel("Site or feed address").fill("www.example.org/feed");
    await page.getByRole("button", { name: "Add source" }).click();
    await expect(bar(page).locator("[data-bar-text]")).toHaveText("4 changes");
    await save(page, "open sesame");
    await expect(bar(page).locator("[data-bar-text]")).toContainText("Saved.");

    expect(sent.map((request) => request.passphrase)).toEqual(Array(4).fill("open sesame"));
    expect(sent.map((request) => request.op)).toEqual(
      expect.arrayContaining([
        { op: "source.set", id: "model-ledger", pinned: true },
        { op: "source.set", id: "quiet-motion", enabled: true },
        {
          op: "source.add",
          url: "https://waveform-journal.example/feed.xml",
          topic_ids: ["audio_interfaces"],
        },
        { op: "source.add", url: "https://www.example.org/feed" },
      ]),
    );
    // What was sent is settled: the suggestion is added for good.
    await expect(page.getByRole("button", { name: "Add waveform-journal.example" })).toBeDisabled();
  });

  test("a removal strikes the row and can be undone", async ({ page }) => {
    await open(page, "sources");
    const remove = page.getByRole("button", { name: "Remove Quiet Motion" });
    await remove.click();
    await expect(row(page, "Quiet Motion").locator(".manage-flag")).toBeVisible();
    await expect(bar(page).locator("[data-bar-text]")).toHaveText("1 change");
    await remove.click();
    await expect(row(page, "Quiet Motion").locator(".manage-flag")).toBeHidden();
    await expect(bar(page)).toBeHidden();
  });

  test("an address that is not a web address is refused in the field", async ({ page }) => {
    await open(page, "sources");
    await page.getByLabel("Site or feed address").fill("not an address");
    await page.getByRole("button", { name: "Add source" }).click();
    await expect(bar(page)).toBeHidden();
    const message = await page
      .getByLabel("Site or feed address")
      .evaluate((input: HTMLInputElement) => input.validationMessage);
    expect(message).toBe("Enter a web address, like example.com.");
  });
});

test.describe("saving", () => {
  test("remembers the passphrase only when asked, under the narration key", async ({ page }) => {
    const sent = await mockConfig(page);
    await open(page, "sources");
    await page.getByRole("switch", { name: "Quiet Motion" }).click();
    await bar(page).getByRole("button", { name: "Save" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Passphrase").fill("kept on this device");
    await dialog.getByLabel("Remember on this device").check();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(bar(page).locator("[data-bar-text]")).toContainText("Saved.");
    expect(await page.evaluate((key) => localStorage.getItem(key), PASSPHRASE_KEY)).toBe(
      "kept on this device",
    );

    // The next save does not ask again.
    await page.getByRole("switch", { name: "Quiet Motion" }).click();
    await bar(page).getByRole("button", { name: "Save" }).click();
    await expect(bar(page).locator("[data-bar-text]")).toContainText("Saved.");
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(sent.at(-1)?.passphrase).toBe("kept on this device");
  });

  test("cancelling the dialog sends nothing and keeps the changes", async ({ page }) => {
    const sent = await mockConfig(page);
    await open(page, "sources");
    await page.getByRole("switch", { name: "Quiet Motion" }).click();
    await bar(page).getByRole("button", { name: "Save" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(bar(page).locator("[data-bar-text]")).toHaveText("1 change");
    expect(sent).toHaveLength(0);
  });

  test.describe("when the server asks for a wait", () => {
    test.use({ allowNetworkErrors: true });

    test("a wait between edits is waited out, then the queue goes on", async ({ page }) => {
      const sent = await mockConfig(page, [
        { status: 429, body: { status: 429, error: "cooldown", retry_after_s: 1 } },
      ]);
      await open(page, "sources");
      await page.getByRole("switch", { name: "Quiet Motion" }).click();
      await save(page);
      await expect(bar(page).locator("[data-bar-text]")).toContainText("Waiting a few seconds");
      await expect(bar(page).locator("[data-bar-text]")).toContainText("Saved.", {
        timeout: 10_000,
      });
      expect(sent).toHaveLength(2);
    });
  });

  test.describe("when the server refuses", () => {
    test.use({ allowNetworkErrors: true });

    test("a wrong passphrase is said plainly, the change stays pending, and the passphrase is forgotten", async ({
      page,
    }) => {
      const sent = await mockConfig(page, [
        { status: 401, body: { status: 401, error: "wrong_passphrase" } },
      ]);
      await open(page, "sources");
      await page.getByRole("switch", { name: "Quiet Motion" }).click();
      await bar(page).getByRole("button", { name: "Save" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Passphrase").fill("not it");
      await dialog.getByLabel("Remember on this device").check();
      await dialog.getByRole("button", { name: "Continue" }).click();
      const text = bar(page).locator("[data-bar-text]");
      await expect(text).toHaveText(
        "That passphrase is not right. Your changes are still waiting.",
      );
      expect(sent).toHaveLength(1);
      expect(await page.evaluate((key) => localStorage.getItem(key), PASSPHRASE_KEY)).toBeNull();
      // Still there to save, and the next Save asks again.
      await expect(bar(page).getByRole("button", { name: "Save" })).toBeVisible();
      await expect(page.getByRole("switch", { name: "Quiet Motion" })).toBeChecked();
      await bar(page).getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
    });

    test("a refusal part way stops the queue and keeps the rest", async ({ page }) => {
      const sent = await mockConfig(page, [
        { status: 202, body: { status: 202, run_id: 1 } },
        { status: 400, body: { status: 400, error: "invalid_request" } },
      ]);
      await open(page, "sources");
      await page.getByRole("switch", { name: "Quiet Motion" }).click();
      await page.getByRole("button", { name: "Pin Model Ledger" }).click();
      await page.getByRole("button", { name: "Remove Type and Grid" }).click();
      await save(page);
      await expect(bar(page).locator("[data-bar-text]")).toHaveText(
        "Saved 1 of 3. That change was not accepted. The rest is still waiting.",
      );
      expect(sent).toHaveLength(2);
      // The first one is settled; the other two are still pending, so a second Save sends them.
      await expect(bar(page).getByRole("button", { name: "Save" })).toBeVisible();
      await page.getByRole("button", { name: "Discard" }).waitFor();
    });

    test("an unreachable site is said plainly", async ({ page }) => {
      await page.route("**/api/config", (route) => route.abort("connectionrefused"));
      await open(page, "sources");
      await page.getByRole("switch", { name: "Quiet Motion" }).click();
      await save(page);
      await expect(bar(page).locator("[data-bar-text]")).toHaveText(
        "The site could not be reached. Your changes are still waiting.",
      );
    });
  });
});

test.describe("layout", () => {
  test("every control has a 44px target", async ({ page }) => {
    await open(page, "sources");
    await page.getByRole("switch", { name: "Quiet Motion" }).click();
    const small: string[] = [];
    const controls = page.locator(
      "[data-manage] button:visible, [data-manage] [role=switch]:visible, [data-manage] input:not([type=checkbox]):visible",
    );
    for (const handle of await controls.elementHandles()) {
      const box = await handle.evaluate((element) => {
        const node = element as HTMLElement;
        node.scrollIntoView({ block: "center" });
        const rect = node.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hits = (dx: number, dy: number): boolean => {
          const found = document.elementFromPoint(x + dx, y + dy);
          return found !== null && (found === node || node.contains(found));
        };
        const reach = (dx: number, dy: number): number => {
          let distance = 0;
          while (distance < 60 && hits(dx * (distance + 1), dy * (distance + 1))) distance += 1;
          return distance;
        };
        return {
          name: node.getAttribute("aria-label") ?? node.textContent?.trim() ?? node.tagName,
          width: reach(-1, 0) + reach(1, 0) + 1,
          height: reach(0, -1) + reach(0, 1) + 1,
        };
      });
      if (box.width < 44 || box.height < 44) small.push(`${box.name} ${box.width}x${box.height}`);
    }
    expect(small).toEqual([]);
  });

  test("the page never scrolls sideways", async ({ page }) => {
    for (const path of ["topics", "sources"] as const) {
      await open(page, path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`axe, ${scheme} scheme`, () => {
    for (const path of ["topics", "sources"] as const) {
      test(`${path} has no WCAG 2.2 AA violations`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await open(page, path);
        await page.evaluate(() => document.fonts.ready);
        expect(await violations(page)).toEqual([]);
      });

      test(`${path} has none with the pending bar open`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await open(page, path);
        await page.getByRole("switch").first().click();
        await expect(bar(page)).toBeVisible();
        // The bar slides in over 250ms; contrast is measured on the settled page.
        await page.waitForTimeout(400);
        expect(await violations(page)).toEqual([]);
      });
    }

    test("the passphrase dialog has none", async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page, "sources");
      await page.getByRole("switch", { name: "Quiet Motion" }).click();
      await bar(page).getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.waitForTimeout(400);
      expect(await violations(page)).toEqual([]);
    });
  });
}
