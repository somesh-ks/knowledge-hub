import { defineSpec, esc, icon, str } from "../lib/designSpec";

let uid = 0;

const OTHERS = ["5 min", "10 min", "15 min"];

/** The three selects the app draws: a form field, a settings row's value and Create's tonal one. */
export default defineSpec({
  id: "select",
  title: "Select",
  level: "molecule",
  category: "Inputs",
  summary:
    "A native select with the page's own chevron. It opens the browser's list, drawn to match where it can be.",
  frame: "narrow",
  usage: [
    { sheet: "manage.css", selector: ".manage-select" },
    { sheet: "create.css", selector: ".create-select" },
  ],
  classes: ["manage-select", "value-select", "create-select"],
  decisions: ["D167", "D186"],
  guidance: [
    "In a settings row the select is the row's value: its words and a chevron, with no outline and no box, as wide as its words, at the end of the row. It shows its extent as a fill under a pointer and while it is open.",
    "Each select draws its own chevron, so the browser's arrow is hidden.",
  ],
  controls: [
    {
      kind: "choice",
      id: "kind",
      label: "Select",
      group: "Variant",
      value: "field",
      options: [
        { value: "field", label: "Field" },
        { value: "row", label: "Row value" },
        { value: "tonal", label: "Tonal" },
      ],
    },
    { kind: "text", id: "value", label: "Value", group: "Content", value: "3 min", max: 24 },
  ],
  render: (state) => {
    const kind = str(state.kind, "field");
    const id = `spec-select-${++uid}`;
    const options = [str(state.value, "3 min"), ...OTHERS]
      .map((option, index) => `<option${index === 0 ? " selected" : ""}>${esc(option)}</option>`)
      .join("");
    const chevron = icon("chevronDown");
    if (kind === "row")
      return `<div class="rows card-group"><div class="settings-row"><label class="settings-label" for="${id}">Max length</label><span class="manage-select value-select"><select class="manage-input" id="${id}" autocomplete="off">${options}</select>${chevron}</span></div></div>`;
    if (kind === "tonal")
      return `<span class="create-select"><select id="${id}" aria-label="Voice" autocomplete="off">${options}</select>${chevron}</span>`;
    return `<div class="manage-field"><label for="${id}">Max length</label><div class="manage-select"><select class="manage-input" id="${id}" autocomplete="off">${options}</select>${chevron}</div></div>`;
  },
});
