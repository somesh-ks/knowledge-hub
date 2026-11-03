import { applyPress, type Capabilities, notificationState, readCapabilities } from "./pushClient";

/** What the "Notify me when it's ready" row on a sheet shows. */
export interface ReadyView {
  /** Hidden where the browser cannot deliver, or has refused: Settings says why, a sheet does not nag. */
  show: boolean;
  /** On only when Podcast ready is chosen here and the browser's permission stands. */
  checked: boolean;
}

export function readyView(capabilities: Capabilities): ReadyView {
  const state = notificationState(capabilities);
  if (state !== "on" && state !== "off") return { show: false, checked: false };
  return {
    show: true,
    checked: capabilities.chosen.ready && capabilities.permission === "granted",
  };
}

export const currentReadyView = (): ReadyView => readyView(readCapabilities());

/**
 * Turns Podcast ready on or off for this browser, from the press that called it (the permission
 * prompt needs that). Returns what the row shows now: off again when the browser said no, and gone
 * when it refused for good.
 */
export async function setReady(
  checked: boolean,
  apply: typeof applyPress = applyPress,
  view: () => ReadyView = currentReadyView,
): Promise<ReadyView> {
  try {
    await apply("ready", checked);
  } catch {
    // The view below still reads what the browser allows.
  }
  return view();
}
