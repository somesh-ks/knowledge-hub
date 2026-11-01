import { expect, line, test } from "./helpers";

const QUEUE = ["ep-20261006-0900", "ep-20261007-1930", "2026-10-05"];

/** Up next with three queued items under a recording that plays, the Reorderable list's setting. */
async function openQueue(
  player: Parameters<Parameters<typeof test>[2]>[0]["player"],
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
) {
  await player.open();
  await page.evaluate((ids) => {
    for (const id of ids)
      document.dispatchEvent(new CustomEvent("singularity:queue-add", { detail: { id } }));
  }, QUEUE);
  await player.play();
  await player.openPlayer();
  await player.dialog.getByRole("tab", { name: "Up next" }).click();
  await expect(player.dialog.locator(".reorder-item")).toHaveCount(3);
}

const order = (page: import("@playwright/test").Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("singularity:queue") ?? "[]") as string[]);

// D277: the queue's order is the listener's. A drag is one way to set it; the keyboard is another.
test.describe("moving a queued row", () => {
  test("a press and pull with a mouse moves the row @desktop", async ({ player, page }) => {
    await openQueue(player, page);
    const rows = player.dialog.locator(".reorder-item");
    const from = await rows.nth(2).boundingBox();
    const to = await rows.nth(0).boundingBox();
    if (!from || !to) throw new Error("no rows");
    await page.mouse.move(from.x + 80, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 80, from.y + from.height / 2 - 20, { steps: 4 });
    await page.mouse.move(to.x + 80, to.y + 4, { steps: 12 });
    await page.mouse.up();
    expect(await order(page)).toEqual(["2026-10-05", "ep-20261006-0900", "ep-20261007-1930"]);
    // The press that lifted the row did not play it.
    await expect(player.dialog.locator('[data-state="current"]')).toHaveCount(1);
    expect(await page.evaluate(() => localStorage.getItem("singularity:queue-played"))).toContain(
      '"current":"2026-10-07"',
    );
  });

  test("a long press and move with a finger moves the row, and a quick swipe still scrolls", async ({
    player,
    page,
  }) => {
    await openQueue(player, page);
    const rows = player.dialog.locator(".reorder-item");
    const first = await rows.nth(0).boundingBox();
    if (!first) throw new Error("no rows");
    const at = { x: first.x + 120, y: first.y + first.height / 2 };
    // A press that moves before the hold is a scroll or a swipe, never a lift.
    await player.finger.drag(line(at, { x: at.x, y: at.y - 30 }, 4), 20);
    expect(await order(page)).toEqual(QUEUE);
    // Measured again: that move may have scrolled the list, and a fling keeps scrolling after the finger
    // lifts, so wait until the page stops.
    await page.waitForFunction(
      () =>
        new Promise<boolean>((resolve) => {
          const page = document.querySelector("[data-player-page]");
          const at = page?.scrollTop ?? 0;
          setTimeout(() => resolve(page?.scrollTop === at), 300);
        }),
      undefined,
      { polling: 100 },
    );
    const from = await rows.nth(0).boundingBox();
    const to = await rows.nth(2).boundingBox();
    if (!from || !to) throw new Error("no rows");
    const start = { x: from.x + 120, y: from.y + from.height / 2 };
    // Held still for half a second, then moved past the last row.
    const hold = Array.from({ length: 7 }, () => start);
    const drag = await player.finger.drag(hold, 100, { hold: true });
    await drag.move(line(start, { x: start.x, y: to.y + to.height - 4 }, 12));
    await drag.release();
    expect(await order(page)).toEqual(["ep-20261007-1930", "2026-10-05", "ep-20261006-0900"]);
    // The two bars at a row's end lift it at once: no hold, and no swipe or tap on the row. The
    // rows have settled into their new places before they are measured.
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a instanceof CSSTransition)
          .map((a) => a.finished),
      ),
    );
    const grip = player.dialog.locator(".reorder-handle").nth(1);
    const handle = await grip.boundingBox();
    const last = await rows.nth(2).boundingBox();
    if (!handle || !last) throw new Error("no handle");
    const grabbed = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await player.finger.drag(line(grabbed, { x: grabbed.x, y: last.y + last.height - 4 }, 8), 20);
    expect(await order(page)).toEqual(["ep-20261007-1930", "ep-20261006-0900", "2026-10-05"]);
  });

  test("Alt and the arrow keys move a focused row, and focus stays on it @desktop", async ({
    player,
    page,
  }) => {
    await openQueue(player, page);
    const first = player.dialog.locator(".reorder-item").first().locator(".player-queue-row");
    await first.focus();
    await page.keyboard.press("Alt+ArrowDown");
    expect(await order(page)).toEqual(["ep-20261007-1930", "ep-20261006-0900", "2026-10-05"]);
    await expect(
      player.dialog.locator('[data-queue-id="ep-20261006-0900"] .player-queue-row'),
    ).toBeFocused();
    await page.keyboard.press("Alt+ArrowUp");
    expect(await order(page)).toEqual(QUEUE);
  });
});
