/**
 * The Select's sheet on a phone, drawn on its first open (selectSheet.ts stops the browser's own list
 * and loads this). It is apart from the listener because it brings the sheet's head, its glyphs, the
 * wheel and the pull to dismiss, which every page would otherwise load before anyone opens a select
 * (2026-11-03: about 20 KB of every page's first load, docs/engineering/first-load-js.md).
 *
 * The sheet is a popover placed beside the select, not under `body`, so it stays inside an open
 * dialog (a modal dialog makes everything outside it inert).
 */
import { escapeHtml, sheetHeadHtml } from "../lib/sheetHead";
import { pullToDismiss } from "../scripts/pullDismiss";
import { buttonClass } from "./button";
import { dialogActionsClass } from "./dialog";
import { menuBodyClass, menuItemClass, menuListClass } from "./menu";
import { mountWheel, type Wheel, wheelFrameClass, wheelHtml, wheelListClass } from "./wheel";

let uid = 0;
/** The wheel turning in each open sheet, which Save reads. */
const wheels = new WeakMap<HTMLElement, Wheel>();

/** A select that asks for the wheel (data-wheel) shows its options as one, not as rows. */
const wantsWheel = (select: HTMLSelectElement): boolean => select.hasAttribute("data-wheel");

/** What the field is called: its label, or the name a screen reader is given. */
function titleOf(select: HTMLSelectElement): string {
  const label = select.id ? document.querySelector(`label[for="${CSS.escape(select.id)}"]`) : null;
  const named = select.getAttribute("aria-labelledby");
  const text =
    label?.textContent ||
    select.getAttribute("aria-label") ||
    (named ? document.getElementById(named)?.textContent : "") ||
    select.closest("[data-select]")?.querySelector(".sr-only")?.textContent;
  return text?.trim() || "Choose";
}

/** The sheet already placed beside a select's wrapper, if it has been opened before. */
const listOf = (wrapper: HTMLElement): HTMLElement | null => {
  const next = wrapper.nextElementSibling;
  return next instanceof HTMLElement && next.hasAttribute("data-select-sheet") ? next : null;
};

/** An option is off when it is, or the group it sits in is. */
const isDisabled = (option: HTMLOptionElement): boolean =>
  option.disabled || Boolean(option.closest("optgroup")?.disabled);

function rowsOf(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>('[role="option"]:not([aria-disabled])'));
}

/** Draws the sheet's head once; the rows are redrawn on each open (see `fill`). */
function build(list: HTMLElement, id: string, wheel: boolean): void {
  list.innerHTML =
    sheetHeadHtml("", `${id}-title`, "data-menu-close") +
    (wheel ? "" : `<div class="${menuBodyClass()}" role="listbox"></div>`);
}

/** Draws the title and the rows from the select as it is now, so a list filled after load is whole. */
function fill(list: HTMLElement, select: HTMLSelectElement, id: string): void {
  const title = titleOf(select);
  const heading = list.querySelector(`#${id}-title`);
  if (heading) heading.textContent = title;
  if (list.hasAttribute("data-wheel")) {
    list.querySelector(`.${wheelFrameClass()}`)?.remove();
    const rows = Array.from(select.options)
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => !option.hidden)
      .map(({ option, index }) => ({ index, text: option.text, disabled: isDisabled(option) }));
    // The wheel changes nothing until Save: closing any other way leaves the select as it was.
    const save =
      `<div class="${dialogActionsClass()}">` +
      `<button class="${buttonClass("filled")}" type="button" data-wheel-save>Save</button></div>`;
    list.insertAdjacentHTML("beforeend", wheelHtml(rows, id, title, escapeHtml, save));
    return;
  }
  const body = list.querySelector<HTMLElement>('[role="listbox"]');
  if (!body) return;
  body.setAttribute("aria-label", title);
  // A row is its option's place in the list, not its value: two options may share a value.
  body.innerHTML = Array.from(select.options)
    .map((option, index) => ({ option, index }))
    .filter(({ option }) => !option.hidden)
    .map(
      ({ option, index }) =>
        `<button class="${menuItemClass()}" type="button" role="option" data-index="${index}"` +
        `${option.selected ? ' aria-selected="true"' : ""}${isDisabled(option) ? ' aria-disabled="true"' : ""}>${escapeHtml(option.text)}</button>`,
    )
    .join("");
}

/** Turns the sheet's list into a wheel at the select's value; Save sets the select to the row under the band. */
function openWheel(sheet: HTMLElement, select: HTMLSelectElement, byKey: boolean): void {
  const list = sheet.querySelector<HTMLElement>(`.${wheelListClass()}`);
  if (!list) return;
  const first = Math.max(
    0,
    Array.from(list.querySelectorAll<HTMLElement>("[data-index]")).findIndex(
      (place) => Number(place.dataset.index) === select.selectedIndex,
    ),
  );
  wheels.set(sheet, mountWheel(list, first));
  list.focus({ preventScroll: true, ...(byKey ? {} : { focusVisible: false }) } as FocusOptions);
}

/** Sets the select to the row under the wheel's band, as a pick does, and closes the sheet. */
function saveWheel(sheet: HTMLElement, select: HTMLSelectElement): void {
  const places = Array.from(sheet.querySelectorAll<HTMLElement>("[data-index]"));
  const place = places[wheels.get(sheet)?.at() ?? -1];
  const index = Number(place?.dataset.index);
  sheet.hidePopover();
  if (!place || place.hasAttribute("aria-disabled") || select.selectedIndex === index) return;
  select.selectedIndex = index;
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Opens the sheet for a select, drawing it beside the field the first time. */
export function openSheet(select: HTMLSelectElement, byKey: boolean): void {
  const wrapper = select.closest<HTMLElement>("[data-select]");
  if (!wrapper) return;
  let list = listOf(wrapper);
  if (!list) {
    list = document.createElement("div");
    list.className = menuListClass();
    list.id = `select-sheet-${++uid}`;
    list.setAttribute("popover", "auto");
    list.setAttribute("data-select-sheet", "");
    if (wantsWheel(select)) list.setAttribute("data-wheel", "");
    const sheet = list;
    build(sheet, sheet.id, wantsWheel(select));
    pullToDismiss(sheet, () => sheet.hidePopover());
    sheet.addEventListener("click", (event) => {
      const target = event.target as Element;
      if (target.closest("[data-menu-close]")) {
        sheet.hidePopover();
        return;
      }
      if (sheet.hasAttribute("data-wheel")) {
        if (target.closest("[data-wheel-save]")) saveWheel(sheet, select);
        return;
      }
      const row = target.closest<HTMLElement>('[role="option"]');
      if (!row || row.hasAttribute("aria-disabled")) return;
      const index = Number(row.dataset.index);
      const changed = select.selectedIndex !== index;
      select.selectedIndex = index;
      sheet.hidePopover();
      if (changed) {
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    sheet.addEventListener("keydown", (event) => {
      if (sheet.hasAttribute("data-wheel")) {
        // Enter on the wheel is Save; the wheel's own keys turn it.
        if (event.key === "Enter" && (event.target as Element).closest(`.${wheelListClass()}`)) {
          event.preventDefault();
          saveWheel(sheet, select);
        }
        return;
      }
      const rows = rowsOf(sheet);
      const at = rows.indexOf(document.activeElement as HTMLElement);
      const to =
        event.key === "ArrowDown"
          ? at + 1
          : event.key === "ArrowUp"
            ? at - 1
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? rows.length - 1
                : null;
      if (to === null) return;
      event.preventDefault();
      rows[(to + rows.length) % rows.length]?.focus();
    });
    // Closed by a pick, Escape or a press outside: focus goes back to the field.
    sheet.addEventListener("toggle", (event) => {
      if ((event as ToggleEvent).newState !== "closed") return;
      if (sheet.contains(document.activeElement)) select.focus({ preventScroll: true });
    });
    wrapper.after(sheet);
  }
  if (list.matches(":popover-open")) return;
  fill(list, select, list.id);
  // The field holds focus first, so the popover returns it there when it closes.
  select.focus({ preventScroll: true });
  list.showPopover();
  if (wantsWheel(select)) {
    openWheel(list, select, byKey);
    return;
  }
  // Focus moves in for a keyboard and a screen reader; a finger's ring is not drawn (focusVisible).
  const row = list.querySelector<HTMLElement>('[aria-selected="true"]') ?? rowsOf(list)[0];
  row?.focus({ preventScroll: true, ...(byKey ? {} : { focusVisible: false }) } as FocusOptions);
  row?.scrollIntoView({ block: "center" });
}
