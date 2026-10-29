import { attr, defineSpec, on, str } from "../lib/designSpec";

/** A dialog is modal in the top layer and centred on the screen, so the guide holds it open in place. */
const IN_PLACE = "position:relative;inset:auto;margin:0 auto";

/** The small yes or no dialog (create-sheet.css, episode-actions.css): Delete's confirm, the speed offer, the unsaved-changes guard. */
export default defineSpec({
  id: "confirm-dialog",
  title: "Confirm dialog",
  level: "organism",
  category: "Overlays",
  summary:
    "A small question that needs a yes or no before anything changes: a title, a line and two or three buttons.",
  frame: "wide",
  classes: ["confirm-dialog", "confirm-form", "confirm-actions", "confirm-delete", "is-stacked"],
  guidance: [
    "Red is for Delete alone, once the person has asked to delete. Cancel comes first and takes focus.",
    "Three choices stack, the committing one first: the unsaved-changes guard.",
    "It fades and scales in over a scrim that only fades; with reduced motion it fades where it stands.",
  ],
  controls: [
    {
      kind: "choice",
      id: "kind",
      label: "Question",
      group: "Variant",
      value: "delete",
      options: [
        { value: "delete", label: "Delete" },
        { value: "offer", label: "Offer" },
        { value: "guard", label: "Unsaved changes" },
      ],
    },
    { kind: "toggle", id: "busy", label: "Working", group: "State", value: false },
  ],
  render: (state) => {
    const kind = str(state.kind, "delete");
    const busy = on(state.busy);
    if (kind === "offer")
      return `<dialog class="confirm-dialog" open style="${IN_PLACE}" aria-labelledby="confirm-sample-title"><div class="confirm-form"><h2 class="sheet-title" id="confirm-sample-title">Make 1.25x your default speed?</h2><div class="confirm-actions"><button class="btn" type="button">Not now</button><button class="btn" type="button">Make default</button></div></div></dialog>`;
    if (kind === "guard")
      return `<dialog class="confirm-dialog" open style="${IN_PLACE}" aria-labelledby="confirm-sample-title"><div class="confirm-form"><h2 class="sheet-title" id="confirm-sample-title">Save changes?</h2><div class="confirm-actions is-stacked"><button class="btn-primary" type="button">Save</button><button class="btn" type="button">Discard</button><button class="btn" type="button">Keep editing</button></div></div></dialog>`;
    return `<dialog class="confirm-dialog" open style="${IN_PLACE}" aria-labelledby="confirm-sample-title" aria-describedby="confirm-sample-lede"><form class="confirm-form" novalidate><h2 class="sheet-title" id="confirm-sample-title">Delete this episode?</h2><p class="create-hint confirm-lede" id="confirm-sample-lede">It will be removed from the Library on every device. This cannot be undone.</p><div class="confirm-actions"><button class="btn" type="button"${attr("disabled", busy)}>Cancel</button><button class="btn confirm-delete" type="submit"${attr("disabled", busy)}>Delete</button></div></form></dialog>`;
  },
});
