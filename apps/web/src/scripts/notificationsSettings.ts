import {
  disableNotifications,
  enableNotifications,
  type NotificationState,
  notificationState,
  readCapabilities,
} from "../lib/pushClient";

/**
 * The Notifications switch on the Settings index (D284). Whether they are on is read from this
 * browser (its permission, its push subscription and the person's choice), so the page is static
 * HTML that this fills in. Loaded only by a page that has the switch.
 */

/** Empty while the switch can be turned on: the row's own line already says what it is for. */
const NOTE: Record<NotificationState, string> = {
  on: "",
  off: "",
  blocked: "Blocked in this browser's site settings.",
  needs_install:
    "Add Singularity to your Home Screen first. In Safari, tap Share, then Add to Home Screen.",
  unsupported: "This browser cannot show notifications.",
};

export function mountNotifications(root: HTMLElement): () => void {
  const toggle = root.querySelector<HTMLInputElement>('input[name="notifications"]');
  const note = root.querySelector<HTMLElement>("[data-notifications-note]");
  let alive = true;

  const show = (state: NotificationState): void => {
    if (!alive) return;
    if (toggle) {
      toggle.checked = state === "on";
      toggle.disabled = state === "unsupported" || state === "needs_install" || state === "blocked";
    }
    if (note) {
      note.textContent = NOTE[state];
      note.hidden = NOTE[state] === "";
    }
  };

  show(notificationState(readCapabilities()));

  const onChange = async (event: Event): Promise<void> => {
    if (event.target !== toggle || !toggle) return;
    if (toggle.checked) {
      // The browser asks from this press, as iOS requires. The switch already says On; a refusal
      // puts it back.
      show(await enableNotifications());
    } else {
      await disableNotifications();
      show(notificationState(readCapabilities()));
    }
  };
  const listener = (event: Event): void => void onChange(event);
  root.addEventListener("change", listener);
  return () => {
    alive = false;
    root.removeEventListener("change", listener);
  };
}
