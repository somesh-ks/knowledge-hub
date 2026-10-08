import type { Page, Route } from "@playwright/test";
import { center, expect, type LabPage, line, test } from "./lab";

/** The player's lazily loaded half, by any name the bundler or the dev server gives it. */
const LAZY_CHUNK = /PlayerPageContent|ExpandedPlayer/;

function reply(route: Route, status: number, body: Record<string, unknown>) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/**
 * Starts a Generate run, closes the sheet, and lets the run finish while the player is open. On the
 * lab that is the briefing's own page; on the site it is Settings, the only page with the opener.
 */
async function finishRunBehindThePlayer(page: Page, lab: LabPage): Promise<void> {
  const { id, servedFrom } = lab.facts.generated;
  if (servedFrom) {
    await page.route(`**/d/${id}`, async (route) => {
      const response = await route.fetch({
        url: new URL(servedFrom, route.request().url()).toString(),
      });
      await route.fulfill({ response });
    });
  }
  await page.route("**/api/generate", (route) =>
    reply(route, 202, { run_id: 91, started_at: "2026-01-14T07:13:00Z" }),
  );
  let calls = 0;
  await page.route("**/api/status**", (route) => {
    calls += 1;
    return reply(
      route,
      200,
      calls === 1
        ? { run_id: 91, state: "running", step: "reading" }
        : {
            run_id: 91,
            state: "completed",
            step: "publishing",
            outcome: "published",
            digest_id: id,
          },
    );
  });
  await lab.open();
  await lab.play();
  if (lab.target === "site") {
    // A briefing page has no Generate button; Settings does. Reach it by a client-side link, from
    // the keyboard so nothing floating over the navigation takes the press, and the islands and
    // the narration carry over.
    await page.getByRole("link", { name: "Settings", exact: true }).first().focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/settings$/);
    await lab.dockSettled();
  }
  // The store reads its timers from the page clock, so the background check can be hurried.
  await page.clock.install();
  await lab.finger.press(
    page.locator('[data-open-sheet="generate"], [data-open="generate"]').first(),
  );
  const dialog = page.getByRole("dialog", { name: "Generate a new briefing" });
  await dialog.getByLabel("Passphrase").fill("secret");
  await lab.finger.press(dialog.getByRole("button", { name: "Generate briefing" }));
  await page.clock.runFor(3_100);
  await lab.finger.press(dialog.getByRole("button", { name: "Close", exact: true }).first());
  await expect(dialog).toBeHidden();
}

test.describe("paths that used to leave the player stuck @surface", () => {
  test("after Back with the player open, a tap on the bar opens it again", async ({
    lab,
    page,
  }) => {
    await lab.open();
    await lab.play();
    await lab.goToNextPage();
    await lab.dockSettled();
    await lab.openPlayer();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${lab.facts.path}$`));
    await lab.collapsed();
    // The bar shows its cover again; nothing was left hidden by the navigation.
    await expect(lab.openButton.locator(".player-cover-frame")).toBeVisible();
    await lab.dockSettled();
    await lab.openPlayer();
    await expect(lab.scrubber).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(lab.facts.nextUrl);
    await lab.collapsed();
    await lab.dockSettled();
    await lab.openPlayer();
  });

  test("after the toast's Open action with the player open, a tap on the bar opens it again", async ({
    lab,
    page,
    finger,
  }) => {
    await finishRunBehindThePlayer(page, lab);
    await lab.openPlayer();
    await page.clock.runFor(16_000);
    const toast = page.locator(".toast");
    await expect(toast).toBeVisible();
    await finger.press(toast.getByRole("button", { name: "Open" }));
    await expect(page).toHaveURL(new RegExp(`/d/${lab.facts.generated.id}`));
    await lab.collapsed();
    await lab.dockSettled();
    await lab.openPlayer();
    await expect(lab.scrubber).toBeVisible();
  });

  test("after Up next navigates away, a tap on the bar opens the player again", async ({
    lab,
    page,
    finger,
  }) => {
    const previous = lab.target === "lab" ? "2026-01-12" : "2026-10-05";
    if (lab.target === "lab") {
      // The lab has no /d/ route; the previous briefing's page is the earlier lab page.
      await page.route(`**/d/${previous}`, async (route) => {
        const response = await route.fetch({
          url: new URL("/dev/player-lab-older", route.request().url()).toString(),
        });
        await route.fulfill({ response });
      });
    }
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    await lab.scrubber.focus();
    await page.keyboard.press("End");
    await expect(lab.root).toHaveAttribute("data-player-state", "ended");
    const upNext = lab.dialog.getByRole("button", { name: /The previous briefing/ });
    await upNext.scrollIntoViewIfNeeded();
    await finger.press(upNext);
    await expect(page).toHaveURL(new RegExp(`/d/${previous}`));
    await lab.collapsed();
    // The fixture site's previous briefing has no narration, so there is no bar to tap there.
    if (lab.target === "site") return;
    await lab.dockSettled();
    await lab.openPlayer();
    await expect(lab.scrubber).toBeVisible();
  });

  test("two taps 120 ms apart end with the player open", async ({ lab, page, finger }) => {
    await lab.open();
    await lab.play();
    const spot = center(await lab.dockSettled());
    await finger.pressAt(spot);
    await page.waitForTimeout(120);
    await finger.pressAt(spot);
    await lab.expanded();
    // Nothing under the second tap was pressed by accident: narration is where it was.
    await expect(lab.root).toHaveAttribute("data-player-state", "playing");
  });

  test("a sloppy tap that drifts 10 to 12 px still opens the player", async ({ lab, finger }) => {
    await lab.open();
    await lab.play();
    const start = center(await lab.dockSettled());
    for (const drift of [10, 12]) {
      // Up and a little sideways, over about 150 ms: a thumb, not a swipe.
      await finger.drag(line(start, { x: start.x + 3, y: start.y - drift }, 5), 30);
      await lab.expanded();
      await lab.page.keyboard.press("Escape");
      await lab.collapsed();
      await lab.dockSettled();
    }
  });

  for (const delay of [100, 300]) {
    test(`a tap on the bar ${delay} ms into a close opens the player again`, async ({
      lab,
      page,
      finger,
    }) => {
      await lab.open();
      await lab.play();
      const spot = center(await lab.dockSettled());
      await lab.openPlayer();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(delay);
      await finger.pressAt(spot);
      await lab.expanded();
      await expect(lab.root).toHaveAttribute("data-player-state", "playing");
    });
  }
});

test.describe("when the player's lazy half cannot load @surface", () => {
  // A service worker would fetch the chunk where the route below cannot see it.
  test.use({ serviceWorkers: "block" });

  test("the player still opens and offers to try again", async ({ lab, page, finger }) => {
    let failing = true;
    await page.route(LAZY_CHUNK, (route) => (failing ? route.abort() : route.continue()));
    await lab.open();
    await lab.play();
    await finger.press(lab.openButton);
    await lab.expanded();
    // The shell is there at once: the date, the cover, the title and a way out.
    await expect(lab.closeButton).toBeVisible();
    const retry = lab.dialog.getByRole("button", { name: "Try again" });
    await expect(retry).toBeVisible();
    await expect(lab.scrubber).toHaveCount(0);
    failing = false;
    await finger.press(retry);
    await expect(lab.scrubber).toBeVisible();
    await expect(retry).toHaveCount(0);
  });
});

test.describe("a window that changes size @surface", () => {
  test("resizing from a phone to landscape to a desktop keeps the open player whole", async ({
    lab,
    page,
    browserName,
    isMobile,
  }) => {
    test.skip(browserName !== "chromium" || !isMobile, "driven from the phone project");
    await lab.open();
    await lab.play();
    await lab.openPlayer();
    for (const size of [
      { width: 844, height: 390 },
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await lab.expanded();
      const sheet = await lab.boxOf(lab.dialog);
      const wide = size.width >= 640;
      const bar = wide ? await lab.boxOf(lab.dock) : null;
      const width = await page.evaluate(() => document.documentElement.clientWidth);
      expect(Math.abs(sheet.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(sheet.width - width)).toBeLessThanOrEqual(1);
      expect(Math.abs(sheet.y + sheet.height - (bar ? bar.y : size.height))).toBeLessThanOrEqual(1);
      // The cover on the page is the one on screen, where the layout put it.
      await expect(lab.dialog.locator(".player-cover-frame")).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await lab.collapsed();
  });
});
