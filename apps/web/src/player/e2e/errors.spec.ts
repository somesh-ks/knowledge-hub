import type { Page } from "@playwright/test";
import { expect, fulfillNarration, test } from "./helpers";

type Answer = { file: boolean } | { refusal: string; status?: number };

/**
 * A briefing whose segments are listed with no files. `answer` says how each segment is met: a made
 * file (which may itself be missing) or a refusal from the server.
 */
async function serve(page: Page, answer: (key: string) => Answer): Promise<void> {
  const ids = await page.evaluate(() => {
    const data = JSON.parse(document.getElementById("dispatch-digest-data")?.textContent ?? "{}");
    return (data.items as { id: string }[]).map((item) => item.id);
  });
  const keys = ["intro", ...ids];
  const segment = (key: string, confirmed: boolean) => ({
    key,
    item_id: key === "intro" ? null : key,
    characters: 300,
    audio: { url: `/narrated/${key}.mp3`, duration_ms: 18_600, confirmed },
  });
  await page.route("**/api/narrate?digest=*", (route) =>
    route.fulfill({
      json: {
        status: 200,
        audio: null,
        timeline: null,
        ms_per_character: 62,
        segments: keys.map((key) => segment(key, false)),
      },
    }),
  );
  await page.route("**/narrated/*.mp3", (route) => {
    const key = new URL(route.request().url()).pathname.split("/").pop()?.replace(".mp3", "") ?? "";
    const met = answer(key);
    return "file" in met && met.file
      ? fulfillNarration(route)
      : route.fulfill({ status: 404, body: "" });
  });
  await page.route("**/api/narrate", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const { segment: key } = route.request().postDataJSON() as { segment: string };
    const met = answer(key);
    if ("refusal" in met) {
      return route.fulfill({ status: met.status ?? 429, json: { error: met.refusal } });
    }
    return route.fulfill({ json: { status: 200, segment: segment(key, true) } });
  });
}

test.describe("a recording that fails", () => {
  test("a missing audio file is said in plain words, and the disc tries again once it is back", async ({
    player,
    page,
    finger,
  }) => {
    await player.open("/d/2026-10-05");
    let missing = true;
    await serve(page, () => ({ file: !missing }));
    await finger.press(player.cta);
    await expect(player.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
    await expect(player.cta.locator("[data-chip-label]")).toHaveText("Try again");
    await expect(page.locator(".dock-caption")).toHaveText("Audio is not available");
    await player.openPlayer();
    const notice = player.dialog.getByRole("alert");
    await expect(notice).toContainText("Audio is not available");
    await expect(page.locator("body")).not.toContainText("MEDIA_ELEMENT_ERROR");
    const live = await page.locator("[aria-live]").allTextContents();
    expect(live.join(" ")).not.toContain("MEDIA_ELEMENT_ERROR");
    // The notice offers no button of its own; the Play disc is the one Try again.
    await expect(notice.getByRole("button")).toHaveCount(0);
    const disc = player.dialog.getByRole("button", { name: "Try again" });
    await expect(disc).toHaveCount(1);
    missing = false;
    await finger.press(disc);
    await expect(player.root).toHaveAttribute("data-player-state", "playing", { timeout: 10_000 });
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("when the server cannot list the narration, it says so and starts nothing", async ({
    player,
    page,
    finger,
  }) => {
    let asked = 0;
    await page.route("**/api/narrate?digest=*", (route) => {
      asked += 1;
      return route.fulfill({ status: 503, json: { error: "unavailable" } });
    });
    await player.open("/d/2026-10-05");
    await finger.press(player.cta);
    await expect.poll(() => asked).toBeGreaterThan(0);
    await expect(page.getByText("Narration is not available right now.")).toBeVisible();
    await expect(player.root).toHaveAttribute("data-player-state", "idle");
    await expect(player.cta).toHaveAttribute("data-state", "idle");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("a refusal that stands offers no Try again, in the notice or on the disc", async ({
    player,
    page,
  }) => {
    await player.open("/d/2026-10-05");
    await serve(page, (key) => (key === "intro" ? { file: true } : { refusal: "daily_cap" }));
    await player.play();
    await expect(player.root).toHaveAttribute("data-player-state", "playing", { timeout: 10_000 });
    await player.openPlayer();
    await player.dialog.getByRole("button", { name: "Next story" }).first().click();
    await expect(player.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
    const notice = player.dialog.getByRole("alert");
    await expect(notice).toContainText("Daily narration limit reached");
    await expect(notice.getByRole("button")).toHaveCount(0);
    await expect(player.dialog.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expect(page.locator(".dock-caption")).toHaveText("Daily limit reached");
  });

  test("a standing refusal keeps Play on the hero chip, and a press on the open page says why again", async ({
    player,
    page,
  }) => {
    await player.open("/d/2026-10-05");
    await serve(page, (key) => (key === "intro" ? { file: true } : { refusal: "daily_cap" }));
    await player.play();
    await player.openPlayer();
    await player.dialog.getByRole("button", { name: "Next story" }).first().click();
    await expect(player.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
    // The chip under the page says what the disc and the bar say: Play, with the reason.
    await expect(player.cta).toHaveAttribute("data-state", "idle");
    await expect(player.cta.locator("[data-chip-label]")).toHaveText("Daily limit reached");
    await expect(player.cta).toHaveAttribute(
      "aria-label",
      "Play the briefing, Daily limit reached",
    );
    // A press on Play sends nothing; the reason's alert is put in again, so it is said again.
    const notice = player.dialog.getByRole("alert");
    await notice.evaluate((element) => {
      element.setAttribute("data-seen", "");
    });
    await player.dialog.locator(".transport [data-primary]").click();
    await expect(notice).toContainText("Daily narration limit reached");
    await expect(notice).not.toHaveAttribute("data-seen", "");
  });

  test("a 503 mid-recording passes: Try again sends the request once the server is back", async ({
    player,
    page,
  }) => {
    await player.open("/d/2026-10-05");
    let down = true;
    let asked = 0;
    await serve(page, (key) => {
      if (key === "intro") return { file: true };
      asked += 1;
      return down ? { refusal: "unavailable", status: 503 } : { file: true };
    });
    await player.play();
    await player.openPlayer();
    await player.dialog.getByRole("button", { name: "Next story" }).first().click();
    await expect(player.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
    const notice = player.dialog.getByRole("alert");
    await expect(notice).toContainText("Narration is not available right now.");
    down = false;
    const before = asked;
    await notice.getByRole("button", { name: "Try again" }).click();
    await expect(player.root).toHaveAttribute("data-player-state", "playing", { timeout: 10_000 });
    expect(asked).toBeGreaterThan(before);
  });

  test("in a short wide window a failure's reason is clear of the bar @wide", async ({
    player,
    page,
  }, info) => {
    test.skip(info.project.name !== "site-desktop", "a mouse at 1280x600");
    await page.setViewportSize({ width: 1280, height: 600 });
    await player.open("/d/2026-10-05");
    await serve(page, (key) => (key === "intro" ? { file: true } : { refusal: "monthly_budget" }));
    await player.play();
    await player.openPlayer();
    await player.dialog.getByRole("button", { name: "Next story" }).first().click();
    await expect(player.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
    const notice = await player.boxOf(player.dialog.getByRole("alert"));
    const bar = await player.boxOf(page.locator("[data-player-dock]"));
    expect(notice.y + notice.height).toBeLessThanOrEqual(bar.y + 1);
  });

  test("a failure and its retry move nothing on the open page, and two columns never overflow @desktop", async ({
    player,
    page,
  }, info) => {
    test.skip(
      info.project.name !== "site-desktop" && info.project.name !== "site-phone",
      "a mouse and a finger, at the window sizes below",
    );
    test.setTimeout(300_000);
    const sizes =
      info.project.name === "site-desktop"
        ? [
            "1024x600",
            "1133x690",
            "1280x600",
            "1280x680",
            "1366x657",
            "1536x730",
            "1280x800",
            "1920x1080",
          ]
        : ["360x640", "390x844", "820x1100", "1024x600", "1024x768", "1133x690", "1280x720"];
    const measure = () =>
      page.evaluate(() => {
        const top = (selector: string) =>
          document.querySelector(`[data-player-page] ${selector}`)?.getBoundingClientRect().top ??
          -1;
        const sheet = document.querySelector<HTMLElement>("[data-player-page]");
        return {
          overflow: sheet ? sheet.scrollHeight - sheet.clientHeight : -1,
          positions: [
            ".player-cover-frame",
            ".scrubber-track",
            ".transport",
            ".transport [data-primary]",
          ].map((selector) => Math.round(top(selector))),
        };
      });
    for (const size of sizes) {
      const [width = 0, height = 0] = size.split("x").map(Number);
      await page.setViewportSize({ width, height });
      await player.open("/d/2026-10-05");
      let failing = false;
      await serve(page, (key) =>
        failing && key !== "intro" ? { refusal: "synthesis_failed", status: 500 } : { file: true },
      );
      await player.play();
      await player.openPlayer();
      const rest = await measure();
      // One column scrolls its list by design; two columns fit the window.
      if (width >= 1024) expect(rest.overflow, `${size} at rest`).toBeLessThanOrEqual(1);
      failing = true;
      await player.dialog.locator(".transport [aria-label='Next story']").click();
      await expect(player.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
      const failed = await measure();
      expect(failed.positions, `${size} in a failure`).toEqual(rest.positions);
      if (width >= 1024) expect(failed.overflow, `${size} in a failure`).toBeLessThanOrEqual(1);
      // A retry that fails again: during its load and after, nothing moves either.
      await player.dialog.locator(".transport [data-primary]").click();
      expect((await measure()).positions, `${size} retrying`).toEqual(rest.positions);
      await expect(player.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
      expect((await measure()).positions, `${size} after the retry`).toEqual(rest.positions);
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });

  test("Enter on the notice's Try again keeps focus on the page, on the Play disc", async ({
    player,
    page,
  }) => {
    await player.open("/d/2026-10-05");
    await serve(page, (key) =>
      key === "intro" ? { file: true } : { refusal: "synthesis_failed", status: 500 },
    );
    await player.play();
    await player.openPlayer();
    await player.dialog.locator(".transport [aria-label='Next story']").click();
    await expect(player.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
    await player.dialog.getByRole("alert").getByRole("button", { name: "Try again" }).focus();
    await page.keyboard.press("Enter");
    // The notice leaves while the retry loads; focus is on the disc, which stays.
    await expect(player.dialog.locator(".transport [data-primary]")).toBeFocused();
    await expect(player.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
    await expect(player.dialog.locator(".transport [data-primary]")).toBeFocused();
  });

  test("in a standing refusal a story whose file is made still plays", async ({ player, page }) => {
    await player.open("/d/2026-10-05");
    const first = await page.evaluate(
      () =>
        JSON.parse(document.getElementById("dispatch-digest-data")?.textContent ?? "{}").items[0]
          .id,
    );
    await serve(page, (key) =>
      key === "intro" || key === first
        ? { file: true }
        : { refusal: "monthly_budget", status: 402 },
    );
    await player.play();
    await player.openPlayer();
    const next = player.dialog.locator(".transport [aria-label='Next story']");
    await next.click();
    await expect(player.root).toHaveAttribute("data-player-state", "playing");
    await next.click();
    await expect(player.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
    // Back to story 1, whose file was made: it plays, and the reason goes.
    await player.dialog.locator(".transport [aria-label='Previous story']").click();
    await expect(player.root).toHaveAttribute("data-player-state", "playing", { timeout: 10_000 });
    await expect(player.dialog.getByRole("alert")).toHaveCount(0);
  });

  test("a server's failure never starts by itself when the connection blips", async ({
    player,
    page,
    context,
  }) => {
    await player.open("/d/2026-10-05");
    let asked = 0;
    await serve(page, (key) => {
      if (key === "intro") return { file: true };
      asked += 1;
      return { refusal: "synthesis_failed", status: 500 };
    });
    await player.play();
    await player.openPlayer();
    await player.dialog.getByRole("button", { name: "Next story" }).first().click();
    await expect(player.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
    const before = asked;
    // A phone changing networks: offline, then back.
    await context.setOffline(true);
    await page.waitForTimeout(300);
    await context.setOffline(false);
    await page.waitForTimeout(1_500);
    expect(asked).toBe(before);
    await expect(player.root).toHaveAttribute("data-player-state", "error");
  });

  test("offline the notice offers no Try again, and the connection's return plays on", async ({
    player,
    page,
    context,
  }) => {
    await player.open("/d/2026-10-05");
    // A routed request is answered even offline: the files stand in for the network themselves.
    let offline = false;
    await serve(page, () => ({ file: !offline }));
    await player.play();
    await player.openPlayer();
    offline = true;
    await context.setOffline(true);
    await player.dialog.getByRole("button", { name: "Next story" }).first().click();
    await expect(player.root).toHaveAttribute("data-player-state", "error", { timeout: 10_000 });
    const notice = player.dialog.getByRole("alert");
    await expect(notice).toHaveText("You are offline. Reconnect to play on.");
    await expect(notice.getByRole("button")).toHaveCount(0);
    await expect(player.dialog.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expect(page.locator(".dock-caption")).toHaveText("You are offline");
    offline = false;
    await context.setOffline(false);
    await expect(player.root).toHaveAttribute("data-player-state", "playing", { timeout: 10_000 });
  });
});
