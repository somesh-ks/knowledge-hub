import {
  disableNotifications,
  enableNotifications,
  type NotificationState,
  notificationState,
  readCapabilities,
} from "../lib/pushClient";

/**
 * The Notifications row of Settings (D284), on its own page and as a line on the index. Whether they
 * are on is read from this browser (its permission, its push subscription and the person's switch),
 * so the page is static HTML that this fills in. Loaded only by a page that has the row.
 */

const NOTE: Record<NotificationState, string> = {
  on: "A ping when a Catch up or a new take you started is ready.",
  off: "A ping when a Catch up or a new take you started is ready.",
  blocked: "Blocked in this browser's site settings.",
  needs_install:
    "Add Singularity to your Home Screen first. In Safari, tap Share, then Add to Home Screen.",
  unsupported: "This browser cannot show notifications.",
};

export function mountNotifications(root: HTMLElement): () => void {
  const select = root.querySelector<HTMLSelectElement>('select[name="notifications"]');
  const note = root.querySelector<HTMLElement>("[data-notifications-note]");
  const indexHint = root.querySelector<HTMLElement>("[data-notifications-hint] [data-hint]");
  let alive = true;

  const show = (state: NotificationState): void => {
    if (!alive) return;
    if (select) {
      select.value = state === "on" ? "on" : "off";
      select.disabled = state === "unsupported" || state === "needs_install" || state === "blocked";
      select.inert = false;
    }
    if (note) note.textContent = NOTE[state];
    if (indexHint) indexHint.textContent = state === "on" ? "On" : "Off";
  };

  show(notificationState(readCapabilities()));

  const onChange = async (event: Event): Promise<void> => {
    if (event.target !== select || !select) return;
    if (select.value === "on") {
      // The browser asks from this press, as iOS requires. The select already says On; a refusal
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
