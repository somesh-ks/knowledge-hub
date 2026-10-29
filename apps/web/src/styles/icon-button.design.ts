import { attr, defineSpec, icon, on, str } from "../lib/designSpec";
import type { IconName } from "../lib/icons";

const GLYPHS: Record<string, { name: IconName; label: string }> = {
  more: { name: "moreVert", label: "More" },
  close: { name: "close", label: "Close" },
  edit: { name: "pencilSimple", label: "Edit" },
};

/**
 * The icon button in the places the app draws it. The kinds are one part: a glyph in a 44px round
 * target with a state layer. Each kind is the markup of its place (RunStatus, the blocked sources
 * list, the Library's search field, the toaster, the suggested sources).
 */
export default defineSpec({
  id: "icon-button",
  title: "Icon button",
  level: "atom",
  category: "Actions",
  summary:
    "A glyph in a round 44px target, quiet until it is used. Its press shows as a layer, never as a moving glyph.",
  frame: "narrow",
  usage: [
    { sheet: "buttons.css", selector: ".icon-btn" },
    { sheet: "buttons.css", selector: ".icon-btn-end" },
  ],
  classes: [
    "icon-btn",
    "icon-btn-end",
    "press",
    "search-clear",
    "toast-dismiss",
    "source-plus-btn",
  ],
  decisions: ["D72", "D187"],
  controls: [
    {
      kind: "choice",
      id: "kind",
      label: "Kind",
      group: "Variant",
      value: "standard",
      options: [
        { value: "standard", label: "Standard" },
        { value: "end", label: "Row end" },
        { value: "clear", label: "Clear" },
        { value: "dismiss", label: "Dismiss" },
        { value: "add", label: "Add" },
      ],
    },
    {
      kind: "choice",
      id: "glyph",
      label: "Glyph",
      group: "Content",
      value: "more",
      options: [
        { value: "more", label: "More" },
        { value: "close", label: "Close" },
        { value: "edit", label: "Edit" },
      ],
    },
    { kind: "toggle", id: "added", label: "Added (Add)", group: "State", value: false },
    { kind: "toggle", id: "disabled", label: "Disabled", group: "State", value: false },
  ],
  render: (state) => {
    const kind = str(state.kind, "standard");
    const glyph = GLYPHS[str(state.glyph, "more")] ?? { name: "moreVert", label: "More" };
    const disabled = attr("disabled", state.disabled);
    if (kind === "end")
      // blocked-outlets.astro: the button ends a settings row and its ink lands on the row's end.
      return `<div class="settings-row"><span class="settings-label">example.com</span><button class="icon-btn icon-btn-end press" type="button" aria-label="${glyph.label}"${disabled}>${icon(glyph.name)}</button></div>`;
    if (kind === "clear")
      // library.astro: the field's own clear button, shown while the field has text.
      return `<div class="search-wrap"><label class="search-field">${icon("search")}<span class="sr-only">Search your library</span><input type="search" name="q" value="briefing" autocomplete="off" /></label><button class="search-clear press press-subtle" type="button" aria-label="Clear text"${disabled}>${icon("close")}</button></div>`;
    if (kind === "dismiss")
      // Toaster.tsx. A toast is a popover that is closed until script opens it, so the sample sets
      // the open state by hand.
      return `<div class="toast" style="position: static; display: flex; opacity: 1; transform: none; margin-inline: 0; max-width: none"><span class="toast-text">Removed</span><button class="toast-action" type="button">Undo</button><button class="toast-dismiss press" type="button" aria-label="Dismiss"${disabled}>${icon("close")}</button></div>`;
    if (kind === "add")
      // SuggestedSources.astro: the plus is replaced by an accent check in the same slot.
      return `<button class="source-plus-btn press${on(state.added) ? " is-added" : ""}" type="button" aria-label="Add source"${disabled}>${icon("plus", "suggested-plus")}${icon("check", "suggested-check")}</button>`;
    return `<button class="icon-btn press" type="button" aria-label="${glyph.label}"${disabled}>${icon(glyph.name)}</button>`;
  },
});
