import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { openPicker, pickerList } from "./picker";

/**
 * Prevents: under prefers-reduced-motion nothing moves, but fades and colour changes keep their
 * timing (DD-003). Reduced motion once collapsed every enter and exit duration, so a cross-fade
 * vanished with the slide; and a rule that left a movement property (a chevron's rotate, a chip's
 * word slide, a list's scale) on a kept duration still moved. This ticks a filter chip, opens and
 * closes a picker and moves between two destinations, and records every transition and animation
 * the page runs: none may animate a movement property for more than a millisecond, and at least
 * one opacity fade must have run.
 */

test.use({ serviceWorkers: "block" });

interface Seen {
  property: string;
  duration: number;
}

/** Starts recording, on every document this page loads, each transition and animation with its property. */
async function record(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen = new Map<string, { property: string; duration: number }>();
    (window as unknown as { __seen: typeof seen }).__seen = seen;
    const sweep = () => {
      for (const animation of document.getAnimations()) {
        const effect = animation.effect as KeyframeEffect | null;
        if (!effect) continue;
        const duration = Number(effect.getComputedTiming().duration);
        const properties =
          animation instanceof CSSTransition
            ? [animation.transitionProperty]
            : effect
                .getKeyframes()
                .flatMap((frame) =>
                  Object.keys(frame).filter(
                    (key) => !["offset", "easing", "composite", "computedOffset"].includes(key),
                  ),
                );
        for (const property of properties)
          seen.set(`${property}|${duration}`, { property, duration });
      }
      requestAnimationFrame(sweep);
    };
    requestAnimationFrame(sweep);
  });
}

async function seen(page: Page): Promise<Seen[]> {
  return page.evaluate(() => [
    ...(window as unknown as { __seen: Map<string, Seen> }).__seen.values(),
  ]);
}

const MOVEMENT = /^(transform|translate|scale|rotate|inset|margin)/i;
const movement = (all: Seen[]) =>
  all.filter((each) => MOVEMENT.test(each.property.replace(/-/g, "")) && each.duration > 1);

test("under reduced motion nothing moves, and the fades keep their timing", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await record(page);
  const steps: Seen[][] = [];
  const collect = async () => steps.push(await seen(page));

  await page.goto("/library");
  await expect(page.locator("[data-library]")).toHaveAttribute("data-ready", "");
  await page
    .getByRole("group", { name: "Show" })
    .locator(".filter-chip", { hasText: "Weekly" })
    .click();
  await expect(page.getByRole("checkbox", { name: "Weekly" })).toBeChecked();
  await frames(page);
  await collect();

  await page.goto("/create");
  await expect(page.locator("[data-create-form]")).toHaveAttribute("data-pickers", "");
  const more = page.locator("[data-create-more]").first();
  await more.locator("summary").click();
  await expect(more).toHaveAttribute("open", "");
  await page.evaluate(() => (window as unknown as { __seen: Map<string, Seen> }).__seen.clear());
  await openPicker(page, page.locator("#create-voice"));
  await frames(page);
  await page.keyboard.press("Escape");
  await expect(pickerList(page)).toHaveCount(0);
  await frames(page);
  await collect();

  await page.goto("/library");
  await expect(page.locator("[data-library]")).toHaveAttribute("data-ready", "");
  await page.evaluate(() => (window as unknown as { __seen: Map<string, Seen> }).__seen.clear());
  await page.locator('.app-nav-item[href="/settings"]').click();
  await expect(page).toHaveURL(/\/settings/);
  await frames(page);
  await collect();

  expect(movement(steps.flat())).toEqual([]);
  // A fade ran in each step: the chip, the list and the pill keep their timing.
  for (const step of steps) {
    expect(step.some((each) => each.property === "opacity" && each.duration > 1)).toBe(true);
  }
});

/** A few frames: long enough for a started transition to reach the recorder, with no clock. */
async function frames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
      ),
  );
}
