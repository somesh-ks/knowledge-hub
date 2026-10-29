import { defineSpec, esc, on, str } from "../lib/designSpec";

/** The drawn checkbox, here on a row of a multi-select list, where it is the option's state. */
export default defineSpec({
  id: "checkbox",
  title: "Checkbox",
  level: "atom",
  category: "Inputs",
  summary:
    "The app's checkbox: an 18px box that fills with the accent and a bold check when ticked.",
  frame: "narrow",
  usage: { sheet: "primitives.css", selector: ".suggest-box" },
  classes: ["suggest-box"],
  guidance: [
    "The check scales in from 60%, never from nothing, and fades out quicker than it comes.",
    "It is drawn only. The real input sits invisible over a touch-sized target, or the element around it carries aria-selected, and takes every press.",
  ],
  controls: [
    { kind: "toggle", id: "checked", label: "Ticked", group: "State", value: true },
    { kind: "toggle", id: "disabled", label: "Disabled", group: "State", value: false },
    { kind: "text", id: "label", label: "Label", group: "Content", value: "Design", max: 24 },
  ],
  render: (state) =>
    `<div role="listbox" aria-multiselectable="true" aria-label="Categories"><div class="multiselect-option" role="option" aria-selected="${on(state.checked) ? "true" : "false"}"${on(state.disabled) ? ' aria-disabled="true"' : ""}><span class="suggest-box" aria-hidden="true"></span><span class="multiselect-text"><span class="multiselect-label">${esc(str(state.label, "Design"))}</span></span></div></div>`,
});
