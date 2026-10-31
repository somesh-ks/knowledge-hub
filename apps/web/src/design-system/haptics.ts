/**
 * Haptics: what a touch device feels when a control answers (D273). A call site names an intent
 * (`fire("open")`), the tokens say which pattern that is (tokens/tokens.json, hapticTokens.ts), and
 * this plays it: milliseconds through navigator.vibrate on Android; on an iPhone, which has no such
 * call, ticks from the hidden switch input of Safari 18 (a script click on its label gives the
 * system's own tick; a click on the input itself gives nothing). The one place either call is made.
 * The Haptics choice in Settings and the cue pipeline that decides when are the app's.
 */
import { HAPTIC_INTENTS, HAPTIC_PATTERNS, type HapticIntent } from "./hapticTokens";

export type HapticSupport = "android" | "ios" | "none";

/** Two answers closer than this are one: a drag can pass a dozen rows a second. */
const MIN_GAP_MS = 90;
const MIN_GAP_DETENT_MS = 40;

/**
 * Which of the two mechanisms this browser has, if either. Both need a touch screen: a desktop
 * browser defines navigator.vibrate and has no motor behind it.
 */
export function detectHapticSupport(
  nav: { vibrate?: unknown } = navigator,
  coarse: () => boolean = () => matchMedia("(pointer: coarse)").matches,
  hasSwitch: () => boolean = () => "switch" in HTMLInputElement.prototype,
): HapticSupport {
  if (!coarse()) return "none";
  if (typeof nav.vibrate === "function") return "android";
  return hasSwitch() ? "ios" : "none";
}

/**
 * One tick on an iPhone: a label that holds a `switch` checkbox, clicked from script. Made on first
 * use, and moved into the open modal dialog when there is one, because the page behind a modal is
 * inert and a click on an inert label does nothing.
 */
export function iosTick(doc: Document = document): () => void {
  let label: HTMLLabelElement | null = null;
  return () => {
    if (!label) {
      label = doc.createElement("label");
      label.className = "sr-only";
      label.setAttribute("aria-hidden", "true");
      // The sound delegate skips what carries this (it is no control).
      label.dataset.sound = "none";
      const input = doc.createElement("input");
      input.type = "checkbox";
      input.setAttribute("switch", "");
      input.tabIndex = -1;
      label.append(input);
    }
    const host = doc.querySelector("dialog:modal") ?? doc.body;
    if (label.parentElement !== host) host.append(label);
    label.click();
  };
}

export interface HapticOptions {
  support: HapticSupport;
  /** The person's choice, read at every fire and again before each later tick. */
  isEnabled: () => boolean;
  /** Android's motor: navigator.vibrate. */
  vibrate?: (pattern: number[]) => unknown;
  /** One iPhone tick. */
  tick?: () => void;
  now?: () => number;
  /** False while the page is hidden: a buzz in a background tab is a bug. */
  isVisible?: () => boolean;
  /** Told each time a haptic is let through, with what it was. */
  onFire?: (intent: HapticIntent) => void;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface Haptics {
  /** True when a haptic went out. False is no support, no pattern, Haptics off, or too soon. */
  fire(intent: HapticIntent): boolean;
  /** Drops the ticks still waiting: Haptics was just turned off. */
  cancel(): void;
  support: HapticSupport;
}

export function createHaptics(options: HapticOptions): Haptics {
  const {
    support,
    isEnabled,
    vibrate,
    tick,
    now = () => performance.now(),
    isVisible = () => true,
    onFire,
    setTimer = (run, ms) => setTimeout(run, ms),
    clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  } = options;
  let last = Number.NEGATIVE_INFINITY;
  let waiting: unknown[] = [];

  const cancel = (): void => {
    for (const handle of waiting) clearTimer(handle);
    waiting = [];
  };

  return {
    support,
    cancel,
    fire(intent) {
      const pattern = HAPTIC_PATTERNS[HAPTIC_INTENTS[intent]];
      if (support === "none" || pattern.ios.ticks === 0) return false;
      if (!isEnabled() || !isVisible()) return false;
      const at = now();
      if (at - last < (intent === "detent" ? MIN_GAP_DETENT_MS : MIN_GAP_MS)) return false;
      last = at;
      if (support === "android") {
        vibrate?.([...pattern.android]);
      } else if (tick) {
        tick();
        for (let beat = 1; beat < pattern.ios.ticks; beat += 1) {
          const handle = setTimer(() => {
            waiting = waiting.filter((other) => other !== handle);
            // Turned off between the beats: the rest do not play.
            if (isEnabled() && isVisible()) tick();
          }, pattern.ios.gap_ms * beat);
          waiting.push(handle);
        }
      }
      onFire?.(intent);
      return true;
    },
  };
}
