import { expect, test } from "./helpers";

/** A second of silence: a sample that ends by itself. */
function silence(seconds: number): Buffer {
  const rate = 8000;
  const wav = Buffer.alloc(44 + rate * seconds, 0x80);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(rate * seconds, 40);
  return wav;
}

test.describe("a voice sample over a playing podcast", () => {
  test("the podcast fades out and pauses for the sample, with no notice, and comes back after it", async ({
    player,
    page,
  }) => {
    // Owner, 2026-11-03: previewing a voice while the podcast plays must pause it smoothly, play the
    // sample, then let the podcast carry on. The page moves by a link, as the listener's does.
    // The fixture sample runs 36 s: generated silence ends the sample inside the test.
    await page.route("**/api/voice-sample**", (route) =>
      route.fulfill({ body: silence(2), contentType: "audio/wav" }),
    );
    await player.open();
    await player.play();
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing");
    await page.evaluate(() => {
      const link = document.createElement("a");
      link.href = "/settings/sound";
      document.body.append(link);
      link.click();
    });
    await expect(page).toHaveURL(/\/settings\/sound$/);
    await expect(page.locator("[data-manage]")).toHaveAttribute("data-pickers", "");
    const podcast = (): Promise<{ paused: boolean; volume: number }> =>
      page.evaluate(() => {
        const element = window.__audios[0];
        return { paused: element?.paused ?? true, volume: element?.volume ?? 0 };
      });
    expect((await podcast()).paused).toBe(false);

    await page.locator("#podcast-voice").click();
    await page.getByRole("option", { name: /^Ada/ }).locator(".picker-play").click();
    // The podcast is paused by the player, not by another app: nothing is said, and its volume is back.
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "paused");
    expect(await podcast()).toEqual({ paused: true, volume: 1 });
    await expect(page.getByText("Paused by another app")).toHaveCount(0);

    // The sample ends by itself and the podcast carries on.
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "playing", {
      timeout: 15_000,
    });
    await expect.poll(async () => (await podcast()).volume).toBe(1);
    await expect(page.getByText("Paused by another app")).toHaveCount(0);
  });

  test("a podcast the listener paused stays paused through a sample", async ({ player, page }) => {
    // The fixture sample runs 36 s: generated silence ends the sample inside the test.
    await page.route("**/api/voice-sample**", (route) =>
      route.fulfill({ body: silence(1), contentType: "audio/wav" }),
    );
    await player.open();
    await player.play();
    await player.finger.press(player.dock.getByRole("button", { name: "Pause" }));
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "paused");
    await page.evaluate(() => {
      const link = document.createElement("a");
      link.href = "/settings/sound";
      document.body.append(link);
      link.click();
    });
    await expect(page).toHaveURL(/\/settings\/sound$/);
    await expect(page.locator("[data-manage]")).toHaveAttribute("data-pickers", "");
    await page.locator("#podcast-voice").click();
    const ada = page.getByRole("option", { name: /^Ada/ }).locator(".picker-play");
    await ada.click();
    await expect(ada).toHaveAttribute("aria-pressed", "true");
    await expect(ada).toHaveAttribute("aria-pressed", "false", { timeout: 10_000 });
    await expect(page.locator("html")).toHaveAttribute("data-player-state", "paused");
  });
});
