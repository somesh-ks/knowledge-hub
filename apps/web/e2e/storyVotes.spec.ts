import type { Locator } from "@playwright/test";
import { routeConfigServer } from "./configServer";
import { expect, test } from "./fixtures";

/**
 * The story controls (components/StoryControls.astro). A like is remembered on the device and sent
 * once, in one batch, when the page is left; stopping an outlet waits five seconds with Undo, and an
 * Undo inside the wait sends nothing. The clock is held, so the ten-minute send never fires on its own.
 * /api/config is the site's own handler (configServer.ts), so its ten seconds between edits hold.
 */

/** Opens a story's More menu and stops hearing from its outlet. */
async function stop(story: Locator): Promise<void> {
  await story.locator("[data-hero-more]").click();
  await story.getByRole("menuitem").click();
}

test.describe("story controls", () => {
  test("a like survives a reload and goes out once, as the page is left, with an open riding along", async ({
    page,
  }) => {
    await page.clock.install();
    const server = await routeConfigServer(page);
    await page.goto("/");
    // An open alone never makes a request (every save is a commit); it waits for the like.
    const popup = page.waitForEvent("popup");
    await page.locator("article.story").nth(1).locator("a.story-link").click();
    await (await popup).close();
    const like = page.locator("[data-story-controls] [data-vote=up]").first();
    const dislike = page.locator("[data-story-controls] [data-vote=down]").first();
    await like.click();
    await expect(like).toHaveAttribute("aria-pressed", "true");
    await dislike.click();
    await expect(like).toHaveAttribute("aria-pressed", "false");
    await dislike.click();
    await like.click();

    expect(server.statuses).toHaveLength(0);
    // Moving to another page is leaving this one.
    await page.getByRole("link", { name: "Library" }).first().click();
    await expect.poll(() => server.applied.length).toBe(1);
    const op = server.applied[0] as {
      op: string;
      votes: Array<Record<string, unknown>>;
      opens: unknown[];
    };
    expect(op.op).toBe("profile.vote");
    expect(op.votes).toHaveLength(1);
    expect(op.votes[0]).toMatchObject({ value: "up" });
    expect(op.opens).toHaveLength(1);

    // After a reload the story is still pressed, and having been sent it is not sent again.
    await page.goto("/");
    await expect(page.locator("[data-story-controls] [data-vote=up]").first()).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.goto("/library");
    expect(server.statuses).toEqual([202]);
  });

  test("a short drag leaves the toast where it was; a swipe takes it away and the stop still goes", async ({
    page,
  }) => {
    await page.clock.install();
    const server = await routeConfigServer(page);
    await page.goto("/");
    await stop(page.locator("[data-story-controls]").first());
    const toast = page.locator(".toast");
    await expect(toast).toBeVisible();
    // Its box is read once it has come to rest: CI caught it mid-entrance (y 712.09 against 712).
    await toast.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const cdp = await page.context().newCDPSession(page);
    const rest = (await toast.boundingBox()) as { x: number; y: number; width: number };
    const y = rest.y + 20;
    const swipe = async (by: number) => {
      const x = rest.x + rest.width / 2;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let step = 1; step <= 4; step++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: x + (by * step) / 4, y }],
        });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    // Past the tap slop but short of the least a swipe takes, it comes back to the same box
    // however fast the finger moved (lib/swipeAway.ts).
    await swipe(16);
    await expect.poll(() => toast.boundingBox()).toEqual(rest);
    // A swipe dismisses the toast only: the stop it offered to undo still goes when its wait ends.
    await swipe(rest.width);
    await expect(toast).toBeHidden();
    await page.clock.runFor(6000);
    await expect.poll(() => server.statuses).toHaveLength(1);
  });

  test("stopping an outlet waits for Undo, and an Undo sends nothing", async ({ page }) => {
    await page.clock.install();
    const server = await routeConfigServer(page);
    await page.goto("/");
    const story = page.locator("[data-story-controls]").first();

    await stop(story);
    await page.getByRole("button", { name: "Undo" }).click();
    await page.clock.runFor(6000);
    expect(server.statuses).toHaveLength(0);

    await stop(story);
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    expect(server.statuses).toHaveLength(0);
    await page.clock.runFor(6000);
    await expect
      .poll(() => server.applied)
      .toEqual([
        {
          op: "profile.block",
          domain: await story.evaluate((el) =>
            new URL(el.dataset.url ?? "").hostname.replace(/^www\./, ""),
          ),
        },
      ]);
  });

  // The reported bug: a second outlet stopped inside the server's ten seconds between edits was
  // refused with a 429 and shown as "Could not stop ... yet", and nothing tried again.
  test("two outlets stopped in a row are both stopped", async ({ page }) => {
    await page.clock.install();
    const server = await routeConfigServer(page);
    await page.goto("/");
    // Every fixture story is on example.com: the second is moved to an outlet of its own.
    const stories = page.locator("[data-story-controls][data-outlet]");
    await stories.nth(1).evaluate((el) => {
      el.dataset.url = "https://reveneau.com/ainews/a-story";
      el.dataset.outlet = "reveneau.com";
    });
    await stop(stories.nth(0));
    await page.clock.runFor(6000);
    await expect.poll(() => server.applied.length).toBe(1);
    // Two seconds after the first went: inside the server's ten.
    await page.clock.runFor(2000);
    await stop(stories.nth(1));
    // The second waits out the server's ten seconds after the first instead of being refused.
    await expect
      .poll(
        async () => {
          await page.clock.runFor(2000);
          return server.applied.length;
        },
        { timeout: 15_000 },
      )
      .toBe(2);
    expect(server.statuses.every((status) => status === 202)).toBe(true);
    await expect(page.getByText(/Could not stop/)).toHaveCount(0);
    // Settings shows both before the next build lands.
    await page.goto("/settings/blocked-outlets");
    for (const op of server.applied) {
      const domain = (op as { domain: string }).domain;
      await expect(page.getByText(domain, { exact: true })).toBeVisible();
    }
  });

  test("a vote and a stop waiting as the page is left both reach the workflow", async ({
    page,
  }) => {
    await page.clock.install();
    const server = await routeConfigServer(page);
    await page.goto("/");
    await page.locator("[data-story-controls] [data-vote=up]").first().click();
    await stop(page.locator("[data-story-controls][data-outlet]").first());
    // Leaving inside the Undo wait sends the stop at once, with the vote.
    await page.getByRole("link", { name: "Library" }).first().click();
    await expect
      .poll(() => server.applied.map((op) => op.op).sort())
      .toEqual(["profile.block", "profile.vote"]);
    expect(server.statuses.every((status) => status === 202)).toBe(true);
  });
});
