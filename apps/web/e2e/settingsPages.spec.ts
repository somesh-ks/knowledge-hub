import { expect, test } from "./fixtures";

// Every page reached from Settings says where it sits and starts its first block the same air under
// its title: Costs (/analytics) lost its crumb, and the gap ran 16 to 64px from page to page
// (2026-10-27). Pages are compared with each other, never with a number.
const SETTINGS_SUBPAGES = [
  "/settings/about",
  "/settings/blocked-outlets",
  "/settings/categories",
  "/settings/changelog",
  "/settings/daily",
  "/settings/weekly",
  "/settings/preferences",
  "/settings/privacy",
  "/settings/sounds",
  "/settings/voice",
  "/analytics",
];

test("every settings subpage shows the Settings crumb and the same gap from its title to its first block @both", async ({
  page,
}) => {
  const gaps: Record<string, number> = {};
  for (const path of SETTINGS_SUBPAGES) {
    await page.goto(path);
    await expect(
      page.locator(".settings-head .settings-crumb a[href='/settings']"),
      path,
    ).toBeVisible();
    gaps[path] = await page.evaluate(() => {
      const head = document.querySelector(".settings-head") as HTMLElement;
      const after = [...document.querySelectorAll("main *")].filter(
        (n) =>
          head.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING && !head.contains(n),
      );
      const clear = "rgba(0, 0, 0, 0)";
      // The first thing drawn after the title: a filled or outlined box, or words.
      const first = after.find((n) => {
        const style = getComputedStyle(n);
        if (n.getBoundingClientRect().height === 0 || style.visibility === "hidden") return false;
        if (n.closest(".sr-only")) return false;
        const words = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent?.trim());
        return (
          style.backgroundColor !== clear || Number.parseFloat(style.borderTopWidth) > 0 || words
        );
      }) as HTMLElement;
      // Words start at their box's padding, as a group head's do.
      const style = getComputedStyle(first);
      const pad = style.backgroundColor === clear ? Number.parseFloat(style.paddingTop) : 0;
      return Math.round(
        first.getBoundingClientRect().top + pad - head.getBoundingClientRect().bottom,
      );
    });
  }
  expect(new Set(Object.values(gaps)).size, JSON.stringify(gaps)).toBe(1);
});

// The listener profile's select is the shared settings select, drawn as Theme's: a one-off rule once
// gave it its own padding and a 70% cap of its own width, cutting "Designer" to "esigner"
// (2026-10-27). Compared with Theme's box, never with numbers.
test("the listener profile select has the Theme select's height, radius and padding, and shows its whole value @both", async ({
  page,
}) => {
  const metrics = (selector: string) =>
    page.locator(selector).evaluate((select: HTMLSelectElement) => {
      const style = getComputedStyle(select);
      return {
        height: Math.round(select.getBoundingClientRect().height),
        radius: style.borderTopLeftRadius,
        start: style.paddingInlineStart,
        end: style.paddingInlineEnd,
        clipped: select.scrollWidth > select.clientWidth,
      };
    });
  await page.goto("/settings");
  const theme = await metrics("#settings-theme");
  await page.goto("/settings/preferences?view=structure");
  const profile = page.locator("#structure-profile");
  await expect(profile).toBeVisible();
  const values = await profile
    .locator("option")
    .evaluateAll((all) => all.map((o) => (o as HTMLOptionElement).value));
  for (const value of values) {
    await profile.evaluate((select: HTMLSelectElement, v) => {
      select.value = v;
    }, value);
    expect(await metrics("#structure-profile"), value).toEqual({ ...theme, clipped: false });
  }
});

// A voice select shows its whole name beside its label: a shared rule's higher specificity once
// outranked podcast.css's uncapping and cut "Geffen, female" to "Geffen, fe..." (2026-10-27).
test("a voice select shows a long voice name whole @desktop", async ({ page }) => {
  await page.goto("/settings/voice");
  const value = page.locator("[data-voice-row] .picker-value").first();
  await expect(value).toBeVisible();
  const clipped = await value.evaluate((element: HTMLElement) => {
    element.textContent = "Geffen, female, American";
    return element.scrollWidth > element.clientWidth;
  });
  expect(clipped).toBe(false);
});
