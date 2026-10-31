import { expect, SITE, serveNarration, test } from "./helpers";

/** The player's lazily loaded half, by any name the bundler gives it. */
const LAZY_CHUNK = /PlayerPageContent|ExpandedPlayer/;

// A deploy while a tab is open names new script files on the next page move, so the tab holds a
// second copy of the page's code beside the first. Two copies made two stores and two audio
// elements: Play on the page started one, the bar showed the other, and a press on the bar played
// both (2026-10-31). The second copy here is the layout script again, with every module it reaches
// served under a new address, as a deploy's files are.
test("a second copy of the page's code in the tab leaves one audio, and the page and the bar agree", async ({
  player,
  audio,
  page,
}) => {
  await page.route(/\/_astro\/[^?]*\.js\?second-copy$/, async (route) => {
    const original = await route.fetch({ url: route.request().url().replace("?second-copy", "") });
    const source = (await original.text()).replace(
      /(\bfrom\s*|\bimport\(\s*)"(\.\/[^"?]+\.js)"/g,
      '$1"$2?second-copy"',
    );
    await route.fulfill({ response: original, body: source });
  });
  await player.open();
  await page.evaluate(async () => {
    const entry = performance
      .getEntriesByType("resource")
      .map((resource) => resource.name)
      .find((name) => /\/BaseLayout\.astro_astro_type_script[^/]*\.js$/.test(name));
    if (!entry) throw new Error("the page loaded no layout script");
    await import(`${entry}?second-copy`);
  });
  await player.play();
  expect(await audio.count()).toBe(1);
  await expect(player.cta).toHaveAccessibleName(/^Pause the podcast/);
  await player.finger.press(player.dock.getByRole("button", { name: "Pause", exact: true }));
  await expect(player.cta).toHaveAccessibleName(/^Resume the podcast/);
  await player.finger.press(player.dock.getByRole("button", { name: "Play", exact: true }));
  await expect(player.root).toHaveAttribute("data-player-state", "playing");
  expect(await audio.count()).toBe(1);
  expect((await audio.read())?.paused).toBe(false);
});

test("a listening journey across pages: A on Today, B from the Library, back to A where it stopped", async ({
  player,
  audio,
  page,
}) => {
  // Briefing A is Today's, with its recording; B is the earlier one, narrated when asked.
  await player.open("/");
  await serveNarration(page, 300, `/d/${SITE.earlier}`);
  await player.play();
  // Hear A's first story out, so it is the one story marked played.
  const stories = await player.stories();
  const first = stories[0]?.id ?? "";
  await page.evaluate(
    (seconds) => {
      const element = window.__audios[0];
      if (element) element.currentTime = seconds;
    },
    (stories[0]?.end ?? 0) - 0.6,
  );
  await expect(page.locator(`[data-item-id="${first}"]`)).toHaveAttribute("data-state", "played");
  await player.finger.press(player.dock.getByRole("button", { name: "Pause", exact: true }));
  await expect(player.root).toHaveAttribute("data-player-state", "paused");
  // To the Library, and B from its card.
  await player.goToNextPage();
  // On a phone a card is its link (the cover's Play shows only to a mouse); B's page plays it.
  await player.finger.press(page.getByRole("link", { name: /^Monday 5 October/ }));
  await expect(page).toHaveURL(new RegExp(`/d/${SITE.earlier}$`));
  await player.finger.press(player.cta);
  await expect(player.root).toHaveAttribute("data-player-state", "playing", { timeout: 10_000 });
  // Back to A, on Today.
  await player.finger.press(
    page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Latest" }),
  );
  await expect(page).toHaveURL(/\/$/);
  // A offers the time left from where it stopped, not a fresh start.
  await expect(player.cta).toHaveAccessibleName(/^Resume the podcast, \d+ min left$/);
  // Played only on the story that was heard.
  await expect(page.locator(`[data-item-id="${first}"]`)).toHaveAttribute("data-state", "played");
  await expect(page.locator('[data-item-id][data-state="played"]')).toHaveCount(1);
  // One audio element carried the whole journey.
  expect(await audio.count()).toBe(1);
  // And A plays on from there.
  await player.finger.press(player.cta);
  await expect(player.root).toHaveAttribute("data-player-state", "playing");
  expect((await audio.read())?.currentTime ?? 0).toBeGreaterThan((stories[0]?.end ?? 0) - 1);
});

test("offline after one visit online, the player's lazy half comes from the service worker", async ({
  player,
  page,
  context,
}) => {
  const chunks = new Set<string>();
  page.on("request", (request) => {
    if (LAZY_CHUNK.test(request.url())) chunks.add(request.url());
  });
  await player.open();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "networkidle" });
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  // Online: the player opens once, which needs its lazy half.
  await player.play();
  await player.openPlayer();
  await expect(player.pageScrubber).toBeVisible();
  expect(chunks.size).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await player.collapsed();
  // Offline, a fresh load of the page still gets the lazy half: the worker holds it.
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  for (const url of chunks) {
    expect(
      await page.evaluate((address) => import(address).then(() => true), url),
      `${url} offline`,
    ).toBe(true);
  }
  await context.setOffline(false);
});
