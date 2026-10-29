import { attr, defineSpec, esc, icon, on, str } from "../lib/designSpec";

let uid = 0;

const LENGTHS = ["3 min", "5 min", "10 min"];

/** The text field, the textarea and a labelled group, in the form the Topics and Sources panels draw. */
export default defineSpec({
  id: "text-field",
  title: "Text field",
  level: "molecule",
  category: "Inputs",
  summary: "A label over an outlined field, one line or several, with its message beneath.",
  frame: "narrow",
  usage: [
    { sheet: "manage.css", selector: ".manage-input" },
    { sheet: "manage.css", selector: ".manage-field" },
  ],
  classes: ["manage-form", "manage-field", "manage-input", "field-label"],
  decisions: ["D167", "D186"],
  guidance: [
    "The field is the one control with an outline, at 3:1 against the page. The outline turns to the accent on focus and to the danger colour when invalid.",
    "A group with no single control, such as a segmented choice, names itself with field-label and the same looks as a label.",
  ],
  controls: [
    {
      kind: "choice",
      id: "kind",
      label: "Field",
      group: "Variant",
      value: "text",
      options: [
        { value: "text", label: "One line" },
        { value: "multiline", label: "Multiline" },
        { value: "group", label: "Group" },
        { value: "form", label: "Form" },
      ],
    },
    { kind: "toggle", id: "invalid", label: "Invalid", group: "State", value: false },
    { kind: "toggle", id: "disabled", label: "Disabled", group: "State", value: false },
    { kind: "text", id: "label", label: "Label", group: "Content", value: "Name", max: 24 },
  ],
  render: (state) => {
    const kind = str(state.kind, "text");
    const invalid = on(state.invalid);
    const label = esc(str(state.label, "Name"));
    const error = (id: string, text: string) =>
      invalid
        ? `<p class="manage-error" id="${id}" role="alert">${icon("alert")}<span>${text}</span></p>`
        : "";

    const single = (name: string, caption: string) => {
      const id = `spec-field-${++uid}`;
      return `<div class="manage-field"><label for="${id}">${caption}</label><input class="manage-input" id="${id}" name="${name}" type="text" placeholder="Design Engineering" autocomplete="off"${invalid ? ` aria-invalid="true" aria-describedby="${id}-error"` : ""} />${error(`${id}-error`, "Give it a name.")}</div>`;
    };
    const multiline = (name: string, caption: string) => {
      const id = `spec-field-${++uid}`;
      return `<div class="manage-field"><label for="${id}">${caption}</label><textarea class="manage-input" id="${id}" name="${name}" rows="3" placeholder="What should count as this category"${invalid ? ` aria-invalid="true" aria-describedby="${id}-error"` : ""}></textarea>${error(`${id}-error`, "Say what counts.")}</div>`;
    };
    const group = (caption: string) => {
      const id = `spec-group-${++uid}`;
      return `<div class="manage-field"><span class="field-label" id="${id}">${caption}</span><fieldset class="segmented-choice" role="radiogroup" aria-labelledby="${id}">${LENGTHS.map(
        (length, index) =>
          `<label class="segmented-choice-item"><input type="radio" name="${id}" value="${length}"${attr("checked", index === 1)} /><span>${length}</span></label>`,
      ).join("")}</fieldset></div>`;
    };

    const fields =
      kind === "multiline"
        ? multiline("description", label)
        : kind === "group"
          ? group(label)
          : kind === "form"
            ? `${single("name", "Name")}${multiline("description", "What should count")}${group("Max length")}<button class="btn-primary manage-submit" type="submit">Add category</button>`
            : single("name", label);
    const form = `<form class="manage-form" novalidate>${fields}</form>`;
    return on(state.disabled)
      ? `<fieldset class="manage-fields" disabled>${form}</fieldset>`
      : form;
  },
});
