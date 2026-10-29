/** The side column's accordion: the chevron opens and closes Foundations' pages. */
export {};

for (const toggle of document.querySelectorAll<HTMLButtonElement>("[data-nav-toggle]")) {
  const list = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    if (list) list.hidden = !open;
  });
}
