import { defineSpec, icon, str } from "../lib/designSpec";

const LINKS = [
  ["Change log", "2026.10"],
  ["Privacy", ""],
  ["About", ""],
] as const;

/** The rounded container Settings puts a group of rows in, and the accent one for an offer. */
export default defineSpec({
  id: "card-group",
  title: "Card group",
  level: "molecule",
  category: "Lists",
  summary: "A group of rows in one rounded container, told apart from the page by tone alone.",
  frame: "wide",
  usage: { sheet: "primitives.css", selector: ".card-group-accent" },
  classes: ["card-group", "card-group-accent"],
  guidance: [
    "Put the class on the .rows list itself. The rows keep their own padding, and a row's press tile keeps clear of the corners.",
    "A card is told apart by its container tone, never by a shadow or a line. One row makes a shorter card with a smaller corner.",
  ],
  controls: [
    {
      kind: "choice",
      id: "tone",
      label: "Tone",
      group: "Variant",
      value: "standard",
      options: [
        { value: "standard", label: "Standard" },
        { value: "accent", label: "Accent" },
      ],
    },
    {
      kind: "choice",
      id: "rows",
      label: "Rows",
      group: "Content",
      value: "three",
      options: [
        { value: "one", label: "One" },
        { value: "three", label: "Three" },
      ],
    },
  ],
  render: (state) => {
    if (str(state.tone, "standard") === "accent")
      return `<div class="rows card-group card-group-accent"><div class="settings-row"><div class="settings-text"><span class="settings-label">Install Singularity</span><span class="settings-hint">Opens on its own, like an app, and works offline.</span></div><button class="btn" type="button">Install</button></div></div>`;
    const links = str(state.rows, "three") === "one" ? LINKS.slice(0, 1) : LINKS;
    const rows = links
      .map(
        ([label, hint]) =>
          `<a class="row-action" href="#card-group"><span class="settings-text"><span class="settings-label">${label}</span>${hint ? `<span class="settings-hint">${hint}</span>` : ""}</span>${icon("chevronRight")}</a>`,
      )
      .join("");
    return `<div class="rows card-group">${rows}</div>`;
  },
});
