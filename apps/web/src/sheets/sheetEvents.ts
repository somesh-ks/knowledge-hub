/**
 * Other parts of the app ask for a sheet by event, so they never import the sheets root. A toast's
 * "Details" action, for one, reopens the Generate sheet without pulling its code into the page.
 */
export const OPEN_SHEET_EVENT = "dispatch:open-sheet";

export type SheetName = "generate" | "narrate";

export function isSheetName(value: unknown): value is SheetName {
  return value === "generate" || value === "narrate";
}

export function requestSheet(name: SheetName): void {
  window.dispatchEvent(new CustomEvent(OPEN_SHEET_EVENT, { detail: name }));
}
