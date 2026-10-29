import { defineSpec, esc, icon, on, str } from "../lib/designSpec";

/** The words a chip says in each state, as readerMath.ts writes them. */
const LABELS: Record<string, string> = {
  current: "12 min left",
  played: "Played",
  preparing: "Loading",
  error: "Try again",
  unavailable: "Expired",
};

/** The play chip as PlayChip.astro draws it. Script writes data-state, data-playing and the label. */
export default defineSpec({
  id: "play-chip",
  title: "Play chip",
  level: "molecule",
  category: "Actions",
  summary:
    "The tonal pill that plays a briefing or one story: a mark that follows the state, and a short label.",
  usage: { sheet: "buttons.css", selector: ".chip" },
  classes: [
    "chip",
    "chip-glyph",
    "chip-label",
    "chip-text",
    "chip-bars",
    "chip-check",
    "chip-again",
    "chip-refresh",
    "chip-replay",
    "swap",
    "swap-paused",
    "swap-playing",
  ],
  decisions: ["D72", "D106"],
  controls: [
    {
      kind: "choice",
      id: "state",
      label: "State",
      group: "State",
      value: "idle",
      options: [
        { value: "idle", label: "Idle" },
        { value: "current", label: "Current" },
        { value: "played", label: "Played" },
        { value: "preparing", label: "Preparing" },
        { value: "error", label: "Error" },
        { value: "unavailable", label: "Unavailable" },
      ],
    },
    { kind: "toggle", id: "playing", label: "Playing", group: "State", value: false },
    { kind: "text", id: "length", label: "Length", group: "Content", value: "1:24", max: 12 },
  ],
  demo: [
    { state: "idle", playing: false },
    { state: "current", playing: true },
    { state: "current", playing: false },
    { state: "preparing", playing: true },
    { state: "played", playing: false },
    { state: "error", playing: false },
    { state: "unavailable", playing: false },
  ],
  render: (state) => {
    // Only a loaded chip is ever playing, so Playing on an idle chip loads it.
    const asked = str(state.state, "idle");
    const chip = on(state.playing) && asked === "idle" ? "current" : asked;
    const playing = on(state.playing) && (chip === "current" || chip === "preparing");
    const label = chip === "idle" ? esc(str(state.length, "1:24")) : (LABELS[chip] ?? "");
    const unavailable = chip === "unavailable" ? ' aria-disabled="true"' : "";
    return `<button class="chip" type="button" data-state="${chip}" data-playing="${playing}"${unavailable}><span class="chip-glyph" aria-hidden="true"><span class="swap">${icon("play", "swap-paused")}${icon("pause", "swap-playing")}</span><span class="chip-bars"><i></i><i></i><i></i></span>${icon("check", "chip-check")}${icon("replay", "chip-replay")}${icon("refresh", "chip-refresh")}<span class="spinner"></span></span><span class="chip-text"><span class="chip-label" data-chip-label>${label}</span><span class="chip-again" aria-hidden="true">Play again</span></span></button>`;
  },
});
