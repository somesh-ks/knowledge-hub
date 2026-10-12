import { chosenSummary } from "../lib/multiSelect";

/**
 * Drives every MultiSelect on the page, the ones in panels made later included: one listener of each
 * kind on the document. The field opens the list; a press on an option ticks or unticks it and the
 * list stays open; Arrow keys move, Space or Enter ticks, Home and End jump, Escape closes and gives
 * focus back to the field, and Tab or a press outside closes it. Each option mirrors a hidden checkbox,
 * which fires its own input and change events, so whatever listens for a checkbox (the topics editor,
 * a form) hears the choice.
 */

const ROOT = "[data-multiselect]";

interface Parts {
  root: HTMLElement;
  trigger: HTMLButtonElement;
  list: HTMLElement;
  options: HTMLElement[];
}

function partsOf(root: HTMLElement): Parts | null {
  const trigger = root.querySelector<HTMLButtonElement>(".multiselect-trigger");
  const list = root.querySelector<HTMLElement>(".multiselect-list");
  if (!trigger || !list) return null;
  return { root, trigger, list, options: [...list.querySelectorAll<HTMLElement>("[role=option]")] };
}

const enabled = (option: HTMLElement): boolean => option.getAttribute("aria-disabled") !== "true";
const selected = (option: HTMLElement): boolean => option.getAttribute("aria-selected") === "true";

function inputOf(parts: Parts, option: HTMLElement): HTMLInputElement | null {
  const value = option.dataset.value ?? "";
  return (
    [...parts.root.querySelectorAll<HTMLInputElement>("[data-multiselect-input]")].find(
      (input) => input.dataset.multiselectInput === value,
    ) ?? null
  );
}

function sayChosen(parts: Parts): void {
  const labels = parts.options
    .filter(selected)
    .map((option) => option.querySelector(".multiselect-label")?.textContent ?? "");
  const value = parts.root.querySelector("[data-multiselect-value]");
  if (value)
    value.textContent = chosenSummary(
      labels,
      parts.options.length,
      parts.root.dataset.all,
      parts.root.dataset.empty,
    );
}

function setActive(parts: Parts, option: HTMLElement | undefined): void {
  for (const each of parts.options) each.toggleAttribute("data-active", each === option);
  if (option) {
    parts.list.setAttribute("aria-activedescendant", option.id);
    option.scrollIntoView({ block: "nearest" });
  } else parts.list.removeAttribute("aria-activedescendant");
}

function isOpen(parts: Parts): boolean {
  return !parts.list.hidden;
}

function open(parts: Parts, byKeyboard: boolean): void {
  for (const other of document.querySelectorAll<HTMLElement>(ROOT)) {
    const each = other === parts.root ? null : partsOf(other);
    if (each && isOpen(each)) close(each, false);
  }
  // Open upward when the room below is shorter than the list and the room above is not.
  parts.list.hidden = false;
  const field = parts.trigger.getBoundingClientRect();
  const needed = parts.list.offsetHeight;
  const below = window.innerHeight - field.bottom;
  parts.list.toggleAttribute("data-above", below < needed && field.top > needed);
  parts.trigger.setAttribute("aria-expanded", "true");
  parts.list.toggleAttribute("data-keyboard", byKeyboard);
  const first = parts.options.find((option) => enabled(option) && selected(option));
  setActive(parts, first ?? parts.options.find(enabled));
  parts.list.focus({ preventScroll: true });
}

function close(parts: Parts, refocus: boolean): void {
  parts.list.hidden = true;
  parts.trigger.setAttribute("aria-expanded", "false");
  setActive(parts, undefined);
  if (refocus) parts.trigger.focus();
}

function toggle(parts: Parts, option: HTMLElement): void {
  if (!enabled(option)) return;
  const now = !selected(option);
  option.setAttribute("aria-selected", String(now));
  const input = inputOf(parts, option);
  if (input) {
    input.checked = now;
    // As a checkbox would: input, then change.
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  sayChosen(parts);
}

function move(parts: Parts, step: number | "first" | "last"): void {
  const choosable = parts.options.filter(enabled);
  if (choosable.length === 0) return;
  const current = choosable.findIndex((option) => option.hasAttribute("data-active"));
  const index =
    step === "first"
      ? 0
      : step === "last"
        ? choosable.length - 1
        : Math.min(choosable.length - 1, Math.max(0, (current < 0 ? -1 : current) + step));
  setActive(parts, choosable[index]);
}

function rootOf(target: EventTarget | null): Parts | null {
  const root = target instanceof Element ? target.closest<HTMLElement>(ROOT) : null;
  return root ? partsOf(root) : null;
}

function onClick(event: MouseEvent): void {
  const parts = rootOf(event.target);
  // A press outside every list closes the open one.
  for (const root of document.querySelectorAll<HTMLElement>(ROOT)) {
    const each = partsOf(root);
    if (each && isOpen(each) && each.root !== parts?.root) close(each, false);
  }
  if (!parts || !(event.target instanceof Element)) return;
  if (event.target.closest(".multiselect-trigger")) {
    if (isOpen(parts)) close(parts, false);
    else open(parts, event.detail === 0);
    return;
  }
  const option = event.target.closest<HTMLElement>("[role=option]");
  if (option) {
    parts.list.removeAttribute("data-keyboard");
    setActive(parts, option);
    toggle(parts, option);
  }
}

function onKeydown(event: KeyboardEvent): void {
  const parts = rootOf(event.target);
  if (!parts || !(event.target instanceof Element)) return;
  if (event.target.closest(".multiselect-trigger") && !isOpen(parts)) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      open(parts, true);
    }
    return;
  }
  if (!isOpen(parts) || event.target !== parts.list) return;
  parts.list.setAttribute("data-keyboard", "");
  const active = parts.options.find((option) => option.hasAttribute("data-active"));
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      move(parts, 1);
      break;
    case "ArrowUp":
      event.preventDefault();
      move(parts, -1);
      break;
    case "Home":
      event.preventDefault();
      move(parts, "first");
      break;
    case "End":
      event.preventDefault();
      move(parts, "last");
      break;
    case " ":
    case "Enter":
      event.preventDefault();
      if (active) toggle(parts, active);
      break;
    case "Escape":
      // The list closes, not the panel it sits in.
      event.preventDefault();
      event.stopPropagation();
      close(parts, true);
      break;
    case "Tab":
      close(parts, false);
      break;
  }
}

function onFocusout(event: FocusEvent): void {
  const parts = rootOf(event.target);
  if (!parts || !isOpen(parts)) return;
  const next = event.relatedTarget;
  if (next instanceof Node && parts.root.contains(next)) return;
  // A press on an option moves focus nowhere first; only leaving for elsewhere closes.
  if (next !== null) close(parts, false);
}

let installed = false;

/** Listens once for every MultiSelect, now and later. */
export function installMultiSelect(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("click", onClick);
  // Capture, so Escape closes the list before a dialog around it hears the key.
  document.addEventListener("keydown", onKeydown, true);
  document.addEventListener("focusout", onFocusout);
}
