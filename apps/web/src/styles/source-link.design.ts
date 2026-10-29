import { defineSpec, esc, icon, str } from "../lib/designSpec";

/** The link out of a story: the publisher's name, and in its plain form an opens-elsewhere glyph. */
export default defineSpec({
  id: "source-link",
  title: "Source link",
  level: "atom",
  category: "Actions",
  summary:
    "The one link out of a story: the publisher's name, underlined on hover, with no container and no fill.",
  usage: { sheet: "primitives.css", selector: ".source-link" },
  classes: ["source-link"],
  guidance: [
    "A story draws it above its headline with .story-source: muted words, underlined, no glyph, out of the tab order because the headline is the link a keyboard meets.",
    "The target is 44px tall and reaches past the words at the start, so the words sit where they would without it.",
  ],
  controls: [
    {
      kind: "choice",
      id: "form",
      label: "Form",
      group: "Variant",
      value: "story",
      options: [
        { value: "story", label: "Story" },
        { value: "plain", label: "Plain" },
      ],
    },
    {
      kind: "text",
      id: "label",
      label: "Publisher",
      group: "Content",
      value: "Studio Notes",
      max: 24,
    },
  ],
  render: (state) => {
    const name = esc(str(state.label, "Studio Notes"));
    if (str(state.form, "story") === "plain")
      return `<a class="source-link" href="#source-link" target="_blank" rel="noopener noreferrer"><span>${name}</span>${icon("openInNew")}</a>`;
    return `<a class="source-link story-source" href="#source-link" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true" title="${name}"><span>${name}</span></a>`;
  },
});
