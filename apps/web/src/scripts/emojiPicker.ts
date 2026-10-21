/**
 * The emoji picker (components/EmojiPicker.astro), loaded when the topic's emoji is first tapped. It
 * fills the popover with the Suggested row at once and the whole list, fetched then, by category
 * under sticky labels; a search narrows it by name and keyword. Arrow keys move through the grid,
 * Enter picks, Escape closes (the popover's own). Picking calls back with the emoji and closes.
 */
import { type EmojiGroup, type EmojiItem, searchEmoji, suggestedEmoji } from "../lib/emojiSearch";
import { fitAboveKeyboard } from "./keyboardFit";
import { element } from "./topicsView";

const WIDE = "(min-width: 40rem)";

let groups: Promise<EmojiGroup[]> | undefined;
/** The list, fetched the first time the picker opens and kept for the page. */
const loadGroups = (): Promise<EmojiGroup[]> =>
  (groups ??= fetch("/emoji.json")
    .then((response) => {
      if (!response.ok) throw new Error(String(response.status));
      return response.json() as Promise<{ groups: EmojiGroup[] }>;
    })
    .then((file) => file.groups)
    .catch((error) => {
      groups = undefined;
      throw error;
    }));

const cell = (emoji: string, name: string, current: string): HTMLButtonElement => {
  const button = element("button", "emoji-cell press press-subtle", emoji) as HTMLButtonElement;
  button.type = "button";
  button.tabIndex = -1;
  button.dataset.emoji = emoji;
  if (name) button.setAttribute("aria-label", name);
  if (emoji === current) button.setAttribute("aria-current", "true");
  return button;
};

const section = (label: string, cells: HTMLElement[]): HTMLElement => {
  const block = element("section", "emoji-section");
  const title = element("h3", "emoji-label", label);
  const grid = element("div", "emoji-grid");
  grid.append(...cells);
  block.append(title, grid);
  return block;
};

/** The next cell up or down the grid: the first one in the next row nearest the cell's own column. */
function across(cells: HTMLElement[], from: HTMLElement, step: 1 | -1): HTMLElement | undefined {
  const start = from.getBoundingClientRect();
  const at = cells.indexOf(from);
  let row: HTMLElement[] = [];
  let top = Number.NaN;
  for (let i = at + step; i >= 0 && i < cells.length; i += step) {
    const box = (cells[i] as HTMLElement).getBoundingClientRect();
    if (Math.abs(box.top - start.top) < 2) continue;
    if (Number.isNaN(top)) top = box.top;
    if (Math.abs(box.top - top) >= 2) break;
    row.push(cells[i] as HTMLElement);
  }
  row = row.filter(Boolean);
  return row.sort(
    (a, b) =>
      Math.abs(a.getBoundingClientRect().left - start.left) -
      Math.abs(b.getBoundingClientRect().left - start.left),
  )[0];
}

export function openEmojiPicker(
  opener: HTMLElement,
  name: string,
  current: string,
  choose: (emoji: string) => void,
): void {
  const picker = document.getElementById("emoji-picker");
  const body = picker?.querySelector<HTMLElement>("[data-emoji-body]");
  const input = picker?.querySelector<HTMLInputElement>("[data-emoji-q]");
  const clear = picker?.querySelector<HTMLButtonElement>("[data-emoji-clear]");
  if (!picker || !body || !input || !clear) return;

  let all: EmojiGroup[] = [];
  let status = "";
  const names = new Map<string, string>();

  const cells = (): HTMLElement[] => [...body.querySelectorAll<HTMLElement>(".emoji-cell")];
  /** One cell can be tabbed to, the one last focused: the grid is one stop, not hundreds. */
  const rove = (to: HTMLElement | undefined): void => {
    for (const other of body.querySelectorAll<HTMLElement>('.emoji-cell[tabindex="0"]'))
      other.tabIndex = -1;
    if (to) to.tabIndex = 0;
  };
  const named = (item: EmojiItem): HTMLButtonElement => cell(item[0], item[1], current);

  const draw = (): void => {
    const query = input.value.trim();
    clear.hidden = input.value === "";
    body.replaceChildren();
    if (query !== "") {
      const found = searchEmoji(all, query);
      if (found.length === 0) body.append(element("p", "emoji-note", `No emoji for "${query}"`));
      else body.append(section("Results", found.map(named)));
    } else {
      const suggested = suggestedEmoji(name, current).map((emoji) =>
        cell(emoji, names.get(emoji) ?? "", current),
      );
      body.append(section("Suggested", suggested));
      for (const group of all) body.append(section(group.name, group.emoji.map(named)));
      if (status) body.append(element("p", "emoji-note", status));
    }
    rove(cells()[0]);
  };

  const prepare = (): void => {
    input.value = "";
    status = "Loading emoji";
    draw();
    loadGroups().then(
      (loaded) => {
        all = loaded;
        for (const group of loaded) for (const item of group.emoji) names.set(item[0], item[1]);
        status = "";
        if (picker.matches(":popover-open")) draw();
      },
      () => {
        status = "The emoji list did not load. Suggested emoji still work.";
        if (picker.matches(":popover-open")) draw();
      },
    );
  };

  const stop = new AbortController();
  const { signal } = stop;
  let undoFit = (): void => {};

  input.addEventListener("input", draw, { signal });
  clear.addEventListener(
    "click",
    () => {
      input.value = "";
      draw();
      input.focus();
    },
    { signal },
  );
  body.addEventListener(
    "click",
    (event) => {
      const emoji = (event.target as Element).closest<HTMLElement>(".emoji-cell")?.dataset.emoji;
      if (!emoji) return;
      choose(emoji);
      picker.hidePopover();
    },
    { signal },
  );
  body.addEventListener(
    "focusin",
    (event) => rove((event.target as Element).closest<HTMLElement>(".emoji-cell") ?? undefined),
    { signal },
  );
  picker.addEventListener(
    "keydown",
    (event) => {
      const target = event.target as HTMLElement;
      const key = event.key;
      if (target === input) {
        if (key === "ArrowDown") {
          event.preventDefault();
          (body.querySelector<HTMLElement>('.emoji-cell[tabindex="0"]') ?? cells()[0])?.focus();
        }
        return;
      }
      if (!target.matches(".emoji-cell")) return;
      const list = cells();
      const at = list.indexOf(target);
      const to =
        key === "ArrowRight"
          ? list[at + 1]
          : key === "ArrowLeft"
            ? list[at - 1]
            : key === "ArrowDown"
              ? across(list, target, 1)
              : key === "ArrowUp"
                ? across(list, target, -1)
                : undefined;
      if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(key)) return;
      event.preventDefault();
      if (to) {
        to.focus();
        to.scrollIntoView({ block: "nearest" });
      } else if (key === "ArrowUp" || key === "ArrowLeft") input.focus();
    },
    { signal },
  );
  picker.addEventListener(
    "beforetoggle",
    (event) => {
      if ((event as ToggleEvent).newState !== "open") return;
      // Without anchor positioning the popover is placed from the emoji button's box.
      if (CSS.supports("top", "anchor(bottom)")) return;
      const box = opener.getBoundingClientRect();
      picker.style.setProperty("--menu-top", `${box.bottom + 4}px`);
      picker.style.setProperty("--menu-left", `${box.left}px`);
    },
    { signal },
  );
  picker.addEventListener(
    "toggle",
    (event) => {
      if ((event as ToggleEvent).newState !== "closed") return;
      stop.abort();
      undoFit();
      opener.focus();
    },
    { signal },
  );

  prepare();
  if (!matchMedia(WIDE).matches) undoFit = fitAboveKeyboard(picker);
  picker.showPopover();
  // A phone keeps its keyboard down until the search is tapped.
  if (matchMedia(WIDE).matches) input.focus();
  else cells()[0]?.focus();
}
