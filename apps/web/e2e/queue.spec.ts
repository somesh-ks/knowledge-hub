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

/**
 * One glyph, one meaning (lib/queueIcons.ts). A row never shows the same glyph twice, and no glyph that
 * is an action's (the X) stands in a leading slot or in the folded head, where only a state can be.
 * Owner, 2026-11-05: a cancelled run showed an X at its start, another in the head and the X that
 * removes it, because Cancelled was drawn with Close. Checks the rendered rows, so a new state or
 * action is held to it too.
 */
async function expectOneMeaningPerGlyph(page: Page): Promise<void> {
  const found = await page.evaluate(() => {
    const names = (scope: ParentNode) =>
      [...scope.querySelectorAll<SVGElement>("svg[data-icon]:not([data-leaving])")]
        .filter((svg) => svg.getClientRects().length > 0)
        .map((svg) => svg.dataset.icon ?? "");
    const rows = [...document.querySelectorAll<HTMLElement>("[data-queue-row-item]")].filter(
      (row) => row.getClientRects().length > 0,
    );
    const twice = rows.flatMap((row) => {
      const glyphs = names(row);
      return glyphs.filter((glyph, at) => glyphs.indexOf(glyph) !== at);
    });
    const states = [
      ...document.querySelectorAll(".queue-lead, .queue-ring-head, .queue-end-icon"),
    ].flatMap((slot) => names(slot).filter((glyph) => glyph === "close"));
    return { twice, states, seen: rows.length };
  });
  expect(found.seen).toBeGreaterThan(0);
  expect(found.twice).toEqual([]);
  expect(found.states).toEqual([]);
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
    // The title shimmers while the popover is closed and rests once it opens. Its timing lived only
    // inside the popover, so the side column's word never moved (owner, 2026-11-04).
    const sheen = () =>
      page
        .locator("[data-queue-trigger-title]")
        .evaluate((word) => word.getAnimations().some((a) => a.playState === "running"));
    await expect.poll(sheen).toBe(true);
    await openQueue(page);
    await expect(page.getByRole("dialog", { name: "Podcast queue" })).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
    await expect.poll(sheen).toBe(false);
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

  // Bugs it prevents (owner, 2026-11-04): the Catch up button shook as the queue grew, and the list showed
  // whole rows with nothing to say that more were below. Phone only: the dock is below 64rem. (The swipe
  // that scrolled the page behind the dock cannot be driven in the test browser: it never scrolls.)
  test("the opened queue rises over the page without moving the Catch up button, and its list is cut mid-row", async ({
    page,
    hasTouch,
  }) => {
    test.skip(!hasTouch, "the dock is a phone's");
    const ids = [41, 42, 43, 44, 45, 46];
    await mock(page, () => ids.map((id) => row(id)));
    await follow(page);
    await page.goto("/library");
    await hydrated(page);
    await expect(page.locator("[data-queue-toggle]")).toBeVisible();
    // What stands on the page holds still: the Catch up button's box is the same box once the dock is open.
    const button = page.locator(".create-fab");
    const dockTop = () =>
      page.locator(".queue-dock").evaluate((node) => node.getBoundingClientRect().top);
    await expect(button).toBeVisible();
    const [boxFolded, topFolded] = [await button.boundingBox(), await dockTop()];

    await openQueue(page);
    await expect(rows(page).first()).toBeVisible();
    await expect.poll(dockTop).toBeLessThan(topFolded);
    expect(await button.boundingBox()).toEqual(boxFolded);

    // The list scrolls, and the row where it is cut off shows only part of itself: the cue that there is
    // more. Read once the opening has settled.
    const list = page.locator(".queue-dock .queue-list");
    await expect
      .poll(() =>
        list.evaluate((node) => {
          const bottom = node.getBoundingClientRect().bottom;
          const cut = [...node.querySelectorAll<HTMLElement>("[data-queue-row-item]")].filter(
            (item) => {
              const box = item.getBoundingClientRect();
              return box.top < bottom - 1 && box.bottom > bottom + 1;
            },
          );
          return node.scrollHeight > node.clientHeight && cut.length === 1;
        }),
      )
      .toBe(true);
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
    await expectOneMeaningPerGlyph(page);
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
    await expectOneMeaningPerGlyph(page);
  });

  // The 2026-11-02 owner ask: a podcast that has played has done its job in the queue, and with no row
  // left the dock is gone; a row's own X takes that one out by hand. Both hold across a reload.
  test("a played podcast leaves the queue, a row's own X takes out that one, and both stay gone after a reload", async ({
    page,
  }) => {
    await mock(page, () => []);
    // Midday UTC is the same calendar day in every zone, so the seeded rows are today's whenever this runs.
    const midday = new Date("2026-11-02T12:00:00Z");
    await page.clock.setFixedTime(midday);
    const now = midday.getTime();
    const done = (id: number, episode: string) => ({
      at: now - 60_000,
      run: {
        id,
        phase: "done",
        what: "briefing",
        kind: "regenerate",
        episode,
        href: `/d/${episode}`,
        t0: now - 120_000,
        stageAt: now - 60_000,
      },
    });
    await seedStorage(page, {
      local: {
        "singularity:queue-day": JSON.stringify([done(41, "2026-10-07"), done(42, "2026-10-05")]),
      },
    });
    await page.goto("/library");
    await hydrated(page);
    await openQueue(page);
    const rows = page.locator("[data-queue-dock] [data-queue-row-item]");
    await expect(rows).toHaveCount(2);
    // A podcast starting anywhere (the player says so on the page) lets its row go; the other stays.
    await page.evaluate(() =>
      document.dispatchEvent(
        new CustomEvent("singularity:started", { detail: { id: "2026-10-07" } }),
      ),
    );
    await expect(rows).toHaveCount(1);
    // The X on the row takes that one out, and with nothing left the dock is gone.
    await rows
      .first()
      .getByRole("button", { name: /^Remove .* from the queue$/ })
      .click();
    await expect(page.locator("[data-queue-dock]")).toBeHidden();
    await page.reload();
    await hydrated(page);
    await expect(page.locator("[data-queue-dock]")).toBeHidden();
  });

  // The 2026-10-29 owner ask: the row's line is one line, and Details holds the whole story with a
  // snippet to copy.
  // Owner, 2026-11-05: Try again on a failed run made the dock vanish and come back. The dock rises in
  // only for a run that brought it in (data-arriving, 0 to 1 opacity after a pause); a run started while
  // it was up used to run that rise again.
  test("Try again on a failed run keeps the dock up while the new run starts", async ({
    page,
    hasTouch,
  }) => {
    test.skip(!hasTouch, "the dock is a phone's");
    let started = false;
    await mock(page, () => (started ? [row(44)] : []));
    await page.route("**/api/podcast", (route) => {
      started = true;
      return route.fulfill({ status: 202, json: { run_id: 44, cancel_token: "token-44" } });
    });
    await page.route("**/api/status?**", (route) =>
      route.fulfill({
        status: 200,
        json: { run_id: 44, state: "running", step: null, stage: 1, stages: 6, label: "Writing" },
      }),
    );
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
          retry: { body: { replace: "2026-10-09", feedback: "a bit longer" } },
          t0: now - 120_000,
          stageAt: now - 60_000,
        }),
      },
    });
    await page.goto("/library");
    await hydrated(page);
    const dock = page.locator("[data-queue-dock]");
    await expect(dock).toHaveAttribute("data-expanded", "");
    const again = rows(page).first().getByRole("button", { name: "Try again" });
    await expect(again).toBeVisible();
    await again.click();
    // The dock's opacity is read on every frame while the new run replaces the failed one.
    const lowest = await dock.evaluate(
      (node) =>
        new Promise<number>((done) => {
          const t0 = performance.now();
          let low = 1;
          const tick = () => {
            low = Math.min(
              low,
              (node as HTMLElement).hidden ? 0 : Number(getComputedStyle(node).opacity),
            );
            if (performance.now() - t0 < 900) requestAnimationFrame(tick);
            else done(low);
          };
          tick();
        }),
    );
    expect(lowest).toBe(1);
    await expect(rowOf(page, 44)).toBeVisible();
    await expect(dock).toHaveAttribute("data-expanded", "");
  });

  // Owner, 2026-11-05: the shimmer jumped on its first frame and again at the end of every loop. The
  // gradient is a tile 2.5 widths wide, so a loop that travels any other distance ends where it did not begin.
  test("the title's shimmer starts on the clock and its loop ends where it began", async ({
    page,
    hasTouch,
  }) => {
    test.skip(!hasTouch, "the dock is a phone's");
    await page.addInitScript(() => {
      const first: { current?: number; timeline?: number } = {};
      (window as unknown as { __first: typeof first }).__first = first;
      const tick = () => {
        const word = document.querySelector("[data-queue-title][data-live]");
        const sheen = word
          ?.getAnimations()
          .find((a) => (a as CSSAnimation).animationName === "queue-sheen");
        if (sheen && first.current === undefined) {
          first.current = Number(sheen.currentTime);
          first.timeline = Number(document.timeline.currentTime);
        } else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await mock(page, () => [row(41)]);
    await follow(page);
    await page.goto("/library");
    await hydrated(page);
    await expect(page.locator("[data-queue-title][data-live]")).toBeVisible();
    // Its first frame already sits at the clock, not at the animation's own zero.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const first = (window as unknown as { __first: { current?: number; timeline?: number } })
            .__first;
          return first.current === undefined
            ? null
            : Math.abs(first.current - (first.timeline ?? 0));
        }),
      )
      .toBeLessThan(50);
    // Its last instant and its first are the same place on the tiled gradient.
    const gap = await page.locator("[data-queue-title][data-live]").evaluate((word) => {
      const sheen = word
        .getAnimations()
        .find((a) => (a as CSSAnimation).animationName === "queue-sheen") as CSSAnimation;
      const length = Number(sheen.effect?.getComputedTiming().duration);
      sheen.pause();
      const read = (at: number) => {
        sheen.currentTime = at;
        const style = getComputedStyle(word);
        const tile = (parseFloat(style.backgroundSize) / 100) * word.clientWidth;
        // A background-position percent is a share of the room the tile leaves.
        const offset = ((word.clientWidth - tile) * parseFloat(style.backgroundPositionX)) / 100;
        return { offset, tile };
      };
      const end = read(length - 0.001);
      const start = read(0);
      const apart = Math.abs(start.offset - end.offset) % start.tile;
      return Math.min(apart, start.tile - apart);
    });
    expect(gap).toBeLessThan(1);
  });

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
    await expectOneMeaningPerGlyph(page);
    await rows(page).first().getByRole("button", { name: "Details" }).click();
    const dialog = page.getByRole("dialog", { name: "What went wrong" });
    await expect(dialog).toContainText("Run: 43");
    await expect(dialog.getByRole("link", { name: "Open the log" })).toBeVisible();
    await dialog.getByRole("button", { name: "Copy details" }).click();
    await expect(dialog.getByRole("button", { name: "Copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("Run: 43");
  });
});
