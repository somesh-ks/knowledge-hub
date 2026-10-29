import { defineSpec, esc, icon, str } from "../lib/designSpec";

const WORDS = ["Stories", "Up next", "Script", "Notes"];
const POSITION: Record<string, number> = { first: 0, second: 1, third: 2, fourth: 3 };

/** The tablist track with one sliding pill: words across the width, or two glyphs in the compact form. */
export default defineSpec({
  id: "segmented-nav",
  title: "Segmented navigation",
  level: "molecule",
  category: "Navigation",
  summary:
    "A tonal track with one pill that slides under the active label, for switching between views of one thing.",
  frame: "narrow",
  usage: [
    { sheet: "primitives.css", selector: ".segmented-nav" },
    { sheet: "primitives.css", selector: ".segmented-nav-compact" },
  ],
  classes: ["segmented-nav", "segmented-nav-compact", "segmented-nav-tab"],
  decisions: ["D132"],
  guidance: [
    "Used like tabs: buttons in a tablist, the active one aria-selected, one tab stop and the arrow keys moving between them.",
    "Told apart from the segmented choice by having no outline and no check: the pill is the whole mark.",
  ],
  controls: [
    {
      kind: "choice",
      id: "size",
      label: "Size",
      group: "Variant",
      value: "standard",
      options: [
        { value: "standard", label: "Standard" },
        { value: "compact", label: "Compact" },
      ],
    },
    {
      kind: "choice",
      id: "segments",
      label: "Segments",
      group: "Content",
      value: "3",
      options: [
        { value: "2", label: "Two" },
        { value: "3", label: "Three" },
        { value: "4", label: "Four" },
      ],
    },
    {
      kind: "choice",
      id: "selected",
      label: "Active",
      group: "State",
      value: "first",
      options: [
        { value: "first", label: "First" },
        { value: "second", label: "Second" },
        { value: "third", label: "Third" },
        { value: "fourth", label: "Fourth" },
      ],
    },
  ],
  demo: [{ selected: "first" }, { selected: "second" }, { selected: "third" }],
  render: (state) => {
    const compact = str(state.size, "standard") === "compact";
    // The compact form is Costs' chart and table switch: two glyph tabs, each named by its label.
    const count = compact ? 2 : Number(str(state.segments, "3"));
    const active = Math.min(POSITION[str(state.selected, "first")] ?? 0, count - 1);
    const tab = (inner: string, name: string | null, index: number) =>
      `<button class="segmented-nav-tab" type="button" role="tab" aria-selected="${index === active}"${name ? ` aria-label="${esc(name)}"` : ""}${index === active ? "" : ' tabindex="-1"'}>${inner}</button>`;
    const tabs = compact
      ? [tab(icon("chartBar"), "Chart", 0), tab(icon("table"), "Table", 1)]
      : WORDS.slice(0, count).map((word, index) => tab(esc(word), null, index));
    const nav = `<div class="segmented-nav${compact ? " segmented-nav-compact" : ""}" role="tablist" aria-label="Show as">${tabs.join("")}</div>`;
    // Compact sits at the end of a row, beside what it switches (Costs), and hugs its two columns.
    return compact
      ? `<div class="settings-row"><span class="settings-label">Show as</span>${nav}</div>`
      : nav;
  },
});
