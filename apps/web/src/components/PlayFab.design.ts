import { attr, defineSpec, esc, icon, on, str } from "../lib/designSpec";

/** The floating button is fixed to the screen and waits behind the hero's Play, so the guide holds it in place. */
const IN_PLACE = "position:static;display:flex;visibility:visible;opacity:1;transform:none";

/**
 * The floating Play button of Today, a briefing or an episode below 64rem (PlayFab.astro). It takes
 * the floating button's shape from create-sheet.css, where the Catch up button also lives.
 */
export default defineSpec({
  id: "play-fab",
  title: "Floating Play button",
  level: "molecule",
  category: "Actions",
  summary:
    "The second face of the hero's Play on a phone: a pill at the screen's corner that plays or resumes the page's audio.",
  usage: { sheet: "create-sheet.css", selector: ".play-fab-glyph" },
  classes: ["create-fab", "create-fab-label", "play-fab", "play-fab-glyph"],
  guidance: [
    "It is the hero Play chip again, not a second player. It waits while the hero's Play is on screen and steps aside while the bar holds the page's audio.",
    "Offline with nothing loaded, the player disables it as it does the chip. The word folds away while scrolling down to read.",
  ],
  controls: [
    {
      kind: "choice",
      id: "status",
      label: "State",
      group: "State",
      value: "idle",
      options: [
        { value: "idle", label: "Idle" },
        { value: "preparing", label: "Preparing" },
        { value: "disabled", label: "Offline" },
      ],
    },
    { kind: "toggle", id: "folded", label: "Folded", group: "State", value: false },
    { kind: "text", id: "label", label: "Words", group: "Content", value: "Play · 8 min", max: 24 },
  ],
  render: (state) => {
    const status = str(state.status, "idle");
    const label = status === "preparing" ? "Loading" : str(state.label, "Play · 8 min");
    return `<button class="create-fab play-fab" type="button" style="${IN_PLACE}" aria-label="Play the podcast, 8 min" data-state="${status === "preparing" ? "preparing" : "idle"}"${status === "disabled" ? ' aria-disabled="true"' : ""}${attr("data-folded", on(state.folded))}><span class="play-fab-glyph" aria-hidden="true">${icon("play", "icon-lg")}<span class="spinner"></span></span><span class="create-fab-label" aria-hidden="true">${esc(label)}</span></button>`;
  },
});
