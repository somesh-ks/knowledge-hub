import { attr, defineSpec, esc, on, str } from "../lib/designSpec";

let uid = 0;

const SEGMENTS = ["3 min", "5 min", "10 min", "15 min"];

/** The outlined choice between a few values, as Create's length and look-back draw it. */
export default defineSpec({
  id: "segmented-choice",
  title: "Segmented choice",
  level: "molecule",
  category: "Inputs",
  summary:
    "One pill outlined with a hairline and divided into segments. The chosen segment is filled and checked.",
  frame: "narrow",
  usage: { sheet: "primitives.css", selector: ".segmented-choice" },
  classes: ["segmented-choice", "segmented-choice-item"],
  decisions: ["D95"],
  guidance: [
    "It picks a value. The segmented navigation moves between views: this one has an outline and a check, the navigation a track and a raised pill.",
    "Radios in a fieldset: the arrow keys, the group and its name come from the browser. Below 320px a four-way control drops the check and keeps the fill.",
  ],
  controls: [
    {
      kind: "choice",
      id: "count",
      label: "Segments",
      group: "Variant",
      value: "3",
      options: [
        { value: "2", label: "Two" },
        { value: "3", label: "Three" },
        { value: "4", label: "Four" },
      ],
    },
    {
      kind: "choice",
      id: "chosen",
      label: "Chosen",
      group: "State",
      value: "1",
      options: [
        { value: "0", label: "First" },
        { value: "1", label: "Second" },
        { value: "2", label: "Third" },
      ],
    },
    { kind: "toggle", id: "disabled", label: "Disabled", group: "State", value: false },
    {
      kind: "text",
      id: "label",
      label: "First segment",
      group: "Content",
      value: "3 min",
      max: 12,
    },
  ],
  demo: [{ chosen: "0" }, { chosen: "1" }, { chosen: "2" }],
  render: (state) => {
    const name = `spec-length-${++uid}`;
    const count = Number(str(state.count, "3"));
    const chosen = Math.min(Number(str(state.chosen, "1")), count - 1);
    const items = SEGMENTS.slice(0, count)
      .map((segment, index) => {
        const label = index === 0 ? str(state.label, segment) : segment;
        return `<label class="segmented-choice-item"><input type="radio" name="${name}" value="${esc(segment)}"${attr("checked", index === chosen)}${attr("disabled", on(state.disabled))} /><span>${esc(label)}</span></label>`;
      })
      .join("");
    return `<fieldset class="segmented-choice" role="radiogroup" aria-label="Length">${items}</fieldset>`;
  },
});
