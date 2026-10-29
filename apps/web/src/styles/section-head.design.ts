import { defineSpec, esc, icon, on, str } from "../lib/designSpec";

/** The heading over a group of rows, as every settings page and briefing section draws it. */
export default defineSpec({
  id: "section-head",
  title: "Section head",
  level: "atom",
  category: "Lists",
  summary:
    "The heading over a group of rows or a section of a page, with more air above than below.",
  frame: "wide",
  usage: [
    { sheet: "primitives.css", selector: ".section-head" },
    { sheet: "settings.css", selector: ":is(.settings-view, .manage) .section-head" },
  ],
  classes: ["section-head"],
  guidance: [
    "It is the page's h2. A page has one title above it and as many heads as it has groups.",
    "The head belongs to what follows it, so the air above is larger than the air below.",
  ],
  controls: [
    { kind: "toggle", id: "below", label: "Card below", group: "Content", value: true },
    { kind: "text", id: "label", label: "Label", group: "Content", value: "Podcast", max: 24 },
  ],
  demo: [{ below: true }, { below: false }],
  render: (state) => {
    const card = on(state.below)
      ? `<div class="rows card-group"><a class="row-action" href="#section-head"><span class="settings-text"><span class="settings-label">Daily</span><span class="settings-hint">Every other day at 7</span></span>${icon("chevronRight")}</a></div>`
      : "";
    return `<section><h2 class="section-head">${esc(str(state.label, "Podcast"))}</h2>${card}</section>`;
  },
});
