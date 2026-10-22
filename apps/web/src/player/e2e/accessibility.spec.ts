import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./helpers";

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
    await player.open();
    await player.play();
    await player.openPlayer();
    await expectAccessible(page, "the open player");
    await player.pageScrubber.focus();
    await page.keyboard.press("End");
    await expect(player.root).toHaveAttribute("data-player-state", "ended");
    await expect(
      player.dialog.getByRole("button", { name: /The previous briefing/ }),
    ).toBeVisible();
    await expectAccessible(page, "the ended player");
  });

  test("the Generate sheet idle, refused, running, and when the run fails", async ({
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
          ? { run_id: 79, state: "running", step: "writing" }
          : {
              run_id: 79,
              state: "completed",
              step: "writing",
              outcome: "failed",
              run_url: "https://github.com/example/dispatch/actions/runs/79",
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
    await expect(dialog.getByRole("list", { name: "Progress" })).toBeVisible();
    await expectAccessible(page, "the Generate sheet running");
    await page.clock.runFor(3_100);
    // The step that failed is named, with a way to the run and back to the form.
    await expect(
      dialog.getByRole("alert").filter({ hasText: "The run failed while writing" }),
    ).toBeVisible();
    await expect(dialog.getByRole("link", { name: "View the run" })).toHaveAttribute(
      "href",
      /runs\/79/,
    );
    await expect(
      dialog.getByRole("list", { name: "Progress" }).getByRole("listitem").nth(3),
    ).toContainText("Failed");
    await expectAccessible(page, "the Generate sheet failed");
    await player.finger.press(dialog.getByRole("button", { name: "Try again" }));
    await expect(dialog.getByRole("button", { name: "Regenerate" })).toBeVisible();
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
