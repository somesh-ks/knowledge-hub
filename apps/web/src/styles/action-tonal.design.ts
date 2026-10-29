import { defineSpec, esc, icon, on, str } from "../lib/designSpec";

/**
 * The tonal action as the side column draws it (AppNav.astro, `.app-nav-create`). That element is
 * hidden below 64rem and sized by the column, so the sample puts the class on the text button
 * (`.btn`), which gives the same row of glyph and words at its own size.
 */
export default defineSpec({
  id: "action-tonal",
  title: "Tonal action",
  level: "atom",
  category: "Actions",
  summary:
    "The one creating action in the side column: a saturated blue rectangle that is not a pill.",
  frame: "narrow",
  usage: { sheet: "buttons.css", selector: ".btn-action-tonal" },
  classes: ["btn-action-tonal"],
  decisions: ["D86", "D186"],
  controls: [
    { kind: "toggle", id: "glyph", label: "Leading glyph", group: "Content", value: true },
    { kind: "text", id: "label", label: "Label", group: "Content", value: "Catch up", max: 16 },
  ],
  render: (state) => {
    const glyph = on(state.glyph) ? icon("plus", "icon-lg") : "";
    return `<a class="btn btn-action-tonal" href="/create">${glyph}<span>${esc(str(state.label, "Catch up"))}</span></a>`;
  },
});
