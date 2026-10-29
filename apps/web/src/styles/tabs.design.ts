import { defineSpec, esc, on, str } from "../lib/designSpec";

const SECTIONS = [
  "Design",
  "Engineering",
  "AI",
  "Industry",
  "Research",
  "Culture",
  "Tools",
  "Careers",
  "Events",
];
const FORMATS = ["All", "Blog", "News", "Forum", "Video", "Research", "Releases", "Podcast"];

const CURRENT: Record<string, number> = { first: 0, second: 1, third: 2 };

/** The tab strip: section tabs under the app bar, and the format tabs inside a card. */
export default defineSpec({
  id: "tabs",
  title: "Tabs",
  level: "molecule",
  category: "Navigation",
  summary:
    "A strip of labels with an accent underline on the one in view, scrolling sideways when there are many.",
  frame: "narrow",
  usage: [
    { sheet: "primitives.css", selector: ".tabs-bar" },
    { sheet: "primitives.css", selector: ".tabs-in-card" },
  ],
  classes: ["tabs-bar", "tabs", "tab", "tabs-in-card", "scroll-fade-inline"],
  guidance: [
    "Section tabs are plain links, the current one marked aria-current. A filter's tabs are buttons in a tablist, the chosen one aria-selected.",
    "A briefing draws them only for two sections or more: one tab would only repeat the heading under it.",
    "The strip fades its hidden edge while more lies past it (.scroll-fade-inline); with nothing to scroll there is no fade.",
  ],
  controls: [
    {
      kind: "choice",
      id: "placement",
      label: "Placement",
      group: "Variant",
      value: "bar",
      options: [
        { value: "bar", label: "Section bar" },
        { value: "card", label: "In a card" },
      ],
    },
    {
      kind: "choice",
      id: "current",
      label: "Current tab",
      group: "State",
      value: "first",
      options: [
        { value: "first", label: "First" },
        { value: "second", label: "Second" },
        { value: "third", label: "Third" },
      ],
    },
    { kind: "toggle", id: "many", label: "Many tabs", group: "Content", value: false },
  ],
  demo: [{ current: "first" }, { current: "second" }, { current: "third" }],
  render: (state) => {
    const current = CURRENT[str(state.current, "first")] ?? 0;
    const many = on(state.many);
    if (str(state.placement, "bar") === "card") {
      const labels = many ? FORMATS : FORMATS.slice(0, 4);
      return `<div class="card-group"><div class="tabs tabs-in-card scroll-fade-inline" role="tablist" aria-label="Type">${labels
        .map(
          (label, index) =>
            `<button class="tab" type="button" role="tab" aria-selected="${index === current}" data-tab="${index === 0 ? "" : esc(label.toLowerCase())}">${esc(label)}</button>`,
        )
        .join("")}</div></div>`;
    }
    const labels = many ? SECTIONS : SECTIONS.slice(0, 4);
    return `<div class="page"><div class="tabs-bar" data-tabs-bar><nav class="tabs scroll-fade-inline" aria-label="Sections" data-section-tabs>${labels
      .map(
        (label, index) =>
          `<a class="tab" href="#c-${esc(label.toLowerCase())}" data-section="${esc(label.toLowerCase())}"${index === current ? ' aria-current="true"' : ""}>${esc(label)}</a>`,
      )
      .join("")}</nav></div></div>`;
  },
});
