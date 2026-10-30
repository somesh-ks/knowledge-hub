import type { Page } from "@playwright/test";
import { expect, hydrated, seedStorage, test } from "./fixtures";

/** The rows on screen: the dock's below 64rem, the popover's above it. */
const rows = (page: Page) => page.locator("[data-queue-row-item]:visible");
const rowOf = (page: Page, id: number) =>
  page.locator(`[data-queue-row-item][data-run="${id}"]:visible`);

const row = (run_id: number, over: Record<string, unknown> = {}) => ({
  run_id,
  what: "episode",
  kind: "catch_up",
  target: null,
  state: "running",
  started_at: new Date().toISOString(),
  stage: 1,
  stages: 6,
  label: "Writing the script",
  ...over,
});

/** The routes the queue talks to: GET /api/generations (the rows it is given) and POST /api/cancel. */
async function mock(
  page: Page,
  generations: () => unknown[],
  cancel: { status: number } = { status: 202 },
): Promise<Array<Record<string, unknown>>> {
  const cancelled: Array<Record<string, unknown>> = [];
  await page.route("**/api/generations", (route) =>
    route.fulfill({ status: 200, json: { generations: generations() } }),
  );
  await page.route("**/api/cancel", async (route) => {
    cancelled.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({ status: cancel.status, json: { run_id: cancelled.length } });
  });
  return cancelled;
}

/** This browser follows run 41, as after a tap on Catch up; the queue is drawn from that record. */
async function follow(page: Page, status: Record<string, unknown> | null = null): Promise<void> {
  await page.route("**/api/status?**", (route) =>
    route.fulfill({
      status: 200,
      json: status ?? {
        run_id: 41,
        state: "running",
        step: null,
        stage: 1,
        stages: 6,
        label: "Writing the script",
      },
    }),
  );
  await seedStorage(page, {
    local: {
      "singularity:run": JSON.stringify({ id: 41, phase: "running", t0: Date.now() }),
      // Runs 41 and 42 were started in this browser (D242); a run without a token is another device's.
      "singularity:cancel-tokens": JSON.stringify({ "41": "token-41", "42": "token-42" }),
    },
  });
}

/** Opens the queue as the screen has it: the dock's head below 64rem, the side column's row above. */
async function openQueue(page: Page): Promise<void> {
  const wide = (page.viewportSize()?.width ?? 0) >= 1024;
  await page.locator(wide ? "[data-queue-trigger]" : "[data-queue-toggle]").click();
}

// The 2026-10-29 owner ask: what is being made is a queue, as a browser lists downloads: a dock above
// the navigation on a phone, a row in the side column that opens a popover on a desktop. It shows only
// while something is being made (a Catch up or a regeneration), and nothing in a row moves as it goes.
test.describe("the podcast queue", () => {
  test("a Catch up on record folds to one row, opens to its rows, and Cancel stops only a run started here", async ({
    page,
  }) => {
    // The weekly's own cover is not in the test site: a one-pixel image answers.
    await page.route("**/covers/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
          "base64",
        ),
      }),
    );
    const cancelled = await mock(page, () => [
      row(41),
      row(42, {
        what: "briefing",
        kind: "regenerate",
        target: "2026-10-11-weekly",
        stages: 7,
        stage: 3,
      }),
      // Another device's run: listed, but this browser holds no token to stop it with.
      row(43),
    ]);
    await follow(page);
    await page.goto("/library");
    await hydrated(page);
    await openQueue(page);
    await expect(rows(page)).toHaveCount(3);
    await expect(rowOf(page, 43).getByRole("button", { name: /^Cancel/ })).toHaveCount(0);

    await rowOf(page, 42)
      .getByRole("button", { name: /^Cancel/ })
      .click();
    await expect.poll(() => cancelled.length).toBe(1);
    expect(cancelled[0]).toEqual({ run_id: 42, cancel_token: "token-42" });
    await expect(rowOf(page, 42)).toBeHidden();
    await expect(rowOf(page, 41)).toBeVisible();
  });

  test("@desktop the side column's row opens the popover with the same rows", async ({ page }) => {
    await mock(page, () => [row(41)]);
    await follow(page);
    await page.goto("/library");
    await hydrated(page);
    await expect(page.locator("[data-queue-trigger]")).toBeVisible();
    await expect(page.locator("[data-queue-dock]")).toBeHidden();
    await openQueue(page);
    await expect(page.getByRole("dialog", { name: "Podcast queue" })).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
  });

  test.describe("when GitHub refuses", () => {
    // The browser logs the 503 on the page's behalf; the page takes it as a refusal, not a fault.
    test.use({ allowNetworkErrors: true });

    test("a Cancel that fails keeps the row and says why", async ({ page }) => {
      const cancelled = await mock(page, () => [row(41)], { status: 503 });
      await follow(page);
      await page.goto("/library");
      await hydrated(page);
      await openQueue(page);

      await rows(page)
        .first()
        .getByRole("button", { name: /^Cancel/ })
        .click();
      await expect.poll(() => cancelled.length).toBe(1);
      await expect(rows(page).first().locator("[data-queue-status]")).toHaveText(
        "Couldn't cancel. Try again.",
      );
      await expect(rows(page)).toHaveCount(1);
    });
  });

  // The 2026-10-29 ask: Cancel goes once the voices are being recorded (stopping then loses the spend).
  test("Cancel is gone once the voices are being recorded", async ({ page }) => {
    let list = [row(41, { stage: 1 })];
    await mock(page, () => list);
    await follow(page);
    await page.goto("/library");
    await hydrated(page);
    await openQueue(page);
    await expect(
      rows(page)
        .first()
        .getByRole("button", { name: /^Cancel/ }),
    ).toBeVisible();

    list = [row(41, { stage: 4, label: "Recording voices" })];
    await expect(rows(page).first().locator("[data-queue-status]")).toHaveText("Recording voices", {
      timeout: 15_000,
    });
    await expect(
      rows(page)
        .first()
        .getByRole("button", { name: /^Cancel/ }),
    ).toBeHidden();
  });

  // Owner: "nothing in a row may move when the stage, time left or percent changes".
  test("a row keeps its height while its stage and its time left change @both", async ({
    page,
  }) => {
    let list = [row(41, { stage_estimates_ms: [10_000, 240_000, 10_000, 10_000, 30_000, 40_000] })];
    await mock(page, () => list);
    await follow(page);
    await page.goto("/library");
    await hydrated(page);
    await openQueue(page);
    await expect(rows(page)).toHaveCount(1);
    const height = () =>
      rows(page)
        .first()
        .evaluate((node) => (node as HTMLElement).offsetHeight);
    const before = await height();

    list = [
      row(41, {
        stage: 0,
        label: "Gathering stories from your sources",
        stage_estimates_ms: [600_000, 240_000, 10_000, 10_000, 30_000, 40_000],
      }),
    ];
    await expect(rows(page).first().locator("[data-queue-status]")).toContainText(
      "Gathering stories",
      {
        timeout: 15_000,
      },
    );
    expect(await height()).toBe(before);
  });

  test("a run that was cancelled stays as Cancelled for the day, with nothing to try again", async ({
    page,
  }) => {
    await mock(page, () => []);
    await follow(page, { run_id: 41, state: "completed", step: null, outcome: "cancelled" });
    await page.goto("/library");
    await hydrated(page);
    await openQueue(page);
    await expect(rows(page).first().locator("[data-queue-status]")).toContainText("Cancelled", {
      timeout: 15_000,
    });
    await expect(rows(page).first().getByRole("button", { name: "Try again" })).toBeHidden();
    await page.reload();
    await hydrated(page);
    await openQueue(page);
    await expect(rows(page)).toHaveCount(1);
  });

  // The 2026-10-29 owner ask: what was made today stays in the queue, whose title never changes, and
  // the ring has become Start listening. There is no Clear queue: the day's list goes when the day does.
  test("a podcast made today stays across a reload and opens from Start listening", async ({
    page,
  }) => {
    await mock(page, () => []);
    const now = Date.now();
    await seedStorage(page, {
      local: {
        "singularity:run": JSON.stringify({
          id: 41,
          phase: "done",
          what: "briefing",
          kind: "regenerate",
          episode: "2026-10-07",
          href: "/d/2026-10-07",
          t0: now - 120_000,
          stageAt: now - 60_000,
        }),
      },
    });
    await page.goto("/library");
    await hydrated(page);
    const wide = (page.viewportSize()?.width ?? 0) >= 1024;
    const folded = page.locator(wide ? "[data-queue-trigger-title]" : "[data-queue-title]");
    await expect(folded).toHaveText("Podcast queue");
    await page.reload();
    await hydrated(page);
    await expect(folded).toHaveText("Podcast queue");

    await openQueue(page);
    const listen = page
      .getByRole("link", { name: /^Start listening/ })
      .and(page.locator(":visible"));
    await expect(listen).toHaveAttribute("href", "/d/2026-10-07");
    await expect(page.getByRole("button", { name: "Clear queue" })).toHaveCount(0);
  });

  // The 2026-10-29 owner ask: the row's line is one line, and Details holds the whole story with a
  // snippet to copy.
  test("a failed run's Details says what went wrong and copies the facts of the run", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await mock(page, () => []);
    const now = Date.now();
    await seedStorage(page, {
      local: {
        "singularity:run": JSON.stringify({
          id: 43,
          phase: "failed",
          what: "briefing",
          kind: "regenerate",
          episode: "2026-10-09",
          step: "writing",
          log: "https://github.com/somesh-ks/knowledge-hub/actions/runs/43",
          t0: now - 120_000,
          stageAt: now - 60_000,
        }),
      },
    });
    await page.goto("/library");
    await hydrated(page);
    // A failed run opens the phone's dock by itself; the desktop's popover is opened from the side column.
    if ((page.viewportSize()?.width ?? 0) >= 1024) await openQueue(page);
    else await expect(page.locator("[data-queue-dock]")).toHaveAttribute("data-expanded", "");
    await rows(page).first().getByRole("button", { name: "Details" }).click();
    const dialog = page.getByRole("dialog", { name: "What went wrong" });
    await expect(dialog).toContainText("Run: 43");
    await expect(dialog.getByRole("link", { name: "Open the log" })).toBeVisible();
    await dialog.getByRole("button", { name: "Copy details" }).click();
    await expect(dialog.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Run: 43");
  });
});
