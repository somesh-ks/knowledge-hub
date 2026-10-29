import { attr, defineSpec, esc, on, str } from "../lib/designSpec";

let uid = 0;

/** The slider, on its settings row as the Sounds page draws it. */
export default defineSpec({
  id: "range",
  title: "Range",
  level: "atom",
  category: "Inputs",
  summary: "A slider for a level on a scale, such as volume. It takes effect as it moves.",
  frame: "narrow",
  usage: { sheet: "settings.css", selector: ".settings-range" },
  classes: ["settings-range"],
  guidance: [
    "The track is 4px and the input is the 44px target around it.",
    "Until the stored value is known the thumb stays hidden, so it never shows a value that is not the reader's.",
  ],
  controls: [
    {
      kind: "choice",
      id: "level",
      label: "Level",
      group: "Variant",
      value: "70",
      options: [
        { value: "0", label: "Empty" },
        { value: "40", label: "Low" },
        { value: "70", label: "High" },
        { value: "100", label: "Full" },
      ],
    },
    { kind: "toggle", id: "disabled", label: "Disabled", group: "State", value: false },
    { kind: "text", id: "label", label: "Label", group: "Content", value: "Volume", max: 24 },
  ],
  demo: [{ level: "0" }, { level: "40" }, { level: "100" }, { level: "70" }],
  render: (state) => {
    const level = Number(str(state.level, "70"));
    const id = `spec-range-${++uid}`;
    return `<div class="rows card-group"><div class="settings-row"><label class="settings-label" for="${id}">${esc(str(state.label, "Volume"))}</label><input class="settings-range" id="${id}" type="range" min="0" max="1" step="0.05" value="${level / 100}" style="--range-fill: ${level}%"${attr("disabled", on(state.disabled))} /></div></div>`;
  },
});
