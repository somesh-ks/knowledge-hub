/**
 * A select with a search box. The page carries a plain select with `data-picker`; this hides it and
 * puts a button in its place that opens a list under a search field, as a time zone or a voice is
 * chosen from a long list. The select stays in the page and holds the value: a choice sets it and
 * fires its `change`, so whatever listens for a select (the settings editor, the Create form) hears
 * the choice as it always did, and the page works as it was while this has not loaded.
 *
 * The list is a popover, so it sits over everything, closes on Escape or a press outside, and works
 * inside a dialog. The search keeps every word of the query in any order (lib/pickerFilter.ts).
 * Loaded after the page is up (podcastPage.ts, createPage.ts), so it costs no first load.
 *
 * Options come from the select's own options when the list opens, so a list filled later (the
 * voices) needs no call: a script that changes the options or the value without a `change` sends
 * `picker:sync` to the select to bring the button's words up to date.
 */
import { matchesQuery, pickerCount, pickerNoMatch } from "../lib/pickerFilter";
import { FLOATING, roomFloor } from "../lib/roomFloor";

const GAP_PX = 8;
const MIN_WIDTH_PX = 288;
const MAX_HEIGHT_PX = 384;
const MIN_ROOM_PX = 176;

let uid = 0;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

interface Choice {
  value: string;
  label: string;
  /** What the search also reads: a voice's accent, a zone's offset. */
  keywords: string;
}

function mountPicker(select: HTMLSelectElement): void {
  const holder = select.parentElement;
  if (!holder || select.dataset.pickerReady !== undefined) return;
  select.dataset.pickerReady = "";
  const id = `picker-${++uid}`;
  const noun = select.dataset.picker || "option";
  const label = select.id
    ? document.querySelector<HTMLLabelElement>(`label[for="${select.id}"]`)
    : null;

  // The button takes the select's id, so its label points at it and a press on the label opens the list.
  const trigger = element("button", "picker-trigger");
  trigger.type = "button";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", `${id}-pop`);
  trigger.setAttribute("popovertarget", `${id}-pop`);
  const value = element("span", "picker-value");
  value.id = `${id}-value`;
  trigger.append(value);
  if (select.id) {
    trigger.id = select.id;
    select.id = `${select.id}-native`;
  }
  // The name: its label and the value, or the select's own aria-label, kept in step (the Create form
  // renames its voice selects once the hosts' names are known).
  const name = (): void => {
    const own = select.getAttribute("aria-label");
    if (own) {
      trigger.removeAttribute("aria-labelledby");
      trigger.setAttribute("aria-label", `${own}: ${value.textContent}`);
    } else if (label) {
      label.id ||= `${id}-label`;
      trigger.removeAttribute("aria-label");
      trigger.setAttribute("aria-labelledby", `${label.id} ${value.id}`);
    }
  };

  const pop = element("div", "picker-pop");
  pop.id = `${id}-pop`;
  pop.setAttribute("popover", "auto");
  pop.tabIndex = -1;
  const search = element("div", "picker-search");
  const glass = element("span", "picker-glass");
  glass.setAttribute("aria-hidden", "true");
  const input = element("input", "picker-input");
  input.type = "search";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", `${id}-list`);
  input.placeholder = `Search ${noun}s`;
  input.autocomplete = "off";
  input.autocapitalize = "off";
  input.spellcheck = false;
  input.enterKeyHint = "go";
  input.setAttribute("aria-label", `Search ${noun}s`);
  search.append(glass, input);
  const note = element("p", "picker-note");
  note.hidden = true;
  const list = element("div", "picker-list");
  list.id = `${id}-list`;
  list.setAttribute("role", "listbox");
  const count = element("p", "sr-only");
  count.setAttribute("aria-live", "polite");
  pop.append(search, note, list, count);

  holder.classList.add("picker");
  select.classList.add("picker-native");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  select.before(trigger);
  holder.append(pop);

  let choices: Choice[] = [];
  let shown: Choice[] = [];
  let active = -1;

  const readChoices = (): Choice[] =>
    [...select.options].map((option) => ({
      value: option.value,
      label: option.textContent ?? "",
      keywords: option.dataset.keywords ?? "",
    }));

  const sync = (): void => {
    const chosen = select.selectedOptions[0];
    value.textContent = chosen?.textContent ?? "";
    name();
  };

  const isOpen = (): boolean => pop.matches(":popover-open");

  const highlight = (index: number, block: ScrollLogicalPosition = "nearest"): void => {
    active = index;
    list.querySelectorAll<HTMLElement>("[role=option]").forEach((item, at) => {
      item.toggleAttribute("data-active", at === index);
    });
    const item = list.querySelectorAll<HTMLElement>("[role=option]")[index];
    if (item) {
      input.setAttribute("aria-activedescendant", item.id);
      // Only the list scrolls: scrollIntoView would move the page under it as well.
      const here = item.getBoundingClientRect();
      const frame = list.getBoundingClientRect();
      const top = here.top - frame.top + list.scrollTop;
      if (block === "center") list.scrollTop = top - (list.clientHeight - here.height) / 2;
      else if (top < list.scrollTop) list.scrollTop = top;
      else if (top + here.height > list.scrollTop + list.clientHeight)
        list.scrollTop = top + here.height - list.clientHeight;
    } else input.removeAttribute("aria-activedescendant");
  };

  const draw = (query: string, from?: number): void => {
    shown = choices.filter((choice) => matchesQuery(`${choice.label} ${choice.keywords}`, query));
    list.replaceChildren(
      ...shown.map((choice, index) => {
        const item = element("div", "picker-option");
        item.id = `${id}-option-${index}`;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(choice.value === select.value));
        item.dataset.index = String(index);
        item.append(element("span", "picker-option-name", choice.label));
        return item;
      }),
    );
    if (shown.length === 0) list.append(element("p", "picker-empty", pickerNoMatch(query, noun)));
    count.textContent = pickerCount(shown.length, noun);
    const start =
      from ??
      (query.trim() === "" ? shown.findIndex((choice) => choice.value === select.value) : 0);
    highlight(shown.length === 0 ? -1 : Math.max(start, 0));
  };

  /** Under the button, as wide as the room asks, and above it when the room below is short. */
  const place = (): void => {
    const field = trigger.getBoundingClientRect();
    const wide = field.width >= MIN_WIDTH_PX;
    const width = Math.min(wide ? field.width : MIN_WIDTH_PX, window.innerWidth - GAP_PX * 2);
    // A value at the end of a row opens its list toward the start of the row, as a native one does.
    const left = wide ? field.left : field.right - width;
    const placedLeft = Math.max(GAP_PX, Math.min(left, window.innerWidth - width - GAP_PX));
    pop.style.width = `${width}px`;
    pop.style.left = `${placedLeft}px`;
    const covers = [...document.querySelectorAll<HTMLElement>(FLOATING)].map((node) =>
      node.getBoundingClientRect(),
    );
    const below = roomFloor(field, covers, window.innerHeight) - field.bottom - GAP_PX * 2;
    const above = field.top - GAP_PX * 2;
    const wants = Math.min(pop.scrollHeight, MAX_HEIGHT_PX);
    const flip = below < wants && above > below;
    const room = Math.max(Math.min(flip ? above : below, MAX_HEIGHT_PX), MIN_ROOM_PX);
    pop.style.maxHeight = `${room}px`;
    pop.dataset.side = flip ? "above" : "below";
    // It grows from the button: the origin is the button's centre, on the edge that faces it.
    pop.style.transformOrigin = `${Math.round(field.left + field.width / 2 - placedLeft)}px ${flip ? "100%" : "0"}`;
    pop.style.top = flip
      ? `${Math.max(GAP_PX, field.top - GAP_PX - Math.min(pop.offsetHeight, room))}px`
      : `${field.bottom + GAP_PX}px`;
  };

  /** Whether the list was opened from the keyboard: only then does its current row show a ring. */
  let viaKey = false;

  const close = (): void => {
    if (isOpen()) pop.hidePopover();
  };

  const choose = (choice: Choice): void => {
    const changed = select.value !== choice.value;
    select.value = choice.value;
    sync();
    // The row now reads as the chosen one, so the press that chose it sounds as a choice.
    for (const item of list.querySelectorAll<HTMLElement>("[role=option]")) {
      item.setAttribute("aria-selected", String(shown[Number(item.dataset.index)] === choice));
    }
    close();
    trigger.focus({ preventScroll: true });
    // The change a select makes: a script that edits the choices in the page listens for it.
    if (changed) {
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  // The button opens and closes the popover itself (popovertarget), so its own press never closes the
  // list and opens it again. The rows are drawn before the list shows and placed as it does.
  pop.addEventListener("beforetoggle", (event) => {
    if ((event as ToggleEvent).newState !== "open") return;
    // Hidden until it is placed, so it never shows for a frame where it was last time.
    delete pop.dataset.placed;
    choices = readChoices();
    note.hidden = !select.dataset.note;
    note.textContent = select.dataset.note ?? "";
    input.value = "";
    list.toggleAttribute("data-keyboard", viaKey);
    draw("");
  });
  pop.addEventListener("toggle", (event) => {
    const opening = (event as ToggleEvent).newState === "open";
    trigger.setAttribute("aria-expanded", String(opening));
    if (opening) {
      place();
      pop.dataset.placed = "";
      // The chosen row comes into the middle of a long list, not to its foot.
      highlight(active, "center");
      // A finger keeps the list in view: the keyboard that a focused field brings up would cover it.
      if (viaKey || !matchMedia("(pointer: coarse)").matches) input.focus({ preventScroll: true });
      // With a finger the keyboard would cover the list, so the search is left to a tap; focus still
      // goes into the list, for a screen reader that follows it there.
      else pop.focus({ preventScroll: true });
      return;
    }
    if (document.activeElement === document.body || pop.contains(document.activeElement))
      trigger.focus({ preventScroll: true });
  });

  trigger.addEventListener("pointerdown", () => {
    viaKey = false;
  });
  trigger.addEventListener("keydown", (event) => {
    if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) viaKey = true;
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !isOpen()) {
      event.preventDefault();
      pop.showPopover();
    }
  });

  input.addEventListener("input", () => draw(input.value));
  input.addEventListener("keydown", (event) => {
    const { key } = event;
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      list.toggleAttribute("data-keyboard", true);
      if (shown.length === 0) return;
      const next =
        key === "ArrowDown"
          ? active >= shown.length - 1
            ? 0
            : active + 1
          : active <= 0
            ? shown.length - 1
            : active - 1;
      highlight(next);
    } else if (key === "Enter") {
      event.preventDefault();
      const choice = shown[active];
      if (choice) choose(choice);
    } else if (key === "Escape") {
      // A search field clears itself on Escape and leaves the list open; here Escape closes the list,
      // as it does everywhere else, whatever is typed.
      event.preventDefault();
      close();
    } else if (key === "Tab") {
      close();
    }
  });
  // The pointer takes over from the keyboard: the hover tint shows the row, the ring goes.
  list.addEventListener("pointermove", () => list.removeAttribute("data-keyboard"));
  list.addEventListener("click", (event) => {
    const item = (event.target as Element).closest<HTMLElement>("[role=option]");
    const choice = item ? shown[Number(item.dataset.index)] : undefined;
    if (choice) choose(choice);
  });
  // Pressing a row must not take the focus off the search first, or a touch scroll would blur it.
  list.addEventListener("pointerdown", (event) => event.preventDefault());

  window.addEventListener("resize", () => {
    if (isOpen()) place();
  });
  // The list is placed under its button once. A scroll of the page or the sheet carries the button
  // away from it, so it closes then, as the speed panel does; the list's own scroll is its own.
  document.addEventListener(
    "scroll",
    (event) => {
      if (isOpen() && !pop.contains(event.target as Node)) close();
    },
    { capture: true, passive: true },
  );
  // Shown rows follow the list when the page changes it (the voices arrive after the page).
  const refresh = (): void => {
    sync();
    if (isOpen()) {
      choices = readChoices();
      draw(input.value);
    }
  };
  select.addEventListener("picker:sync", refresh);
  select.addEventListener("change", sync);
  new MutationObserver(refresh).observe(select, {
    childList: true,
    attributes: true,
    attributeFilter: ["aria-label"],
  });

  sync();
}

/**
 * Turns every select marked `data-picker` under the root into a searchable list, and marks the root
 * (`data-pickers`) once they are, so a test, or a script, knows the buttons are there.
 */
export function mountPickers(root: ParentNode = document): void {
  for (const select of root.querySelectorAll<HTMLSelectElement>("select[data-picker]")) {
    mountPicker(select);
  }
  if (root instanceof HTMLElement) root.dataset.pickers = "";
}
