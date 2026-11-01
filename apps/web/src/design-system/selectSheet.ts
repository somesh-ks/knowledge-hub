/**
 * The Select's list on a phone: the standard bottom sheet, the one a ⋮ menu opens, with the field's
 * label as its title, Close at the end and a row for each option (menu.css). A select keeps its
 * native list from 40rem, where it opens under the field; on a phone the browser's own list is
 * stopped and this opens instead (owner, 2026-10-31: one kind of bottom sheet everywhere). The
 * select stays in the page and holds the value: a choice sets it and fires its `input` and `change`,
 * so whatever listens for a select hears it as it always did. Loaded by Select.astro.
 *
 * The sheet is a popover placed beside the select, not under `body`, so it stays inside an open
 * dialog (a modal dialog makes everything outside it inert).
 */
import { escapeHtml, sheetHeadHtml } from "../lib/sheetHead";
import { pullToDismiss } from "../scripts/pullDismiss";
import { installSheetTapGuard } from "../scripts/sheetTap";
import { buttonClass } from "./button";
import { dialogActionsClass } from "./dialog";
import { menuBodyClass, menuItemClass, menuListClass } from "./menu";
import { mountWheel, type Wheel, wheelFrameClass, wheelHtml, wheelListClass } from "./wheel";

const PHONE = "(width < 40rem)";
/** How far a finger may travel and still be a tap, in px. */
const TAP_SLOP = 10;
const KEYS = new Set(["Enter", " ", "F4"]);

let installed = false;
let uid = 0;
/** The wheel turning in each open sheet, which Save reads. */
const wheels = new WeakMap<HTMLElement, Wheel>();

/** A select that asks for the wheel (data-wheel) shows its options as one, not as rows. */
const wantsWheel = (select: HTMLSelectElement): boolean => select.hasAttribute("data-wheel");

/** A select this sheet stands in for: drawn by the Select, shown, enabled and single-valued. */
function sheetFor(target: EventTarget | null): HTMLSelectElement | null {
  const select = (target as Element | null)?.closest?.("select");
  if (!select || select.disabled || select.multiple) return null;
  if (!select.closest("[data-select]") || select.classList.contains("picker-native")) return null;
  return matchMedia(PHONE).matches ? select : null;
}

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

function open(select: HTMLSelectElement, byKey: boolean): void {
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

/** Stops the browser's own list on a phone and opens the sheet in its place. */
export function installSelectSheet(): void {
  if (installed) return;
  installed = true;
  // A tap beside the sheet closes it and reaches nothing under the finger (as for a menu's sheet).
  installSheetTapGuard();

  // The browser opens a select on the press (a pointer) or on the tap that follows it (a finger).
  // A pointer's press is stopped here. A finger's tap is stopped at the touch's end, which also
  // withholds the click that would follow, so the sheet opens from it; a touch that moved is a scroll
  // and is left alone. A click that comes from neither (an assistive tool) opens the sheet too.
  let touchAt: { x: number; y: number } | null = null;
  document.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.touches.length === 1 ? event.touches[0] : undefined;
      touchAt = touch ? { x: touch.clientX, y: touch.clientY } : null;
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    "touchend",
    (event) => {
      const start = touchAt;
      touchAt = null;
      const touch = event.changedTouches[0];
      const select = sheetFor(event.target);
      if (!start || !touch || !select || !event.cancelable) return;
      if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > TAP_SLOP) return;
      event.preventDefault();
      open(select, false);
    },
    { capture: true, passive: false },
  );
  document.addEventListener(
    "mousedown",
    (event) => {
      if (sheetFor(event.target)) event.preventDefault();
    },
    true,
  );
  document.addEventListener(
    "click",
    (event) => {
      const select = sheetFor(event.target);
      if (!select) return;
      event.preventDefault();
      open(select, false);
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      const select = sheetFor(event.target);
      if (!select || !(KEYS.has(event.key) || (event.altKey && event.key === "ArrowDown"))) return;
      event.preventDefault();
      open(select, true);
    },
    true,
  );
}
