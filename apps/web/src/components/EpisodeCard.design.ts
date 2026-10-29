import { defineSpec, str } from "../lib/designSpec";
import { CARD_CONTROLS, type CardSample, cardMarkup } from "./BriefingCard.design";

const SAMPLES: Record<string, CardSample> = {
  discussion: {
    id: "ep-20261027-1930",
    path: "#",
    title: "How design systems earn their keep",
    kind: "episode",
    parts: { kind: "Discussion", length: "5 min" },
    ground: {
      light: "var(--color-accent-container-high)",
      dark: "var(--color-accent-container-high)",
    },
  },
  long: {
    id: "ep-20261028-0745",
    path: "#",
    title:
      "Why every tool in the design stack now claims to be an agent, and what that changes for the people who use them",
    kind: "episode",
    parts: { kind: "Explainer", length: "12 min" },
    ground: { light: "var(--color-surface-sunken)", dark: "var(--color-surface-sunken)" },
  },
};

/** The episode's card, drawn as the briefing's: the same grid, the same two views, a title in place of a date. */
export default defineSpec({
  id: "episode-card",
  title: "Episode card",
  level: "organism",
  category: "Lists",
  summary:
    "One episode as album art, like a briefing's card: the cover, its title and one quiet line that says the format and the length.",
  frame: "wide",
  classes: [
    "card",
    "card-link",
    "card-title",
    "card-sub",
    "card-facts",
    "card-menu",
    "cover",
    "cover-over",
  ],
  decisions: ["D127"],
  guidance: [
    "The card is the briefing's card with the episode's own words. Its title can run long, so it is clamped to two lines in the gallery and shown whole in the list.",
    "An episode has no recording until someone presses play, and it always carries the ⋮ menu: Regenerate and Delete are its own.",
  ],
  controls: [
    {
      kind: "choice",
      id: "title",
      label: "Title",
      group: "Content",
      value: "discussion",
      options: [
        { value: "discussion", label: "Short" },
        { value: "long", label: "Long" },
      ],
    },
    ...CARD_CONTROLS,
  ],
  render: (state) => {
    const sample = SAMPLES[str(state.title, "discussion")] ?? (SAMPLES.discussion as CardSample);
    return cardMarkup(sample, state, true);
  },
  demo: [{ title: "discussion" }, { title: "long" }],
});
