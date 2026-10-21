/**
 * The header's More menu (components/HeroMenu.astro): keys, focus and placement around the browser's
 * own popover. The listeners sit on the document, so they outlive a client-side navigation that
 * swaps the menu for another page's. Loaded by the briefing and episode pages.
 */
import { pullToDismiss } from "./pullDismiss";

const LIST = ".hero-menu-list";
const wired = new WeakSet<Element>();

const itemsOf = (list: Element): HTMLElement[] =>
  Array.from(list.querySelectorAll<HTMLElement>('[role="menuitem"]'));

const moreOf = (list: Element): HTMLElement | null =>
  list.parentElement?.querySelector<HTMLElement>("[data-hero-more]") ?? null;

let installed = false;

export function installHeroMenu(): void {
  if (installed) return;
  installed = true;

  // A light dismiss: the press that closed the menu landed outside it and its button.
  let pressedOutside = false;
  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target as Element;
      pressedOutside = !target.closest?.(`${LIST}, [data-hero-more]`);
    },
    true,
  );

  // toggle events do not bubble, so they are caught on the way down.
  document.addEventListener(
    "beforetoggle",
    (event) => {
      const list = event.target as HTMLElement;
      if (!list.matches?.(LIST) || (event as ToggleEvent).newState !== "open") return;
      // A phone shows the menu as a sheet: pulled down, it closes (light dismiss is the popover's own).
      if (list.matches(".menu-sheet") && !wired.has(list)) {
        wired.add(list);
        pullToDismiss(list, () => list.hidePopover());
      }
      // Without anchor positioning the menu is placed from the button's box.
      if (CSS.supports("top", "anchor(bottom)")) return;
      const box = moreOf(list)?.getBoundingClientRect();
      if (!box) return;
      list.style.setProperty("--menu-top", `${box.bottom + 4}px`);
      list.style.setProperty(
        "--menu-right",
        `${document.documentElement.clientWidth - box.right}px`,
      );
    },
    true,
  );

  document.addEventListener(
    "toggle",
    (event) => {
      const list = event.target as HTMLElement;
      if (!list.matches?.(LIST)) return;
      if ((event as ToggleEvent).newState === "open") {
        pressedOutside = false;
        itemsOf(list)[0]?.focus();
      }
      // Escape or a pick: focus goes back to the button. A press elsewhere keeps its own focus,
      // even when it landed on nothing focusable: a button left focused that way took the next
      // Space, which opened the menu again instead of playing (2026-10-20).
      else if (
        list.contains(document.activeElement) ||
        (document.activeElement === document.body && !pressedOutside)
      )
        moreOf(list)?.focus();
    },
    true,
  );

  document.addEventListener("keydown", (event) => {
    const list = (event.target as Element).closest?.(LIST);
    if (!list) return;
    const all = itemsOf(list);
    const at = all.indexOf(document.activeElement as HTMLElement);
    const to =
      event.key === "ArrowDown"
        ? at + 1
        : event.key === "ArrowUp"
          ? at - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? all.length - 1
              : null;
    if (to === null) return;
    event.preventDefault();
    all[(to + all.length) % all.length]?.focus();
  });

  // Tabbing out leaves nothing open behind.
  document.addEventListener("focusout", (event) => {
    const list = (event.target as Element).closest?.(LIST);
    const next = event.relatedTarget as Node | null;
    if (list && next && !list.contains(next) && next !== moreOf(list)) {
      (list as HTMLElement).hidePopover();
    }
  });

  // The sheet's Close (the header of a phone's menu).
  document.addEventListener("click", (event) => {
    const close = (event.target as Element).closest?.("[data-menu-close]");
    close?.closest<HTMLElement>("[popover]")?.hidePopover();
  });

  // A pick closes the menu first; what it opened (the share sheet, a panel) comes after. A disabled
  // item never gets here: the shell's guard stops its click.
  document.addEventListener("click", (event) => {
    const item = (event.target as Element).closest?.<HTMLElement>(`${LIST} [role="menuitem"]`);
    if (item) item.closest<HTMLElement>(LIST)?.hidePopover();
  });
}
