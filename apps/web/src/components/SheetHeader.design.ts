import { defineSpec, esc, icon, str } from "../lib/designSpec";

/** A sheet's one header row (SheetHeader.astro, lib/sheetHead.ts): the title at the start, Close at the end. */
export default defineSpec({
  id: "sheet-header",
  title: "Sheet header",
  level: "molecule",
  category: "Overlays",
  summary:
    "The one row at the top of every sheet and dialog: the title at the start, Close at the end.",
  frame: "wide",
  usage: { sheet: "create-sheet.css", selector: ".create-sheet-head" },
  classes: ["create-sheet-head", "sheet-title"],
  decisions: ["D132", "D144", "D152"],
  guidance: [
    "The same markup in every sheet at every width. Full-screen phone sheets show Close; a partial sheet (a menu, the emoji picker) hides it below 40rem, where it is pulled down or tapped away.",
    "Once a form has scrolled under it, the header takes the container tone, so its edge shows only when there is something under it.",
  ],
  controls: [
    { kind: "text", id: "title", label: "Title", group: "Content", value: "More actions", max: 24 },
  ],
  render: (state) =>
    `<div class="create-sheet-head"><h2 class="sheet-title" id="sheet-sample-title">${esc(str(state.title, "More actions"))}</h2><button class="icon-btn press" type="button" aria-label="Close" data-dialog-close>${icon("close", "icon-lg")}</button></div>`,
});
