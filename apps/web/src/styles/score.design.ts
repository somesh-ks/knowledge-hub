import { defineSpec, icon, str } from "../lib/designSpec";

const SCORES: Record<string, { label: string; score: number | null }> = {
  excellent: { label: "Excellent", score: 4.6 },
  good: { label: "Good", score: 3.8 },
  fair: { label: "Fair", score: 2.9 },
  poor: { label: "Poor", score: 1.8 },
  new: { label: "New", score: null },
};

/** A source's rating before its checkbox: a star and the score out of 5, or New. */
export default defineSpec({
  id: "score",
  title: "Score",
  level: "atom",
  category: "Feedback",
  summary: "A source's rating: a star and the score out of 5, or the word New before it has one.",
  usage: { sheet: "topics.css", selector: ".score" },
  classes: ["score", "score-star", "score-number"],
  decisions: ["D103"],
  guidance: [
    "The word (Excellent, Good, Fair, Poor) is for a screen reader and the row's tooltip; the row shows the figure.",
    "Poor is told apart by its weight and neutral ink, never the danger colour: a low rating measures what a source sent, it is not an error.",
  ],
  controls: [
    {
      kind: "choice",
      id: "band",
      label: "Rating",
      group: "Variant",
      value: "good",
      options: [
        { value: "excellent", label: "Excellent" },
        { value: "good", label: "Good" },
        { value: "fair", label: "Fair" },
        { value: "poor", label: "Poor" },
        { value: "new", label: "New" },
      ],
    },
  ],
  render: (state) => {
    const { label, score } = SCORES[str(state.band, "good")] ?? { label: "Good", score: 3.8 };
    if (score === null)
      return `<span class="score" data-label="${label}" title="Not scored yet"><span class="score-new">New</span></span>`;
    const figure = score.toFixed(1);
    return `<span class="score" data-label="${label}" title="${figure} of 5, ${label}">${icon("star", "score-star")}<span class="score-number" aria-hidden="true">${figure}</span><span class="sr-only">Rated ${figure} of 5, ${label}</span></span>`;
  },
});
