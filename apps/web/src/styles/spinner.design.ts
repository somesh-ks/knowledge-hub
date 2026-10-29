import { defineSpec, esc, str } from "../lib/designSpec";

/** The spinner alone, and beside the words it belongs to in a busy button (GenerateSheet.tsx). */
export default defineSpec({
  id: "spinner",
  title: "Spinner",
  level: "atom",
  category: "Feedback",
  summary: "A quiet ring in the colour of its text, for work that is on its way.",
  frame: "narrow",
  usage: { sheet: "foundations.css", selector: ".spinner" },
  classes: ["spinner"],
  guidance: [
    "It takes the colour of the text around it and is shown only after a delay, so a fast load never flashes it.",
    "Under reduced motion the ring does not turn: it pulses.",
    "A busy button keeps its fill and shows the spinner beside the words, so it reads as working, not unavailable.",
  ],
  controls: [
    {
      kind: "choice",
      id: "where",
      label: "Where",
      group: "Variant",
      value: "alone",
      options: [
        { value: "alone", label: "Alone" },
        { value: "button", label: "In a button" },
      ],
    },
    { kind: "text", id: "label", label: "Label", group: "Content", value: "Regenerating", max: 16 },
  ],
  render: (state) =>
    str(state.where) === "button"
      ? `<button class="btn-primary" type="button" data-busy="true"><span class="spinner" aria-hidden="true"></span>${esc(str(state.label, "Regenerating"))}</button>`
      : '<span class="spinner" role="status" aria-label="Loading"></span>',
});
