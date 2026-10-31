import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { expect, serveNarration, test } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Axe, WCAG 2.2 AA, on the state the page is in now: once light and once dark. */
async function expectAccessible(page: Page, where: string): Promise<void> {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    // The colours ease to the new scheme; axe reads them once they are there.
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation instanceof CSSTransition)
          .map((animation) => animation.finished.catch(() => null)),
      ),
    );
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const violations = results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.target.join(" ")),
    }));
    expect(violations, `${where}, ${colorScheme}`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

function reply(route: Route, status: number, body: Record<string, unknown>) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test.describe("axe, WCAG 2.2 AA, light and dark", () => {
  test("the page with the bar docked", async ({ player, page }) => {
    await player.open();
    await player.play();
    await expectAccessible(page, "the bar docked");
  });

  test("the open player, and when it has ended", async ({ player, page }) => {
    // Autoplay off, so the ended player stays to be looked at.
    await page.addInitScript(() =>
      localStorage.setItem("singularity:preferences", '{"autoplay":false}'),
    );
    await player.open();
    await player.play();
    await player.openPlayer();
    await expectAccessible(page, "the open player");
    await player.pageScrubber.focus();
    await page.keyboard.press("End");
    await expect(player.root).toHaveAttribute("data-player-state", "ended");
    await expect(player.dialog.getByText("Suggested", { exact: true })).toBeVisible();
    await expectAccessible(page, "the ended player");
  });

  // D277: played rows, the one playing and the queued rows, with a row held mid-drag by key.
  test("Up next with played, current and queued rows", async ({ player, page }) => {
    await player.open();
    await serveNarration(page, 300, "/d/2026-10-05");
    await page.evaluate(() => {
      for (const id of ["2026-10-05", "ep-20261007-1930"])
        document.dispatchEvent(new CustomEvent("singularity:queue-add", { detail: { id } }));
    });
    await player.play();
    await player.openPlayer();
    await player.dialog.getByRole("tab", { name: "Up next" }).click();
    await player.finger.press(
      player.dialog.locator('[data-queue-id="2026-10-05"] .player-queue-row'),
    );
    await expect(player.dialog.locator('[data-state="played"]')).toHaveCount(1, {
      timeout: 10_000,
    });
    await expectAccessible(page, "Up next with played rows");
  });

  test("the Generate sheet idle and refused, then the queue going and failed", async ({
    player,
    page,
  }) => {
    let generate = 0;
    await page.route("**/api/generate", (route) => {
      generate += 1;
      return generate === 1
        ? reply(route, 503, { error: "unavailable" })
        : reply(route, 202, { run_id: 79, started_at: "2026-10-07T07:13:00Z" });
    });
    let status = 0;
    await page.route("**/api/status**", (route) => {
      status += 1;
      return reply(
        route,
        200,
        status === 1
          ? { run_id: 79, state: "running", step: "writing", stage: 3, stages: 7 }
          : {
              run_id: 79,
              state: "completed",
              step: "writing",
              outcome: "failed",
              run_url: "https://github.com/example/singularity/actions/runs/79",
            },
      );
    });
    await player.open();
    await page.clock.install();
    const dialog = await player.openGenerate();
    await expectAccessible(page, "the Generate sheet");
    const start = dialog.getByRole("button", { name: "Regenerate" });
    await player.finger.press(start);
    await expect(dialog.getByRole("alert")).toContainText("ran into a problem");
    await expectAccessible(page, "the Generate sheet refused");
    await player.finger.press(start);
    // The sheet is only the form: the run is followed in the line above the navigation.
    await expect(dialog).toBeHidden();
    const card = page.locator("[data-queue-dock]");
    await expect(card).toBeVisible();
    await expectAccessible(page, "the queue going");
    await page.clock.runFor(4_100);
    // The step that failed is named, with a way to the run and a way to try again.
    await expect(card.locator("[data-queue-status]").first()).toContainText("couldn't be written");
    await expectAccessible(page, "the queue failed");
    await player.finger.press(card.getByRole("button", { name: "Details" }));
    await expect(page.getByRole("link", { name: "Open the log" })).toHaveAttribute(
      "href",
      /runs\/79/,
    );
    await expectAccessible(page, "the queue's details");
    await player.finger.press(page.getByRole("button", { name: "Close" }).last());
    await expect(card.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the page fades in place instead of travelling, and no cover flies", async ({
    player,
    page,
  }) => {
    await player.open();
    await player.play();
    await player.openPlayer();
    // Nothing travelled: the page is where layout put it, and opacity carried the change.
    await expect(player.sheet).toHaveCSS("transform", "none");
    await expect(player.sheet).toHaveCSS("opacity", "1");
    // The page's own cover is the one on screen for as long as the page is.
    await expect(player.sheet.locator(".player-cover-frame")).toHaveCSS("visibility", "visible");
    await page.keyboard.press("Escape");
    await player.collapsed();
    await expect(player.sheet).toBeHidden();
    await expect(player.openButton.locator(".player-cover-frame")).toHaveCSS(
      "visibility",
      "visible",
    );
  });
});
