import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./fixtures";
import { PASSPHRASE_OFF, PASSPHRASE_ON, PASSPHRASE_REQUIRED } from "./passphrase";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const PASSPHRASE = "correct horse battery staple";
/** What the page sends as the passphrase: what was typed, or the fixed value while none is asked. */
const SENT = PASSPHRASE_REQUIRED ? PASSPHRASE : "open";
const STORAGE_KEY = "dispatch:narrate-passphrase";
const EPISODE = "/e/ep-20261007-1930";
const EPISODE_ID = "ep-20261007-1930";

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

interface Mock {
  /** The JSON of every POST /api/podcast the page made. */
  bodies: Array<Record<string, unknown>>;
}

/** Answers POST /api/podcast with `status` and `body`, and records what was sent. */
async function mockPodcast(page: Page, status: number, body: unknown): Promise<Mock> {
  const mock: Mock = { bodies: [] };
  await page.route("**/api/podcast", async (route: Route) => {
    mock.bodies.push(route.request().postDataJSON());
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  return mock;
}

const chip = (page: Page, name: string) => page.locator(".filter-chip:visible", { hasText: name });
const segment = (page: Page, name: string) => page.locator(".settings-segment", { hasText: name });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Enter the passphrase" });
const submit = (page: Page) => page.locator("[data-submit]");

/** Unticks every chip, for a test that starts from no topic. */
async function clearTopics(page: Page): Promise<void> {
  const checked = page.locator('input[name="topic"]:checked');
  for (let left = await checked.count(); left > 0; left -= 1) {
    await checked.first().locator("xpath=..").click();
    await expect(checked).toHaveCount(left - 1);
  }
  await expect(page.locator('input[name="topic"]:checked')).toHaveCount(0);
}

/** Opens More options (Written for, voices, look back, tone, title) unless it is already open. */
async function openMore(page: Page): Promise<void> {
  const more = page.locator("[data-create-more]").first();
  if (!(await more.evaluate((details) => (details as HTMLDetailsElement).open))) {
    await more.locator("summary").click();
  }
  await expect(more).toHaveAttribute("open", "");
}

/**
 * Opens the page and waits for its script, which is what makes the form do anything. More options
 * is opened too, so every choice can be pressed; a test of the closed row opens the page itself.
 */
async function openCreate(page: Page): Promise<void> {
  await page.goto("/create");
  await expect(page.locator("[data-create]")).toHaveAttribute("data-ready", "");
  await openMore(page);
}

/**
 * Presses Create with the Somesh preset ticked (Design, AI, Technology). While a passphrase is asked for, that opens its dialog;
 * while it is not, the request is already on its way.
 */
async function openDialog(page: Page): Promise<void> {
  await page.locator("[data-submit]").click();
  if (PASSPHRASE_REQUIRED) await expect(dialog(page)).toBeVisible();
}

/** Answers the passphrase dialog. With the step off there is none to answer. */
async function confirm(page: Page): Promise<void> {
  if (!PASSPHRASE_REQUIRED) return;
  await dialog(page).getByLabel("Passphrase").fill(PASSPHRASE);
  await dialog(page).getByRole("button", { name: "Create episode" }).click();
}

// The service worker answers /latest.json itself, which a route handler cannot see.
test.use({ serviceWorkers: "block" });

test.describe("the Create page", () => {
  test("shows no error line, and no part of one, before anything has gone wrong", async ({
    page,
  }) => {
    await openCreate(page);
    // Hidden in the DOM is not enough: a display rule on the line once showed its icon anyway.
    for (const line of await page.locator("[data-error]").all()) await expect(line).toBeHidden();
    // Nothing is running, so the indicator has nothing to say.
    await expect(page.locator("[data-run-card]")).toBeHidden();
  });

  test("asks about topics first and offers every choice", async ({ page }) => {
    await openCreate(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("New episode");
    // No lede to explain the form: the form says it.
    await expect(page.locator(".create-lede")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "Topics",
      "Length",
      "Format",
      "Written for",
      "Voice",
      "Look back",
      "Tone",
      "Title (optional)",
    ]);
    // One list for both audiences, then the owner's own.
    await expect(page.locator(".filter-chip:visible")).toHaveText([
      "Design",
      "AI",
      "Technology",
      "World",
      "Business",
      "Science",
      "Culture",
      "Sports",
      "Audio interfaces",
    ]);
    await expect(page.locator('input[name="length"]')).toHaveCount(4);
    await expect(page.locator('input[name="window"]')).toHaveCount(3);
    await expect(page.locator('input[name="tone"]')).toHaveCount(3);
    await expect(page.locator('.settings-segment:has(input[name="format"])')).toHaveText([
      "Readout",
      "Discussion",
    ]);
    // The helper lines are gone: nothing under Written for or Topics, and the Title label says it is
    // optional, in one label at one size.
    await expect(
      page.locator("[data-audience-hint], [data-top-hint], #create-topics-hint"),
    ).toHaveCount(0);
    await expect(page.getByLabel("Title (optional)")).toHaveAttribute("name", "title");
    await expect(submit(page)).toHaveText("Generate • 5 mins");
    // Sensible defaults are already chosen, and so is the Somesh preset.
    await expect(page.locator('input[name="length"]:checked')).toHaveValue("5");
    await expect(page.locator('input[name="format"]:checked')).toHaveValue("readout");
    await expect(page.locator('input[name="window"]:checked')).toHaveValue("7");
    await expect(page.locator('input[name="tone"]:checked')).toHaveValue("neutral");
    await expect(page.locator('input[name="topic"]:checked')).toHaveCount(3);
  });

  test("the button says how long the episode will be, and follows the length", async ({ page }) => {
    await openCreate(page);
    await expect(submit(page)).toHaveText("Generate • 5 mins");
    await segment(page, "10 min").click();
    await expect(submit(page)).toHaveText("Generate • 10 mins");
    await segment(page, "15 min").click();
    await expect(submit(page)).toHaveText("Generate • 15 mins");
    await segment(page, "3 min").click();
    await expect(submit(page)).toHaveText("Generate • 3 mins");
    // The other choices do not change it.
    await segment(page, "Discussion").click();
    await expect(submit(page)).toHaveText("Generate • 3 mins");
  });

  test("while the request is out the button says Starting…, with its spinner beside the words", async ({
    page,
  }) => {
    test.skip(PASSPHRASE_REQUIRED, PASSPHRASE_ON);
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/podcast", async (route) => {
      await held;
      // Accepted without a run to follow: the form says it did not start, with no failed request.
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ status: 202 }),
      });
    });
    await openCreate(page);
    await submit(page).click();
    const words = page.locator("[data-submit-text]");
    await expect(words).toHaveText("Starting…");
    await expect(submit(page)).toHaveAttribute("aria-busy", "true");
    const spinner = await submit(page).locator(".spinner").boundingBox();
    const text = await words.boundingBox();
    const button = await submit(page).boundingBox();
    if (!spinner || !text || !button) throw new Error("the button is not laid out");
    // In the row with the words, just before them, not pinned to the button's edge.
    expect(spinner.x + spinner.width).toBeLessThanOrEqual(text.x);
    expect(text.x - (spinner.x + spinner.width)).toBeLessThanOrEqual(12);
    expect(Math.abs(spinner.y + spinner.height / 2 - (text.y + text.height / 2))).toBeLessThan(3);
    // The pair sits in the middle of the button.
    const left = spinner.x - button.x;
    const right = button.x + button.width - (text.x + text.width);
    expect(Math.abs(left - right)).toBeLessThan(6);
    release();
    await expect(page.locator('[data-error="form"]')).toBeVisible();
    await expect(words).toHaveText("Generate • 5 mins");
    await expect(submit(page).locator(".spinner")).toBeHidden();
  });

  test("the sticky foot shows a hairline while the form runs on under it, and none at the end", async ({
    page,
  }, info) => {
    test.skip(
      info.project.name === "desktop",
      "the whole form fits beside the options on a wide page",
    );
    await openCreate(page);
    const line = () =>
      page
        .locator(".create-page .create-submit")
        .evaluate((node) => Number(getComputedStyle(node, "::before").opacity));
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(
      true,
    );
    await expect.poll(line).toBe(1);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(line).toBe(0);
  });

  for (const width of [320, 360, 390]) {
    test(`the chosen length fits inside its segment at ${width}px`, async ({ page }, info) => {
      test.skip(info.project.name === "desktop", "a phone width");
      await page.setViewportSize({ width, height: 800 });
      await openCreate(page);
      await segment(page, "15 min").click();
      // The check grows in beside the words; measure once it has.
      await page.waitForTimeout(500);
      const fit = await page
        .locator(".settings-segment:has(input[name='length']:checked)")
        .evaluate((label) => {
          const box = label.getBoundingClientRect();
          const words = (label.querySelector("span") as HTMLElement).getBoundingClientRect();
          return { left: words.left - box.left, right: box.right - words.right };
        });
      expect(fit.left).toBeGreaterThanOrEqual(6);
      expect(fit.right).toBeGreaterThanOrEqual(6);
      // Centred: the check does not push the words against one edge.
      expect(Math.abs(fit.left - fit.right)).toBeLessThan(4);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    });
  }

  test("needs at least one topic before it asks for the passphrase", async ({ page }) => {
    await openCreate(page);
    await clearTopics(page);
    const error = page.locator('[data-error="topics"]');
    await expect(error).toBeHidden();
    await page.locator("[data-submit]").click();
    await expect(error).toBeVisible();
    await expect(error).toHaveText("Pick at least one topic.");
    await expect(dialog(page)).toBeHidden();
    // Focus goes to the first topic, where the fix is.
    await expect(page.locator('input[name="topic"]').first()).toBeFocused();
    // Choosing one clears the message.
    await chip(page, "AI").click();
    await expect(error).toBeHidden();
  });

  test("has no limit on topics: every chip can be chosen", async ({ page }) => {
    await openCreate(page);
    await clearTopics(page);
    const chips = page.locator(".filter-chip:visible");
    const total = await chips.count();
    for (let index = 0; index < total; index += 1) await chips.nth(index).click();
    await expect(page.locator('input[name="topic"]:checked')).toHaveCount(total);
    await expect(page.locator('input[name="topic"]:disabled')).toHaveCount(0);
  });

  test("Top picks is not a chip", async ({ page }) => {
    await openCreate(page);
    await expect(page.locator(".filter-chip", { hasText: "Top picks" })).toHaveCount(0);
    await expect(page.locator('input[name="topic"][value="top"]')).toHaveCount(0);
  });

  test("a new audience keeps topics picked by hand, says so, and offers its suggestion", async ({
    page,
  }) => {
    const mock = await mockPodcast(page, 202, { status: 202, run_id: 3, started_at: "x" });
    await openCreate(page);
    await expect(page.locator('input[name="audience"]:checked')).toHaveValue("custom");
    const note = page.locator("[data-preset-note]");
    await expect(note).toBeHidden();
    await chip(page, "Audio interfaces").click();
    await segment(page, "General").click();
    // The hand-picked topics stay, and the line says so.
    await expect(page.locator('input[name="topic"]:checked')).toHaveCount(4);
    await expect(note).toBeVisible();
    await expect(note).toContainText("Your topic picks are kept.");
    await page.getByRole("button", { name: "Use suggested topics" }).click();
    await expect(note).toBeHidden();
    // Every chip stays; the selection is General's preset, so the owner's own topic is unticked.
    await expect(page.locator(".filter-chip:visible")).toHaveCount(9);
    await expect(page.locator('input[name="topic"][value="audio_interfaces"]')).not.toBeChecked();
    await expect(page.locator('input[name="topic"]:checked')).toHaveCount(6);
    await page.locator("[data-submit]").click();
    await confirm(page);
    await expect.poll(() => mock.bodies.length).toBe(1);
    expect(mock.bodies[0]?.request).toMatchObject({
      audience: "general",
      topic_ids: ["tech", "world", "business", "science", "culture", "sports"],
    });
    expect(JSON.stringify(mock.bodies[0])).not.toContain('"top"');
  });

  test("the presets: Somesh ticks Design, AI, Technology; General ticks the six news topics", async ({
    page,
  }) => {
    await openCreate(page);
    const ticked = page.locator(".filter-chip:has(input:checked)");
    const all = page.locator(".filter-chip:visible");
    await expect(ticked).toHaveText(["Design", "AI", "Technology"]);
    await segment(page, "General").click();
    await expect(all).toHaveCount(9);
    await expect(ticked).toHaveText([
      "Technology",
      "World",
      "Business",
      "Science",
      "Culture",
      "Sports",
    ]);
    await segment(page, "Somesh").click();
    await expect(all).toHaveCount(9);
    await expect(ticked).toHaveText(["Design", "AI", "Technology"]);
  });

  test("chips ticked by hand mix both kinds of topic, and switching the audience keeps them", async ({
    page,
  }) => {
    const mock = await mockPodcast(page, 202, { status: 202, run_id: 3, started_at: "x" });
    await openCreate(page);
    await chip(page, "World").click();
    await chip(page, "Sports").click();
    await expect(page.locator('input[name="topic"]:checked')).toHaveCount(5);
    await page.locator("[data-submit]").click();
    await confirm(page);
    await expect.poll(() => mock.bodies.length).toBe(1);
    // Design sends two sections; the audience still says how the script is written.
    expect(mock.bodies[0]?.request).toMatchObject({
      audience: "custom",
      topic_ids: ["design", "ui-craft", "ai", "tech", "world", "sports"],
    });
    await segment(page, "General").click();
    await expect(page.locator('input[name="topic"]:checked')).toHaveCount(5);
    await segment(page, "Somesh").click();
    await expect(page.locator('input[name="topic"]:checked')).toHaveCount(5);
    await expect(page.locator("[data-preset-note]")).toBeVisible();
  });

  test("More options is one closed row that names its choices, and opens in place", async ({
    page,
  }, info) => {
    test.skip(info.project.name === "desktop", "a wide page keeps More options open");
    await page.goto("/create");
    await expect(page.locator("[data-create]")).toHaveAttribute("data-ready", "");
    const more = page.locator("[data-create-more]");
    await expect(more).not.toHaveAttribute("open", "");
    await expect(page.locator("[data-more-values]")).toHaveText("For Somesh · 7 days · Neutral");
    await expect(page.locator('input[name="tone"]').first()).toBeHidden();
    await more.locator("summary").click();
    await segment(page, "Dry").click();
    await segment(page, "General").click();
    await more.locator("summary").click();
    await expect(page.locator("[data-more-values]")).toHaveText("For General · 7 days · Dry");
  });

  test("a wide page keeps More options open beside the main questions", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "only a wide page pins it");
    await page.goto("/create");
    await expect(page.locator("[data-create]")).toHaveAttribute("data-ready", "");
    const more = page.locator("[data-create-more]");
    await expect(more).toHaveAttribute("data-pinned", "");
    await more.locator("summary").click();
    await expect(more).toHaveAttribute("open", "");
    const topics = await page.locator(".create-group-primary").boundingBox();
    const box = await more.boundingBox();
    expect((box?.x ?? 0) > (topics?.x ?? 0) + (topics?.width ?? 0)).toBe(true);
    // The whole form is in view: Generate needs no scrolling.
    await expect(submit(page)).toBeInViewport();
  });

  test("with the passphrase step off, Create sends straight away and mentions none", async ({
    page,
  }) => {
    test.skip(PASSPHRASE_REQUIRED, PASSPHRASE_ON);
    // The clock is held, so the page never gets as far as asking after the run.
    await page.clock.install();
    const mock = await mockPodcast(page, 202, { status: 202, run_id: 5, started_at: "x" });
    await openCreate(page);
    await expect(page.getByText(/passphrase/i)).toHaveCount(0);
    await page.locator("[data-submit]").click();
    await expect.poll(() => mock.bodies.length).toBe(1);
    expect(mock.bodies[0]?.passphrase).toBe("open");
    await expect(page.locator("[data-run-card]")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("asks for the passphrase in a dialog that can be cancelled", async ({ page }) => {
    test.skip(!PASSPHRASE_REQUIRED, PASSPHRASE_OFF);
    await openCreate(page);
    await openDialog(page);
    await expect(dialog(page).getByLabel("Passphrase")).toBeFocused();
    await expect(dialog(page).getByLabel("Remember on this device")).not.toBeChecked();
    await dialog(page).getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toBeHidden();
    // Escape closes it too.
    await page.locator("[data-submit]").click();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
  });

  test("will not send an empty passphrase", async ({ page }) => {
    test.skip(!PASSPHRASE_REQUIRED, PASSPHRASE_OFF);
    const mock = await mockPodcast(page, 202, { status: 202, run_id: 1, started_at: "x" });
    await openCreate(page);
    await openDialog(page);
    await dialog(page).getByRole("button", { name: "Create episode" }).click();
    await expect(dialog(page).getByRole("alert")).toHaveText("Enter the passphrase to continue.");
    expect(mock.bodies).toHaveLength(0);
  });

  test("sends the choices and the passphrase, then follows the run to the end", async ({
    page,
  }) => {
    await page.clock.install();
    const mock = await mockPodcast(page, 202, {
      status: 202,
      run_id: 4242,
      started_at: "2026-10-07T12:00:00.000Z",
    });
    const states = [
      { run_id: 4242, state: "queued", step: null },
      { run_id: 4242, state: "running", step: null },
      { run_id: 4242, state: "completed", step: null, outcome: "published" },
    ];
    const asked: string[] = [];
    await page.route("**/api/status?**", async (route) => {
      asked.push(new URL(route.request().url()).searchParams.get("run") ?? "");
      const next = states[Math.min(asked.length - 1, states.length - 1)];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(next),
      });
    });
    await openCreate(page);

    // Design off, World on: the request mixes AI and Technology with a general topic.
    await chip(page, "Design").click();
    await chip(page, "World").click();
    await segment(page, "10 min").click();
    await segment(page, "Discussion").click();
    await segment(page, "30 days").click();
    await segment(page, "Dry").click();
    await page.getByLabel("Title").fill("  My week in AI  ");
    await page.locator("[data-submit]").click();

    await confirm(page);

    // The request is exactly what was chosen, and the passphrase rides beside it.
    await expect.poll(() => mock.bodies.length).toBe(1);
    expect(mock.bodies[0]).toEqual({
      passphrase: SENT,
      request: {
        audience: "custom",
        topic_ids: ["ai", "tech", "world"],
        length_minutes: 10,
        format: "discussion",
        window_days: 30,
        tone: "dry",
        voice_id: null,
        voice_id_b: null,
        title: "My week in AI",
      },
    });

    // The form stays; the progress is a line in the indicator, which says so in words.
    const card = page.locator("[data-run-card]");
    const text = page.locator("[data-run-text]");
    await expect(card).toBeVisible();
    await expect(page.locator("[data-create-form]")).toBeVisible();
    await expect(text).toHaveText("Waiting to start");

    await page.clock.runFor(4000);
    await expect(text).toHaveText("Waiting to start");
    await page.clock.runFor(4000);
    await expect(text).toHaveText("Writing your episode");
    await page.clock.runFor(4000);
    await expect(text).toHaveText("Episode ready");
    expect(asked).toEqual(["4242", "4242", "4242"]);
    await expect(page.getByRole("link", { name: "Open Library" })).toHaveAttribute(
      "href",
      "/library",
    );

    // Once finished it can be dismissed, and then it is gone.
    await page.getByRole("button", { name: "Dismiss" }).click();
    await expect(card).toBeHidden();
  });

  test("names each stage, fills the bar, and waits for the new page", async ({ page }) => {
    await page.clock.install();
    await mockPodcast(page, 202, { status: 202, run_id: 7, started_at: "2026-10-07T12:00:00Z" });
    const stages = [
      { run_id: 7, state: "running", step: null, stage: 0, stages: 3, label: "Getting ready" },
      { run_id: 7, state: "running", step: null, stage: 1, stages: 3, label: "Making the episode" },
      {
        run_id: 7,
        state: "completed",
        step: null,
        stage: 2,
        stages: 3,
        label: "Updating the site",
        outcome: "published",
      },
    ];
    let asked = 0;
    await page.route("**/api/status?**", (route) => {
      const body = stages[Math.min(asked, stages.length - 1)];
      asked += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    let live = false;
    await page.route(/latest.json/, (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          episode_at: live
            ? new Date(Date.now() + 3_600_000).toISOString()
            : "2020-01-01T00:00:00Z",
          episode_id: "ep-new",
        }),
      });
    });
    await openCreate(page);
    await openDialog(page);
    await confirm(page);
    const text = page.locator("[data-run-text]");
    const card = page.locator("[data-run-card]");
    await expect(text).toHaveText("Waiting to start");
    await page.clock.runFor(4000);
    await expect(text).toHaveText("Getting ready");
    await page.clock.runFor(4000);
    await expect(text).toHaveText("Making the episode");
    // The bar is a share of the whole, never past the start of the next stage.
    const share = () => card.evaluate((el) => Number(el.style.getPropertyValue("--run-to")));
    expect(await share()).toBeGreaterThanOrEqual(1 / 3);
    expect(await share()).toBeLessThan(2 / 3);
    await page.clock.runFor(4000);
    await expect(text).toHaveText("Updating the site");
    live = true;
    await expect(async () => {
      await page.clock.runFor(10_000);
      await expect(text).toHaveText("Episode ready", { timeout: 500 });
    }).toPass();
    await expect(page.locator("[data-run-library]")).toHaveAttribute("href", "/e/ep-new");
    await expect(page.locator("[data-run-library]")).toHaveText("Open episode");
  });

  test("a failed run names the stage it stopped in", async ({ page }) => {
    await page.clock.install();
    await mockPodcast(page, 202, { status: 202, run_id: 8, started_at: "2026-10-07T12:00:00Z" });
    await page.route("**/api/status?**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          run_id: 8,
          state: "completed",
          step: null,
          stage: 1,
          stages: 3,
          label: "Making the episode",
          outcome: "failed",
          run_url: "https://example.com/run",
        }),
      }),
    );
    await openCreate(page);
    await openDialog(page);
    await confirm(page);
    await page.clock.runFor(4000);
    await expect(page.locator("[data-run-text]")).toHaveText(
      "Stopped while making the episode. Try again later.",
    );
  });

  test("tells a failed run apart from a started one", async ({ page }) => {
    await page.clock.install();
    await mockPodcast(page, 202, { status: 202, run_id: 9, started_at: "2026-10-07T12:00:00Z" });
    await page.route("**/api/status?**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ run_id: 9, state: "completed", step: null, outcome: "failed" }),
      }),
    );
    await openCreate(page);
    await openDialog(page);
    await confirm(page);
    await expect(page.locator("[data-run-card]")).toBeVisible();
    await page.clock.runFor(4000);
    await expect(page.locator("[data-run-text]")).toHaveText(
      "The episode could not be written. Try again later.",
    );
    await expect(page.getByRole("link", { name: "Open Library" })).toBeHidden();
  });
});

test.describe("the Create panel's voices", () => {
  test("a readout has one voice select, a discussion adds a second, and both are sent", async ({
    page,
  }) => {
    const mock = await mockPodcast(page, 202, { status: 202, run_id: 7, started_at: "now" });
    await openCreate(page);
    const ada = page.locator('select[name="voice"]');
    const leo = page.locator('select[name="voice_b"]');
    const hint = page.locator("[data-format-hint]");
    await expect(ada).toHaveAccessibleName("Voice");
    await expect(hint).toHaveText("Read in one voice.");
    await expect(ada.locator("option")).toHaveText([
      "Default",
      // Each voice leads with the flag of its accent: en-US, en-US, en-GB.
      "\u{1F1FA}\u{1F1F8} Ada, female",
      "\u{1F1FA}\u{1F1F8} Leo, male",
      "\u{1F1EC}\u{1F1E7} Nora, female",
    ]);
    await expect(ada).toBeVisible();
    await expect(leo).toBeHidden();
    await segment(page, "Discussion").click();
    await expect(leo).toBeVisible();
    // A discussion is two hosts, each with a voice, and the line under the format says so.
    await expect(page.locator("#create-voice-label")).toHaveText("Voices");
    await expect(ada).toHaveAccessibleName("First host's voice");
    await expect(leo).toHaveAccessibleName("Second host's voice");
    await expect(hint).toHaveText("Two hosts talk it through, in two voices.");
    await ada.selectOption("voice-ada");
    await leo.selectOption("voice-leo");
    await expect(hint).toHaveText("Two hosts talk it through, voiced by Ada and Leo.");
    await openDialog(page);
    await confirm(page);
    await expect.poll(() => mock.bodies.length).toBe(1);
    expect(mock.bodies[0]?.request).toMatchObject({
      format: "discussion",
      voice_id: "voice-ada",
      voice_id_b: "voice-leo",
    });
  });

  test("Default names the voice it stands for, in each host's place", async ({ page }) => {
    await page.route("**/api/voices", (route) =>
      route.fulfill({
        json: {
          voices: [
            {
              id: "voice-ada",
              name: "Ada",
              gender: "female",
              language: "en-US",
              preview_url: null,
            },
            { id: "voice-leo", name: "Leo", gender: "male", language: "en-US", preview_url: null },
          ],
          defaults: { voice: "voice-ada", voice_b: "voice-leo" },
        },
      }),
    );
    await openCreate(page);
    const first = page.locator('select[name="voice"] option').first();
    await expect(first).toHaveText("\u{1F1FA}\u{1F1F8} Default (Ada)");
    await expect(page.locator("[data-format-hint]")).toHaveText("Read by Ada.");
    await segment(page, "Discussion").click();
    await expect(page.locator('select[name="voice_b"] option').first()).toHaveText(
      "\u{1F1FA}\u{1F1F8} Default (Leo)",
    );
    await expect(page.locator("[data-format-hint]")).toHaveText(
      "Two hosts talk it through, voiced by Ada and Leo.",
    );
  });

  test("a readout sends no second voice", async ({ page }) => {
    const mock = await mockPodcast(page, 202, { status: 202, run_id: 7, started_at: "now" });
    await openCreate(page);
    await page.locator('select[name="voice"]').selectOption("voice-nora");
    await openDialog(page);
    await confirm(page);
    await expect.poll(() => mock.bodies.length).toBe(1);
    const request = mock.bodies[0]?.request as Record<string, unknown>;
    expect(request.voice_id).toBe("voice-nora");
    expect(request).not.toHaveProperty("voice_id_b");
  });
});

test.describe("the Create page when the server says no", () => {
  // A 4xx or a dropped request is logged by the browser as a failed load; here it is the point.
  test.use({ allowNetworkErrors: true });

  test("leaves the title out when it is empty, and sends no title key", async ({ page }) => {
    const mock = await mockPodcast(page, 400, { status: 400, error: "invalid_request" });
    await openCreate(page);
    await openDialog(page);
    await confirm(page);
    await expect.poll(() => mock.bodies.length).toBe(1);
    expect(mock.bodies[0]?.request).toEqual({
      audience: "custom",
      topic_ids: ["design", "ui-craft", "ai", "tech"],
      length_minutes: 5,
      format: "readout",
      window_days: 7,
      tone: "neutral",
      voice_id: null,
    });
  });

  test("says a wrong passphrase in words and keeps the dialog open", async ({ page }) => {
    test.skip(!PASSPHRASE_REQUIRED, PASSPHRASE_OFF);
    await mockPodcast(page, 401, { status: 401, error: "wrong_passphrase" });
    await openCreate(page);
    await openDialog(page);
    await dialog(page).getByLabel("Passphrase").fill("not it");
    await dialog(page).getByRole("button", { name: "Create episode" }).click();
    await expect(dialog(page).getByRole("alert")).toHaveText(
      "That passphrase does not match. Check it and try again.",
    );
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator("[data-run-card]")).toBeHidden();
    // The wrong one is not kept.
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBeNull();
  });

  test("names each refusal in words, on the page, and closes the dialog", async ({ page }) => {
    const cases: Array<[number, unknown, string]> = [
      [
        429,
        { status: 429, error: "cooldown", retry_after_s: 100 },
        "You can make another episode in 2 minutes.",
      ],
      [
        429,
        { status: 429, error: "daily_cap", retry_after_s: 3 * 3600 },
        "That's today's limit. Try again in 3 hours.",
      ],
      [
        503,
        { status: 503, error: "unavailable" },
        "Episodes are not available right now. Try again in a few minutes.",
      ],
      [
        400,
        { status: 400, error: "invalid_request" },
        "That request did not go through. Reload the page and try again.",
      ],
    ];
    await openCreate(page);
    for (const [status, body, words] of cases) {
      await page.unroute("**/api/podcast");
      await mockPodcast(page, status, body);
      await page.locator("[data-submit]").click();
      await confirm(page);
      await expect(dialog(page)).toBeHidden();
      await expect(page.locator('[data-error="form"]')).toHaveText(words);
      await expect(page.locator("[data-create-form]")).toBeVisible();
      await expect(page.locator("[data-run-card]")).toBeHidden();
    }
  });

  test("says so when the request cannot be sent", async ({ page }) => {
    await page.route("**/api/podcast", (route) => route.abort("failed"));
    await openCreate(page);
    await openDialog(page);
    await confirm(page);
    await expect(page.locator('[data-error="form"]')).toHaveText(
      "The request did not go through. Check your connection, then try again.",
    );
  });

  test("keeps the passphrase on this device only when asked, and offers it next time", async ({
    page,
  }) => {
    test.skip(!PASSPHRASE_REQUIRED, PASSPHRASE_OFF);
    await mockPodcast(page, 202, { status: 202, run_id: 7, started_at: "2026-10-07T12:00:00Z" });
    await page.route("**/api/status?**", (route) =>
      route.fulfill({ status: 404, contentType: "application/json", body: "{}" }),
    );
    await openCreate(page);
    await openDialog(page);
    await dialog(page).getByLabel("Passphrase").fill(PASSPHRASE);
    await dialog(page).getByLabel("Remember on this device").check();
    await dialog(page).getByRole("button", { name: "Create episode" }).click();
    await expect(page.locator("[data-run-card]")).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)).toBe(PASSPHRASE);

    // A page that cannot follow the run still says the episode was started.
    await expect(page.locator("[data-run-text]")).toHaveText("Episode started", {
      timeout: 15_000,
    });

    await page.reload();
    await openDialog(page);
    await expect(dialog(page).getByLabel("Passphrase")).toHaveValue(PASSPHRASE);
    await expect(dialog(page).getByLabel("Remember on this device")).toBeChecked();
  });
});

test.describe("navigation with three destinations and one action", () => {
  test("fits at 320px, every item a full target, and marks the Library as current on Create", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await openCreate(page);
    const items = page.locator(".app-nav-item");
    await expect(items).toHaveText(["Today", "Library", "Settings"]);
    const boxes = await items.evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        const label = node.querySelector("span");
        const text = label?.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          width: box.width,
          height: box.height,
          textWidth: text?.width ?? 0,
          clipped: label ? label.scrollWidth > label.clientWidth : false,
        };
      }),
    );
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(320);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.textWidth).toBeLessThanOrEqual(box.width);
      expect(box.clipped).toBe(false);
    }
    for (let index = 1; index < boxes.length; index += 1) {
      expect(boxes[index]?.left ?? 0).toBeGreaterThanOrEqual((boxes[index - 1]?.right ?? 0) - 0.5);
    }
    // Create sits under the Library, where episodes are kept.
    await expect(page.locator('.app-nav-item[aria-current="page"]')).toHaveText("Library");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  });

  test("below 64rem the Create page leads back to the Library", async ({ page }, info) => {
    test.skip(info.project.name === "desktop", "the app bar is for narrower screens");
    await page.goto("/create");
    const back = page.locator(".app-bar-back");
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute("href", "/library");
    await back.click();
    await expect(page).toHaveURL(/\/library$/);
  });

  test("the deep link /create is the page, with the form in it and the Create button beside the list", async ({
    page,
  }) => {
    await openCreate(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("New episode");
    // The page has the form itself, so it carries no sheet to clone.
    await expect(page.locator("#create-sheet-template")).toHaveCount(0);
    await chip(page, "AI").click();
    await expect(page.locator('input[name="topic"]:checked')).toHaveCount(2);
  });
});

test.describe("episodes in the Library", () => {
  test("show beside the briefings, say their format and length, and have a filter", async ({
    page,
  }) => {
    await page.goto("/library");
    const cards = page.locator("[data-card]");
    await expect(cards).toHaveCount(5);
    const episode = page.locator('[data-card][data-kind="episode"]', {
      hasText: "Quiet interfaces and fast latency",
    });
    await expect(episode.locator(".card-title")).toHaveText("Quiet interfaces and fast latency");
    await expect(episode.locator(".card-facts")).toHaveText("Discussion \u00b7 5 min");
    await expect(
      page
        .locator('[data-card][data-kind="episode"]', { hasText: "AI headlines" })
        .locator(".card-facts"),
    ).toHaveText("Readout \u00b7 3 min");

    const show = page.getByRole("combobox", { name: "Show" });
    await expect(show).toHaveValue("all");
    await show.selectOption("custom");
    await expect(show).toHaveValue("custom");
    await expect(page.locator("[data-card]:not([hidden])")).toHaveCount(2);
    await expect(page.locator("[data-library-status]")).toHaveText("2 of 5 results");

    // The other filters leave episodes out.
    await show.selectOption("daily");
    await expect(page.locator("[data-card]:not([hidden])")).toHaveCount(2);
    await expect(page.locator('[data-card][data-kind="episode"]:not([hidden])')).toHaveCount(0);

    // Search finds an episode by a story it covers.
    await show.selectOption("all");
    // Search finds an episode by its title, on one line like a story.
    await page.getByRole("searchbox").fill("interfaces and fast");
    await expect(page.locator("[data-card]:not([hidden])")).toHaveCount(1);
    await expect(page.locator("[data-card]:not([hidden])")).toHaveAttribute("data-kind", "episode");
    await page.getByRole("searchbox").fill("no such story");
    await expect(page.locator("[data-card]:not([hidden])")).toHaveCount(0);
    await expect(page.locator("[data-library-empty]")).toBeVisible();
  });

  test("open the episode page from a card", async ({ page }) => {
    await page.goto("/library");
    await page.getByRole("link", { name: /Quiet interfaces and fast latency/ }).click();
    await expect(page).toHaveURL(new RegExp(`${EPISODE}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Quiet interfaces and fast latency",
    );
    await expect(page.locator('.app-nav-item[aria-current="page"]')).toHaveText("Library");
  });
});

test.describe("an episode page", () => {
  test("shows the title, the play chip with the date, and the highlights", async ({ page }) => {
    await page.goto(EPISODE);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Quiet interfaces and fast latency",
    );
    // The format and the date stand under the title; the length is the chip's label, said once.
    await expect(page.locator(".hero-text .hero-facts > span")).toHaveText([
      "Discussion",
      "7 October",
    ]);
    await expect(page.locator(".hero .cover img")).toHaveAttribute(
      "srcset",
      new RegExp(EPISODE_ID),
    );
    await expect(page.locator(".hero [data-play-digest]")).toHaveAttribute(
      "data-play-digest",
      EPISODE_ID,
    );
    // The script is read in the player, not on the page.
    await expect(page.locator(".episode-turn")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: "Script" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: "Stories" })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 2, name: "Highlights" })).toBeVisible();
  });

  test("each highlight has its headline, what was said, and the link to the source", async ({
    page,
  }) => {
    await page.goto(EPISODE);
    const rows = page.locator(".episode-highlight");
    await expect(rows).toHaveCount(2);
    // The headline is the link to the source, named by its words, and says it opens a new tab.
    const link = rows.nth(0).locator(".episode-highlight-title a");
    await expect(link).toHaveAccessibleName(
      "Why a quiet interface needs one loud detail (opens in a new tab)",
    );
    // What the hosts said about it, from the script: no speaker names.
    await expect(rows.nth(0).locator(".episode-highlight-text")).toContainText(
      "Start with emphasis.",
    );
    await expect(link).toHaveAttribute("href", "https://example.com/dispatch-fixture/f0a17c2d6b83");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // The publisher's host as attribution, and never the name of the service that found it. It is
    // the same destination, so only the headline is in the tab order.
    const host = rows.nth(0).locator(".source-link");
    await expect(host.locator(":scope > span").first()).toHaveText("example.com");
    await expect(host).toHaveAttribute("href", "https://example.com/dispatch-fixture/f0a17c2d6b83");
    await expect(host).toHaveAttribute("tabindex", "-1");
    await expect(page.locator("body")).not.toContainText("Exa discovery");
  });

  test("hands the player the data a briefing hands it: the episode, its stories, one section", async ({
    page,
  }) => {
    await page.goto(EPISODE);
    const data = await page.locator("#dispatch-digest-data").evaluate((node) => {
      return JSON.parse(node.textContent ?? "null");
    });
    expect(data).toMatchObject({
      id: EPISODE_ID,
      title: "Quiet interfaces and fast latency",
      audio: null,
      sections: [{ slug: "top", title: "Stories" }],
    });
    expect(data.items.map((item: { id: string }) => item.id)).toEqual([
      "f0a17c2d6b83",
      "6d3b8e0f94a1",
    ]);
  });
});

test.describe("axe, the Create page and episodes", () => {
  for (const scheme of ["light", "dark"] as const) {
    test(`Create has no WCAG 2.2 AA violations, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openCreate(page);
      await page.evaluate(() => document.fonts.ready);
      expect(await violations(page)).toEqual([]);
    });

    test(`Create with a topic chosen and an error showing has none, ${scheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openCreate(page);
      await clearTopics(page);
      await page.locator("[data-submit]").click();
      await expect(page.locator('[data-error="topics"]')).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await chip(page, "World").click();
      await chip(page, "Design").click();
      await page.waitForTimeout(300);
      expect(await violations(page)).toEqual([]);
    });

    test(`an episode page has none, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(EPISODE);
      await page.evaluate(() => document.fonts.ready);
      expect(await violations(page)).toEqual([]);
    });

    test(`the Library with episodes has none, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/library");
      await page.evaluate(() => document.fonts.ready);
      expect(await violations(page)).toEqual([]);
    });
  }
});

test.describe("axe, the passphrase dialog", () => {
  test.skip(!PASSPHRASE_REQUIRED, PASSPHRASE_OFF);

  // The dialog shows a 401, which the browser logs as a failed load.
  test.use({ allowNetworkErrors: true });

  for (const scheme of ["light", "dark"] as const) {
    test(`the passphrase dialog, with its error, has none, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await mockPodcast(page, 401, { status: 401, error: "wrong_passphrase" });
      await openCreate(page);
      await openDialog(page);
      await dialog(page).getByLabel("Passphrase").fill("nope");
      await dialog(page).getByRole("button", { name: "Create episode" }).click();
      await expect(dialog(page).getByRole("alert")).toBeVisible();
      await page.waitForTimeout(400);
      expect(await violations(page)).toEqual([]);
    });
  }
});
