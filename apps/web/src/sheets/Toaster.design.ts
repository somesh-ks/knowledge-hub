import { defineSpec, esc, on, str } from "../lib/designSpec";
import { ICON_PATHS, ICON_VIEW_BOX } from "../lib/icons";

/** The glyph the React islands draw (player/ui/Icon.tsx). */
const uiIcon = (name: "check" | "alert" | "close", className = "") =>
  `<svg class="ui-icon${className ? ` ${className}` : ""}" viewBox="${ICON_VIEW_BOX}" aria-hidden="true" focusable="false"><path d="${ICON_PATHS[name]}"></path></svg>`;

/** The toast is a popover that sits above the bars at the screen's foot, so the guide holds it open in place. */
const IN_PLACE = "position:static;display:flex;opacity:1;transform:none";

/** The toast (Toaster.tsx, sheets.css): one quiet message at a time, on the inverse surface. */
export default defineSpec({
  id: "toast",
  title: "Toast",
  level: "molecule",
  category: "Feedback",
  summary:
    "One quiet message on the inverse surface, with an outcome glyph and at most one action.",
  frame: "wide",
  usage: { sheet: "sheets.css", selector: ".toast" },
  classes: ["toast", "toast-icon", "toast-text", "toast-action", "toast-dismiss"],
  decisions: ["D115", "D168"],
  guidance: [
    "Settings save quietly. A toast is for a failure, an Undo or a partial save.",
    "The glyph, a check or an alert, tells the outcome so colour does not carry it alone. The action is in the accent, and Dismiss shows only while a toast stays until used.",
    "A toast speaks its own message as a status, or an alert for an error, and never takes focus. A finger swipes it away sideways.",
  ],
  controls: [
    {
      kind: "choice",
      id: "kind",
      label: "Outcome",
      group: "Variant",
      value: "success",
      options: [
        { value: "none", label: "Plain" },
        { value: "success", label: "Success" },
        { value: "error", label: "Error" },
      ],
    },
    { kind: "toggle", id: "action", label: "Action", group: "Content", value: false },
    {
      kind: "text",
      id: "message",
      label: "Message",
      group: "Content",
      value: "Source removed",
      max: 24,
    },
  ],
  render: (state) => {
    const kind = str(state.kind, "success");
    const glyph = kind === "none" ? "" : uiIcon(kind === "error" ? "alert" : "check", "toast-icon");
    const action = on(state.action)
      ? `<button class="toast-action" type="button">Undo</button><button class="toast-dismiss press" type="button" aria-label="Dismiss">${uiIcon("close")}</button>`
      : "";
    return `<div class="toast" popover="manual" role="${kind === "error" ? "alert" : "status"}" style="${IN_PLACE}">${glyph}<span class="toast-text">${esc(str(state.message, "Source removed"))}</span>${action}</div>`;
  },
});
