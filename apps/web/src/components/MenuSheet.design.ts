import { attr, defineSpec, icon, on, str } from "../lib/designSpec";

/**
 * The menu as a ⋮ button opens it (MenuSheet.astro, HeroMenu.astro, LibraryItemMenu.astro). It is a
 * popover that lives in the top layer, so the guide holds it in place with the open state's own values.
 */
const IN_PLACE = "position:static;display:block;opacity:1;transform:none;margin-block-start:0";

const item = (glyph: Parameters<typeof icon>[0], label: string, extra = "") =>
  `<button class="hero-menu-item${extra}" type="button" role="menuitem">${icon(glyph)}${label}</button>`;

export default defineSpec({
  id: "menu",
  title: "Menu",
  level: "molecule",
  category: "Overlays",
  summary:
    "The small list behind a ⋮ button: a few rows, each a glyph and a word. A bottom sheet on a phone, a popover under its button from 40rem.",
  frame: "wide",
  usage: { sheet: "hero.css", selector: ".hero-menu-item" },
  classes: ["hero-menu-list", "menu-sheet", "hero-menu-item", "hero-menu-delete"],
  decisions: ["D127", "D132", "D144", "D214"],
  guidance: [
    "Rows are buttons with role menuitem, each with its glyph at the start. A press fills the row and never scales its words.",
    "Red marks the one row that destroys, and the confirm still asks before anything is removed. A row that must wait is disabled, with the reason in its title.",
    "The header shows on a phone only. From 40rem the menu hangs under its button and the header is the sheet's alone.",
  ],
  controls: [
    {
      kind: "choice",
      id: "menu",
      label: "Menu",
      group: "Variant",
      value: "row",
      options: [
        { value: "row", label: "Library row" },
        { value: "page", label: "Page" },
      ],
    },
    { kind: "toggle", id: "destructive", label: "Delete row", group: "State", value: true },
    { kind: "toggle", id: "waiting", label: "Regenerate waits", group: "State", value: false },
  ],
  render: (state) => {
    const row = str(state.menu, "row") === "row";
    const waiting = on(state.waiting);
    const regenerate = `<button class="hero-menu-item" type="button" role="menuitem"${attr("disabled", waiting)}>${icon("refresh")}Regenerate</button>`;
    const items = [
      item("download", "Download"),
      item("queueAdd", "Add to queue"),
      regenerate,
      row ? item("shareArrow", "Share") : "",
      on(state.destructive) ? item("trash", "Delete", " hero-menu-delete") : "",
    ].join("");
    return `<div class="hero-menu-list menu-sheet" id="menu-sample" popover style="${IN_PLACE}"><div class="create-sheet-head"><h2 class="sheet-title" id="menu-sample-title">More actions</h2><button class="icon-btn press" type="button" aria-label="Close" data-menu-close>${icon("close", "icon-lg")}</button></div><div class="menu-sheet-items" role="menu" aria-label="More actions">${items}</div></div>`;
  },
});
