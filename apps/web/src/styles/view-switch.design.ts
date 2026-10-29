import { defineSpec, icon, str } from "../lib/designSpec";

/** The Library's view switch (library.astro): two round icon buttons, the chosen one tonal. */
export default defineSpec({
  id: "view-switch",
  title: "View switch",
  level: "molecule",
  category: "Inputs",
  summary: "Two round icon buttons that choose how a list is laid out. The chosen one is tonal.",
  usage: { sheet: "library.css", selector: ".view-switch" },
  classes: ["view-switch", "view-btn", "press-subtle"],
  guidance: [
    "The buttons are as tall as the selects beside them; the 44px target is a layer over each.",
    "The chosen view is aria-pressed. It takes the accent container, as a chosen filter chip does.",
  ],
  controls: [
    {
      kind: "choice",
      id: "view",
      label: "Chosen view",
      group: "State",
      value: "gallery",
      options: [
        { value: "gallery", label: "Gallery" },
        { value: "list", label: "List" },
      ],
    },
  ],
  render: (state) => {
    const gallery = str(state.view, "gallery") === "gallery";
    return `<div class="view-switch" role="group" aria-label="View"><button class="view-btn press press-subtle" type="button" aria-pressed="${gallery}" aria-label="Gallery view">${icon("viewGrid")}</button><button class="view-btn press press-subtle" type="button" aria-pressed="${!gallery}" aria-label="List view">${icon("viewList")}</button></div>`;
  },
});
