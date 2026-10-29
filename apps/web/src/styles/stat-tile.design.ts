import { defineSpec, esc, on, str } from "../lib/designSpec";

const FIGURES = [
  ["24", "runs"],
  ["$0.18", "a run"],
  ["31 min", "of audio"],
  ["6", "sources"],
];

/** A figure on a dashboard: Costs' and Health's tiles, in a card. */
export default defineSpec({
  id: "stat-tiles",
  title: "Stat tiles",
  level: "molecule",
  category: "Lists",
  summary: "A tile per figure on a dashboard: the value large, its word under it in muted ink.",
  frame: "stack",
  usage: { sheet: "primitives.css", selector: ".stat-tiles" },
  classes: ["stat-tiles", "stat-tile", "stat-tile-value", "stat-tile-label"],
  guidance: [
    "Put .stat-tiles on the list and .stat-tile on each item, with the value and the label inside. Two columns on a phone, four from 40rem.",
    "A tile takes the overlay tone, so it sits in a card, not on the bare page. No pill for a figure.",
    "A value too long for its tile is cut with an ellipsis, on one line.",
  ],
  controls: [
    {
      kind: "choice",
      id: "count",
      label: "Tiles",
      group: "Content",
      value: "4",
      options: [
        { value: "2", label: "Two" },
        { value: "4", label: "Four" },
      ],
    },
    { kind: "toggle", id: "long", label: "Long value", group: "Content", value: false },
  ],
  render: (state) => {
    const figures = FIGURES.slice(0, Number(str(state.count, "4"))).map(([value, label], index) =>
      index === 0 && on(state.long) ? ["$1,284,000.25 in total", label] : [value, label],
    );
    const tiles = figures
      .map(
        ([value, label]) =>
          `<li class="stat-tile"><strong class="stat-tile-value">${esc(value ?? "")}</strong> <span class="stat-tile-label">${esc(label ?? "")}</span></li>`,
      )
      .join("");
    return `<div class="card-group"><ul class="stat-tiles" role="list" aria-label="Figures">${tiles}</ul></div>`;
  },
});
