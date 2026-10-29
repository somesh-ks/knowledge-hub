import { attr, defineSpec, icon, on } from "../lib/designSpec";
import { ICON_PATHS, ICON_VIEW_BOX } from "../lib/icons";

/** The glyph the sheets' React islands draw (player/ui/Icon.tsx): the same paths under another class. */
const uiIcon = (name: "alert") =>
  `<svg class="ui-icon" viewBox="${ICON_VIEW_BOX}" aria-hidden="true" focusable="false"><path d="${ICON_PATHS[name]}"></path></svg>`;

/** The Regenerate sheet's surface (sheets/SheetFrame.tsx, sheets/GenerateSheet.tsx), held in place without its scrim. */
export default defineSpec({
  id: "sheet",
  title: "Sheet",
  level: "organism",
  category: "Overlays",
  summary:
    "The raised surface a task opens on: a bottom sheet on a phone, a centred dialog from 40rem, with a header, fields and one action.",
  frame: "wide",
  classes: [
    "sheet-panel",
    "sheet-head",
    "sheet-form",
    "sheet-field",
    "sheet-field-label",
    "sheet-input",
    "sheet-field-error",
    "sheet-actions",
  ],
  decisions: ["D132", "D144"],
  guidance: [
    "A sheet is a flat surface with one accent. Its buttons are the shared ones: one filled button for the action that commits, text buttons for the rest.",
    "On a phone the sheet rests on the screen's edge with round top corners and no visible Close; it is pulled down or tapped away. From 40rem it is a centred dialog that keeps its corners.",
    "Busy keeps the accent fill: the spinner and the word say working, not unavailable.",
  ],
  controls: [
    { kind: "toggle", id: "error", label: "Error", group: "State", value: false },
    { kind: "toggle", id: "busy", label: "Busy", group: "State", value: false },
  ],
  render: (state) => {
    const busy = on(state.busy);
    const error = on(state.error)
      ? `<p class="sheet-field-error" role="alert">${uiIcon("alert")}<span>Couldn't reach the site. Check your connection, then try again.</span></p>`
      : "";
    const action = busy
      ? `<button class="btn-primary" type="submit" aria-disabled="true" data-busy="true"><span class="spinner" aria-hidden="true"></span>Regenerating</button>`
      : `<button class="btn-primary" type="submit">Regenerate</button>`;
    return `<div class="sheet-panel" tabindex="-1"><div class="sheet-head"><h2 class="sheet-title">Regenerate</h2><button class="icon-btn press" type="button" aria-label="Close">${icon("close", "icon-lg")}</button></div><form class="sheet-form" novalidate><div class="sheet-field"><label class="sheet-field-label" for="sheet-sample-note">Comments (optional)</label><textarea class="sheet-input" id="sheet-sample-note" name="feedback" rows="4" placeholder="For example: shorter summaries, more on design systems."${attr("disabled", busy)}></textarea></div>${error}<div class="sheet-actions">${action}</div></form></div>`;
  },
});
