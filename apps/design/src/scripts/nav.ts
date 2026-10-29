/** The side column's accordion: the chevron opens and closes Foundations' pages; and which link is current. */
export {};

for (const toggle of document.querySelectorAll<HTMLButtonElement>("[data-nav-toggle]")) {
  const list = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    if (list) list.hidden = !open;
  });
}

// The bottom bar has no room for a page's children, so there the group is the destination. In the side
// column the child is, and the group steps back, so a screen reader hears one current page.
const wide = matchMedia("(width >= 64rem)");
function syncCurrent(): void {
  for (const group of document.querySelectorAll<HTMLElement>("[data-group-current]")) {
    if (wide.matches) group.removeAttribute("aria-current");
    else group.setAttribute("aria-current", "page");
  }
}
wide.addEventListener("change", syncCurrent);
syncCurrent();
