import { attr, defineSpec, on, str } from "../lib/designSpec";
import { ICON_PATHS, ICON_VIEW_BOX, type IconName } from "../player/ui/iconPathsLazy";

/** A glyph as the player's Icon.tsx draws it: its own `ui-icon` class, not the page's `icon`. */
const uiIcon = (name: IconName, className = ""): string =>
  `<svg class="ui-icon${className ? ` ${className}` : ""}" viewBox="${ICON_VIEW_BOX}" aria-hidden="true" focusable="false"><path d="${ICON_PATHS[name]}"></path></svg>`;

/** PlayPauseGlyph.tsx: play and pause share one slot, and data-playing on the button picks one. */
const PLAY_PAUSE = `<span class="glyph-swap">${uiIcon("play", "glyph-paused")}${uiIcon("pause", "glyph-playing")}</span>`;

/**
 * The round controls of the player: the transport on the player page (TransportControls.tsx) and the
 * buttons of the dock bar (PlayerBar.tsx). The same part at two scales. Play is the one filled
 * control of the transport; in the dock it is a plain glyph like its neighbours.
 */
export default defineSpec({
  id: "player-button",
  title: "Player button",
  level: "atom",
  category: "Actions",
  summary:
    "The round controls of the player: previous, skip, play and next on the page, and the same buttons in the dock.",
  classes: ["transport-btn", "dock-btn"],
  guidance: [
    "On the page only Play is in full ink and filled: the accent disc, larger than the rest. Previous, next and the skips are quiet.",
    "From 64rem with a mouse the page keeps only the two skips: previous, play and next live in the dock bar. The dock's play is a filled disc from 64rem and a bare glyph below it.",
    "A control that does nothing says so with aria-disabled: it turns grey and ignores a press, and stays focusable.",
    "While the audio is on its way a spinner takes the play glyph's place and the two cross-fade.",
  ],
  controls: [
    {
      kind: "choice",
      id: "kind",
      label: "Kind",
      group: "Variant",
      value: "play",
      options: [
        { value: "play", label: "Play" },
        { value: "next", label: "Next" },
        { value: "skip", label: "Skip" },
        { value: "dock-play", label: "Dock play" },
        { value: "dock-next", label: "Dock next" },
      ],
    },
    { kind: "toggle", id: "playing", label: "Playing", group: "State", value: false },
    { kind: "toggle", id: "loading", label: "Loading", group: "State", value: false },
    { kind: "toggle", id: "disabled", label: "Disabled", group: "State", value: false },
  ],
  render: (state) => {
    const kind = str(state.kind, "play");
    const disabled = attr('aria-disabled="true"', state.disabled);
    const playing = on(state.playing);
    const loading = on(state.loading);
    const toggle = `type="button" data-primary data-playing="${playing}" data-loading="${loading}" aria-label="${playing ? "Pause" : "Play"}"${loading ? ' aria-busy="true"' : ""}${disabled}`;
    // From 64rem the page hides every transport button but the skips (player.css), so the sample
    // shows them anyway.
    const shown = ' style="display: grid"';
    const spinner = '<span class="spinner" aria-hidden="true"></span>';
    if (kind === "next")
      return `<button class="transport-btn press" type="button" aria-label="Next story"${shown}${disabled}>${uiIcon("skipForward")}</button>`;
    if (kind === "skip")
      return `<button class="transport-btn transport-skip press" type="button" aria-label="Forward 10 seconds"${disabled}>${uiIcon("forward10")}<span class="transport-skip-num num" aria-hidden="true">10</span></button>`;
    if (kind === "dock-play")
      return `<button class="dock-btn press" ${toggle}>${PLAY_PAUSE}${spinner}</button>`;
    if (kind === "dock-next")
      return `<button class="dock-btn press" type="button" aria-label="Next story"${disabled}>${uiIcon("skipForward")}</button>`;
    return `<button class="transport-btn press"${shown} ${toggle}>${PLAY_PAUSE}${spinner}</button>`;
  },
});
