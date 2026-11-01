import {
  afterPress,
  applyPress,
  type Choices,
  globalState,
  KINDS,
  type Kind,
  type NotificationState,
  notificationState,
  readCapabilities,
  readChoices,
} from "../lib/pushClient";

/**
 * The Notifications page's switches and the index row's line (D284). What is on is read from this
 * browser (its permission, its push subscription and the person's choices), so the pages are static
 * HTML that this fills in. Loaded only by a page that has them.
 */

/** Empty while the switches can be turned on: the rows' own lines say what they are for. */
const NOTE: Record<NotificationState, string> = {
  on: "",
  off: "",
  blocked: "Blocked in this browser's site settings.",
  needs_install:
    "Add Singularity to your Home Screen first. In Safari, tap Share, then Add to Home Screen.",
  unsupported: "This browser cannot show notifications.",
};

export function mountNotifications(root: HTMLElement): () => void {
  const all = root.querySelector<HTMLInputElement>('input[name="all"]');
  const switches = new Map<Kind, HTMLInputElement | null>(
    KINDS.map((kind) => [kind, root.querySelector<HTMLInputElement>(`input[name="${kind}"]`)]),
  );
  const note = root.querySelector<HTMLElement>("[data-notifications-note]");
  const indexHint = root.querySelector<HTMLElement>("[data-notifications-hint] [data-hint]");
  let alive = true;
  // What the switches show now, so a press builds on the latest state even while an earlier change is pending.
  let shown = readChoices();
  let latest = 0;

  const show = (choices: Choices): void => {
    if (!alive) return;
    shown = choices;
    const state = notificationState(readCapabilities());
    const locked = state === "unsupported" || state === "needs_install" || state === "blocked";
    const group = globalState(choices);
    for (const [kind, input] of switches) {
      if (!input) continue;
      input.checked = choices[kind];
      input.disabled = locked;
    }
    if (all) {
      // Mixed is the native indeterminate state, drawn by the Switch; pressing it turns all on.
      all.checked = group === "on";
      all.indeterminate = group === "mixed";
      all.disabled = locked;
    }
    if (note) {
      note.textContent = NOTE[state];
      note.hidden = NOTE[state] === "";
    }
    if (indexHint) {
      indexHint.textContent = group === "on" ? "On" : group === "mixed" ? "Some" : "Off";
    }
  };

  show(readChoices());

  const onChange = async (event: Event): Promise<void> => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const pressed = target === all ? "all" : KINDS.find((kind) => switches.get(kind) === target);
    if (!pressed) return;
    const next = afterPress(shown, pressed, target.checked);
    // The switches move at once; a refusal from the browser puts them back.
    show(next);
    latest += 1;
    const mine = latest;
    const result = await applyPress(pressed, target.checked);
    // A later press has its own answer coming; showing this one first would flicker.
    if (mine === latest) show(result);
  };
  const listener = (event: Event): void => void onChange(event);
  root.addEventListener("change", listener);
  // The index row has no switches: its line is all it fills in.
  return () => {
    alive = false;
    root.removeEventListener("change", listener);
  };
}
