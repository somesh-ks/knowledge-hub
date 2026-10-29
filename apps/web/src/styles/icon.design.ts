import { defineSpec, icon, str } from "../lib/designSpec";
import type { IconName } from "../lib/icons";

/** The glyph on its own, as Icon.astro draws it: one filled path in the colour of its text. */
export default defineSpec({
  id: "icon",
  title: "Icon",
  level: "atom",
  category: "Actions",
  summary: "A Phosphor glyph, one filled path in the colour of the text it sits in.",
  usage: { sheet: "buttons.css", selector: ".icon" },
  classes: ["icon", "icon-lg"],
  decisions: ["D187"],
  guidance: [
    "An icon is its colour and its size: 20px, or 24px with icon-lg. It carries no name, the button or link around it does.",
    "A glyph that ends a row is aligned by its ink, not its box (D187).",
  ],
  controls: [
    {
      kind: "choice",
      id: "glyph",
      label: "Glyph",
      group: "Variant",
      value: "play",
      options: [
        { value: "play", label: "Play" },
        { value: "plus", label: "Plus" },
        { value: "close", label: "Close" },
        { value: "check", label: "Check" },
        { value: "search", label: "Search" },
        { value: "share", label: "Share" },
      ],
    },
    {
      kind: "choice",
      id: "size",
      label: "Size",
      group: "Variant",
      value: "default",
      options: [
        { value: "default", label: "20px" },
        { value: "large", label: "24px" },
      ],
    },
  ],
  demo: [
    { glyph: "play", size: "default" },
    { glyph: "plus", size: "large" },
    { glyph: "check", size: "default" },
    { glyph: "share", size: "large" },
  ],
  render: (state) =>
    icon(str(state.glyph, "play") as IconName, str(state.size) === "large" ? "icon-lg" : ""),
});
