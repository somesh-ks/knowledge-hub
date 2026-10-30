/**
 * How the last action was started, as the reader's app.ts records it: the keyboard focus ring in the
 * reader's stylesheets (the search and sort fields hide the native outline) shows only for data-input="keyboard".
 * Typing into a field is not keyboard navigation; Tab and Escape still are.
 */
const set = (by: string) => (): void => {
  const root = document.documentElement;
  if (root.dataset.input !== by) root.dataset.input = by;
};
const typesIntoField = (event: KeyboardEvent): boolean =>
  event.key !== "Tab" &&
  event.key !== "Escape" &&
  event.target instanceof HTMLElement &&
  (event.target.isContentEditable ||
    event.target.matches(
      'textarea, input:not([type="checkbox"], [type="radio"], [type="range"], [type="button"], [type="submit"], [type="reset"], [type="file"], [type="color"])',
    ));
const keyboard = set("keyboard");
addEventListener(
  "keydown",
  (event) => {
    if (!typesIntoField(event)) keyboard();
  },
  { capture: true, passive: true },
);
addEventListener("pointerdown", set("pointer"), { capture: true, passive: true });
