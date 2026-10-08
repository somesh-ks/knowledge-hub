/**
 * The header's More menu (components/HeroMenu.astro): keys, focus and placement around the browser's
 * own popover. The listeners sit on the document, so they outlive a client-side navigation that
 * swaps the menu for another page's. Loaded by the briefing and episode pages.
 */
const LIST = ".hero-menu-list";

const itemsOf = (list: Element): HTMLElement[] =>
  Array.from(list.querySelectorAll<HTMLElement>('[role="menuitem"]'));

const moreOf = (list: Element): HTMLElement | null =>
  list.parentElement?.querySelector<HTMLElement>("[data-hero-more]") ?? null;

let installed = false;

export function installHeroMenu(): void {
  if (installed) return;
  installed = true;

  // toggle events do not bubble, so they are caught on the way down.
  document.addEventListener(
    "beforetoggle",
    (event) => {
      const list = event.target as HTMLElement;
      if (!list.matches?.(LIST) || (event as ToggleEvent).newState !== "open") return;
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
      if ((event as ToggleEvent).newState === "open") itemsOf(list)[0]?.focus();
      // Escape or a pick: focus goes back to the button. A press elsewhere keeps its own focus.
      else if (list.contains(document.activeElement) || document.activeElement === document.body)
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

  // A pick closes the menu first; what it opened (the share sheet, a panel) comes after. A disabled
  // item never gets here: the shell's guard stops its click.
  document.addEventListener("click", (event) => {
    const item = (event.target as Element).closest?.<HTMLElement>(`${LIST} [role="menuitem"]`);
    if (item) item.closest<HTMLElement>(LIST)?.hidePopover();
  });
}
