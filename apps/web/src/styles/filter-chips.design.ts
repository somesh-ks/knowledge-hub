import { attr, defineSpec, esc, icon, on, str } from "../lib/designSpec";

let uid = 0;

const CHIPS = ["Design", "Engineering", "Research", "Product", "Business"];

/** A row of filter chips, as Create's categories and the Library's Show filters draw them. */
export default defineSpec({
  id: "filter-chips",
  title: "Filter chips",
  level: "molecule",
  category: "Inputs",
  summary:
    "Chips you can tick, or choose between. Chosen, a chip takes the accent container and a check.",
  frame: "narrow",
  usage: [
    { sheet: "primitives.css", selector: ".filter-chips" },
    { sheet: "primitives.css", selector: ".filter-chip" },
    { sheet: "primitives.css", selector: ".filter-chips-scroll" },
  ],
  classes: ["filter-chips", "filter-chip", "filter-chips-scroll"],
  decisions: ["D95"],
  guidance: [
    "Each chip is a checkbox drawn as a pill: the real input covers it, invisible, and the chip draws every state.",
    "The check takes no room of its own, so a chip keeps one width as it ticks and its neighbours never move.",
  ],
  controls: [
    {
      kind: "choice",
      id: "layout",
      label: "Layout",
      group: "Variant",
      value: "wrap",
      options: [
        { value: "wrap", label: "Wraps" },
        { value: "scroll", label: "Scrolls" },
      ],
    },
    { kind: "toggle", id: "chosen", label: "Chosen", group: "State", value: true },
    { kind: "toggle", id: "disabled", label: "Last one disabled", group: "State", value: false },
    { kind: "text", id: "label", label: "First chip", group: "Content", value: "Design", max: 24 },
  ],
  demo: [{ chosen: false }, { chosen: true }],
  render: (state) => {
    const name = `spec-chips-${++uid}`;
    const scroll = str(state.layout, "wrap") === "scroll";
    const chips = CHIPS.map((chip, index) => {
      const label = index === 0 ? str(state.label, chip) : chip;
      const checked = index === 1 && on(state.chosen);
      const disabled = index === CHIPS.length - 1 && on(state.disabled);
      return `<label class="filter-chip"><input type="checkbox" name="${name}" value="${esc(chip)}"${attr("checked", checked)}${attr("disabled", disabled)} />${icon("check", "filter-chip-check")}<span>${esc(label)}</span></label>`;
    }).join("");
    return `<fieldset class="filter-chips${scroll ? " filter-chips-scroll" : ""}" aria-label="Categories">${chips}</fieldset>`;
  },
});
