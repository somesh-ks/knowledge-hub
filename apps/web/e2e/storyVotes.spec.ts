import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * The story controls (components/StoryControls.astro). A like is remembered on the device and sent
 * once, in one batch, when the page is left; stopping an outlet waits five seconds with Undo, and an
 * Undo inside the wait sends nothing. The clock is held, so the ten-minute send never fires on its own.
 */

async function mockConfig(page: Page): Promise<Array<{ op: Record<string, unknown> }>> {
  const sent: Array<{ op: Record<string, unknown> }> = [];
  await page.route("**/api/config", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, json: { status: 202, run_id: 1 } });
  });
  return sent;
}

test.describe("story controls", () => {
  test("a like survives a reload and goes out once, as the page is left", async ({ page }) => {
    await page.clock.install();
    const sent = await mockConfig(page);
    await page.goto("/");
    const like = page.locator("[data-story-controls] [data-vote=up]").first();
    const dislike = page.locator("[data-story-controls] [data-vote=down]").first();
    await like.click();
    await expect(like).toHaveAttribute("aria-pressed", "true");
    await dislike.click();
    await expect(like).toHaveAttribute("aria-pressed", "false");
    await dislike.click();
    await like.click();

    expect(sent).toHaveLength(0);
    // Moving to another page is leaving this one.
    await page.getByRole("link", { name: "Library" }).first().click();
    await expect.poll(() => sent.length).toBe(1);
    const op = sent[0]?.op as { op: string; votes: Array<Record<string, unknown>> };
    expect(op.op).toBe("profile.vote");
    expect(op.votes).toHaveLength(1);
    expect(op.votes[0]).toMatchObject({ value: "up" });

    // After a reload the story is still pressed, and having been sent it is not sent again.
    await page.goto("/");
    await expect(page.locator("[data-story-controls] [data-vote=up]").first()).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.goto("/library");
    expect(sent).toHaveLength(1);
  });

  test("stopping an outlet waits for Undo, and an Undo sends nothing", async ({ page }) => {
    await page.clock.install();
    const sent = await mockConfig(page);
    await page.goto("/");
    const story = page.locator("[data-story-controls]").first();
    const stop = async () => {
      await story.locator("[data-hero-more]").click();
      await story.getByRole("menuitem").click();
    };

    await stop();
    await page.getByRole("button", { name: "Undo" }).click();
    await page.clock.runFor(6000);
    expect(sent).toHaveLength(0);

    await stop();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    expect(sent).toHaveLength(0);
    await page.clock.runFor(6000);
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]?.op).toMatchObject({ op: "profile.block" });
  });
});
