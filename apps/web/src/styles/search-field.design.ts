import { attr, defineSpec, esc, icon, on, str } from "../lib/designSpec";

/** The Library's search field, which Sources, a topic's page and the emoji picker also draw. */
export default defineSpec({
  id: "search-field",
  title: "Search field",
  level: "molecule",
  category: "Inputs",
  summary:
    "A filled pill with a search glyph inside it and a clear button that shows while there is text.",
  frame: "narrow",
  usage: { sheet: "library.css", selector: ".search-field" },
  classes: ["search-field"],
  guidance: [
    "The clear button is the app's own, over the field's right end, and the script shows it only while the field has text.",
    "Under a pointer the pill fills as the other controls in the Library's bar do.",
  ],
  controls: [
    { kind: "toggle", id: "text", label: "Has text", group: "State", value: false },
    { kind: "toggle", id: "disabled", label: "Disabled", group: "State", value: false },
    {
      kind: "text",
      id: "label",
      label: "Placeholder",
      group: "Content",
      value: "Search your library",
      max: 24,
    },
  ],
  demo: [{ text: false }, { text: true }],
  render: (state) => {
    const label = str(state.label, "Search your library");
    const hasText = on(state.text);
    const field = `<div class="search-wrap"><label class="search-field">${icon("search")}<span class="sr-only">${esc(label)}</span><input type="search" name="q" placeholder="${esc(label)}"${hasText ? ' value="design"' : ""} autocomplete="off" enterkeyhint="search"${attr("disabled", on(state.disabled))} /></label><button class="search-clear press press-subtle" type="button" aria-label="Clear text"${hasText ? "" : " hidden"}>${icon("close")}</button></div>`;
    return on(state.disabled)
      ? `<fieldset class="manage-fields" disabled>${field}</fieldset>`
      : field;
  },
});
