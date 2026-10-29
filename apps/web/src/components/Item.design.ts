import { defineSpec, esc, icon, on, str } from "../lib/designSpec";

/** The play chip as PlayChip.astro draws it, idle: every mark is in the slot and the state shows one. */
const chip = (label: string) =>
  `<button class="chip" type="button" data-state="idle" data-playing="false"><span class="chip-glyph" aria-hidden="true"><span class="swap">${icon("play", "swap-paused")}${icon("pause", "swap-playing")}</span><span class="chip-bars"><i></i><i></i><i></i></span>${icon("check", "chip-check")}${icon("replay", "chip-replay")}${icon("refresh", "chip-refresh")}<span class="spinner"></span></span><span class="chip-text"><span class="chip-label" data-chip-label>${esc(label)}</span><span class="chip-again" aria-hidden="true">Play again</span></span></button>`;

/** A story in a briefing (Item.astro): the publisher, the headline as a link, a summary and the action line. */
export default defineSpec({
  id: "story-item",
  title: "Story item",
  level: "organism",
  category: "Lists",
  summary:
    "One story of a briefing: the publisher above a headline that opens the source, two lines of summary, then Play and the story's controls.",
  frame: "wide",
  usage: [
    { sheet: "briefing.css", selector: ".story" },
    { sheet: "story-controls.css", selector: ".story-controls" },
  ],
  classes: [
    "story",
    "story-title",
    "story-link",
    "story-summary",
    "story-actions",
    "story-source",
    "story-controls",
    "story-vote",
    "story-more",
    "source-link",
  ],
  guidance: [
    "The headline is the link to the source, as in a news list. The publisher above it is a second way to the same place, so it stays out of the tab order.",
    "The chip is the one accent in a story. A press on a vote changes its colour and glyph, never a size, so nothing beside it moves.",
    "Stories sit an item gap apart, half of it on each side of the hairline. With no audio the chip is hidden and the controls sit closer under the text.",
  ],
  controls: [
    { kind: "toggle", id: "audio", label: "Has audio", group: "State", value: true },
    { kind: "toggle", id: "liked", label: "Liked", group: "State", value: false },
    { kind: "toggle", id: "source", label: "Publisher", group: "Content", value: true },
    {
      kind: "text",
      id: "headline",
      label: "Headline",
      group: "Content",
      value: "Figma tokens get motion",
      max: 24,
    },
  ],
  render: (state) => {
    const headline = esc(str(state.headline, "Figma tokens get motion"));
    const source = on(state.source)
      ? `<a class="source-link story-source" href="#" tabindex="-1" aria-hidden="true" title="Figma Blog"><span>Figma Blog</span></a>`
      : "";
    const controls = `<div class="story-controls" data-story-controls><button class="icon-btn story-vote press" type="button" aria-pressed="${on(state.liked)}" aria-label="Like: ${headline}" data-vote="up">${icon("thumbsUp")}${icon("thumbsUpFill")}</button><button class="icon-btn story-vote press" type="button" aria-pressed="false" aria-label="Dislike: ${headline}" data-vote="down">${icon("thumbsDown")}${icon("thumbsDownFill")}</button><div class="story-menu"><button class="icon-btn story-more press" type="button" aria-label="Story options: ${headline}" aria-haspopup="menu" data-hero-more>${icon("moreVert")}</button></div></div>`;
    const play = on(state.audio) ? chip("1:24") : "";
    return `<article class="story" aria-labelledby="t-story">${source}<h3 class="story-title" id="t-story"><a class="story-link" href="#"><span>${headline}</span><span class="sr-only">(opens in a new tab)</span></a></h3><p class="story-summary">Motion tokens now live beside colour and spacing, so a design system can ship one easing curve to every platform.</p><div class="story-actions">${play}${controls}</div></article>`;
  },
});
