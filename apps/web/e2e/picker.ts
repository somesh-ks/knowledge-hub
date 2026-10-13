import { expect, type Locator, type Page } from "@playwright/test";

/** The list a picker has open, whichever field opened it (scripts/picker.ts). */
export const pickerList = (page: Page) => page.locator(".picker-pop:popover-open");

/**
 * Opens a picker's list from its button. A page scroll closes an open list (scripts/picker.ts), and
 * on a loaded machine the scroll that brings the button into view can land after the press; this
 * presses again until the list stays open. The list is only ever pressed when it is not open, so it
 * is never toggled shut.
 */
export async function openPicker(page: Page, field: Locator): Promise<void> {
  await expect(async () => {
    if ((await pickerList(page).count()) === 0) await field.click();
    await expect(pickerList(page)).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/** Opens a picker's list from its button and presses the option with this name. */
export async function choose(page: Page, field: Locator, option: string | RegExp): Promise<void> {
  await openPicker(page, field);
  await pickerList(page).getByRole("option", { name: option }).click();
}
