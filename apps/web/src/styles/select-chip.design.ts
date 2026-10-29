import { attr, defineSpec, esc, icon, on, str } from "../lib/designSpec";

const OTHERS = ["Oldest first", "Longest first"];

/** The chip select the Library's sort and the Costs chart's range and breakdown draw. */
export default defineSpec({
  id: "select-chip",
  title: "Select chip",
  level: "molecule",
  category: "Inputs",
  summary:
    "A compact select drawn as a chip, for an order or a range that sits beside a bar of other controls.",
  usage: { sheet: "primitives.css", selector: ".sort-field" },
  classes: ["sort-field"],
  guidance: [
    "A choice that is not the default is on, and the chip looks chosen the way a filter chip does.",
    "The chip is 36px and the select inside it is a 44px target. Set --sort-field-bg to step the fill up on a card's tone.",
  ],
  controls: [
    { kind: "toggle", id: "active", label: "Not the default", group: "State", value: false },
    { kind: "text", id: "value", label: "Value", group: "Content", value: "Newest first", max: 24 },
  ],
  render: (state) => {
    const options = [str(state.value, "Newest first"), ...OTHERS]
      .map((option, index) => `<option${index === 0 ? " selected" : ""}>${esc(option)}</option>`)
      .join("");
    return `<label class="sort-field"${attr("data-active", on(state.active))}><span class="sr-only">Sort</span><select>${options}</select>${icon("chevronDown")}</label>`;
  },
});
