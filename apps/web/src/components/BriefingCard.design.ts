import { attr, type DesignControl, defineSpec, esc, icon, on, str } from "../lib/designSpec";

/** What one Library card is drawn from; the briefing's and the episode's cards differ in this alone. */
export interface CardSample {
  id: string;
  path: string;
  /** The date or the episode's title. */
  title: string;
  kind: string;
  /** The facts: "Daily", "12 stories", "8 min". The story count is its own part, so a narrow card can drop it. */
  parts: { kind: string; count?: string; length: string };
  /** The cover's ground in the light and the dark theme: a theme token standing in for the palette colour the art is drawn on. */
  ground: { light: string; dark: string };
}

/** The controls both cards share: the Library's two views, a half-heard item and a finished one. */
export const CARD_CONTROLS: readonly DesignControl[] = [
  {
    kind: "choice",
    id: "view",
    label: "View",
    group: "Variant",
    value: "gallery",
    options: [
      { value: "gallery", label: "Gallery" },
      { value: "list", label: "List" },
    ],
  },
  { kind: "toggle", id: "progress", label: "Half heard", group: "State", value: false },
  { kind: "toggle", id: "played", label: "Played", group: "State", value: false },
];

/**
 * One card as the Library draws it (BriefingCard.astro, EpisodeCard.astro). The cover is a plain box on
 * the palette colour its art is drawn on, with the cover's own class: the generated image is the one
 * part left out. The row's menu is a ⋮ button; its popover waits closed for script.
 */
export function cardMarkup(
  sample: CardSample,
  state: Record<string, string | boolean>,
  menu: boolean,
): string {
  const played = on(state.played);
  const progress = on(state.progress) && !played;
  const { kind, count, length } = sample.parts;
  const countPart = count ? `<span class="card-count"> · ${esc(count)}</span>` : "";
  const line = `${esc(kind)}${countPart} · <span data-card-length>${played ? "Played" : esc(length)}</span>`;
  const menuButton = menu
    ? `<div class="card-menu" style="--card-anchor: --cm-${sample.id}" data-library-menu><button class="icon-btn card-more press" type="button" aria-label="More actions for ${esc(sample.title)}" aria-haspopup="menu" data-hero-more>${icon("moreVert")}</button></div>`
    : "";
  return `<div data-library data-view="${str(state.view, "gallery")}"><ul class="library-grid" role="list"><li class="card" data-card data-kind="${sample.kind}"><a class="card-link" href="${sample.path}"><span class="cover" data-size="card" style="--cover-bg-light:${sample.ground.light};--cover-bg-dark:${sample.ground.dark}"></span><span class="card-progress" data-cover-progress aria-hidden="true"${attr("hidden", !progress)} style="--progress:40%"></span><span class="card-title">${esc(sample.title)}</span><span class="card-sub"><span class="card-facts" data-card-facts${attr("data-played", played)}>${line}</span></span></a><span class="cover-over" data-playing="false"><button class="cover-play" type="button" aria-label="Play ${esc(sample.title)}"><span class="swap">${icon("play", "icon-lg swap-paused")}${icon("pause", "icon-lg swap-playing")}</span></button></span>${menuButton}</li></ul></div>`;
}

const SAMPLES: Record<string, CardSample> = {
  daily: {
    id: "2026-10-28",
    path: "#",
    title: "Wednesday 28 October",
    kind: "daily",
    parts: { kind: "Daily", count: "12 stories", length: "8 min" },
    ground: { light: "var(--color-accent-container)", dark: "var(--color-accent-container)" },
  },
  weekly: {
    id: "2026-10-25",
    path: "#",
    title: "Sunday 25 October",
    kind: "weekly",
    parts: { kind: "Weekly", count: "8 stories", length: "14 min" },
    ground: { light: "var(--color-warning-subtle)", dark: "var(--color-warning-subtle)" },
  },
  "on-demand": {
    id: "2026-10-27",
    path: "#",
    title: "Tuesday 27 October",
    kind: "on-demand",
    parts: { kind: "Podcast", length: "4 min" },
    ground: { light: "var(--color-success-subtle)", dark: "var(--color-success-subtle)" },
  },
};

export default defineSpec({
  id: "briefing-card",
  title: "Briefing card",
  level: "organism",
  category: "Lists",
  summary:
    "One briefing as album art: the cover, its date and one quiet line. The whole card is the link.",
  frame: "wide",
  classes: [
    "card",
    "card-link",
    "card-progress",
    "card-title",
    "card-sub",
    "card-facts",
    "card-count",
    "card-menu",
    "card-more",
    "cover",
    "cover-over",
    "cover-play",
    "library-grid",
  ],
  decisions: ["D127"],
  guidance: [
    "Type comes in two steps only, a title and a quiet line, always with air between them. Two lines of title at most.",
    "Two targets under a pointer: the art answers with the scrim and the play button and plays; the title answers with the accent and opens the page. The ⋮ is a sibling of the link, never inside it.",
    "A half-heard briefing shows a bar along the art's foot. A finished one says Played where its length was.",
  ],
  controls: [
    {
      kind: "choice",
      id: "kind",
      label: "Kind",
      group: "Variant",
      value: "daily",
      options: [
        { value: "daily", label: "Daily" },
        { value: "weekly", label: "Weekly" },
        { value: "on-demand", label: "Podcast" },
      ],
    },
    ...CARD_CONTROLS,
    { kind: "toggle", id: "menu", label: "Menu", group: "State", value: true },
  ],
  render: (state) => {
    const sample = SAMPLES[str(state.kind, "daily")] ?? (SAMPLES.daily as CardSample);
    return cardMarkup(sample, state, on(state.menu));
  },
  demo: [
    { kind: "daily" },
    { kind: "weekly", progress: true },
    { kind: "on-demand", played: true },
  ],
});
