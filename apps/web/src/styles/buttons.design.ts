import { attr, defineSpec, esc, icon, on, str } from "../lib/designSpec";

/** The worded button: three tones, a disabled state and an optional leading glyph. */
export default defineSpec({
  id: "button",
  title: "Button",
  level: "atom",
  category: "Actions",
  summary: "The worded action: filled for the one main step, tonal beside it, plain for the rest.",
  frame: "narrow",
  usage: [
    { sheet: "buttons.css", selector: ".btn-primary" },
    { sheet: "buttons.css", selector: ".btn-secondary" },
    { sheet: "buttons.css", selector: ".btn" },
  ],
  classes: ["btn", "btn-primary", "btn-secondary"],
  decisions: ["D186"],
  guidance: [
    "One filled button per surface: the step the reader is most likely to take.",
    "A worded button shows a press on its fill; the words never scale.",
  ],
  controls: [
    {
      kind: "choice",
      id: "tone",
      label: "Tone",
      group: "Variant",
      value: "primary",
      options: [
        { value: "primary", label: "Primary" },
        { value: "secondary", label: "Secondary" },
        { value: "plain", label: "Plain" },
      ],
    },
    { kind: "toggle", id: "glyph", label: "Leading glyph", group: "Content", value: false },
    { kind: "toggle", id: "disabled", label: "Disabled", group: "State", value: false },
    { kind: "text", id: "label", label: "Label", group: "Content", value: "Play", max: 16 },
  ],
  render: (state) => {
    const tone = str(state.tone, "primary");
    const cls = tone === "plain" ? "btn" : `btn-${tone}`;
    const glyph = on(state.glyph) ? icon("play") : "";
    return `<button class="${cls}" type="button"${attr("disabled", state.disabled)}>${glyph}${esc(str(state.label, "Play"))}</button>`;
  },
});
