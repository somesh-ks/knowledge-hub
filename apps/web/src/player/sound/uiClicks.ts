/**
 * The delegated interface sound: one listener for the whole app decides the cue from the control's
 * role (or its `data-sound` attribute), so new UI sounds right without anyone remembering to wire
 * it. Loaded on the first gesture by `scripts/uiSound.ts`; the engine itself is the player's.
 *
 * One cue per action: a control that already has its own cue (a sheet opening, a transport button)
 * is listed in OWNED, and any cue some other path chose during this click wins over the tick.
 * Respecting the Sounds setting, reduced motion and the autoplay rules is the engine's job, so a
 * blocked or disabled engine makes this a silent no-op.
 */
import { cuePlayedSince, playUiCue } from "./soundController";
import { type ControlInfo, createRateLimit, cueForKind, cueForOutcome, kindFor } from "./uiCues";

/** The controls: anything that can be activated, nearest first. */
const CONTROL =
  "[data-sound],a[href],button,input,select,summary,[role=tab],[role=switch],[role=menuitem],[role=radio],[role=checkbox],[role=link]";

/** Controls whose action already plays its own cue (the sheet, the player's open page). */
const OWNED = '[data-open-sheet],[data-open="generate"],[data-player-open],.player-collapse';

const allow = createRateLimit(90);

function flag(el: Element, name: string): boolean | null {
  const value = el.getAttribute(name);
  return value === null || value === "mixed" ? null : value === "true";
}

/** Reads the control after the click, so a switch reports the state it just moved to. */
export function describeControl(el: Element): ControlInfo {
  const input = el instanceof HTMLInputElement ? el : null;
  const anchor = el instanceof HTMLAnchorElement ? el : null;
  const popoverId = el.getAttribute("popovertarget");
  const popover = popoverId ? document.getElementById(popoverId) : null;
  return {
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute("role"),
    inputType: input?.type ?? null,
    dataSound: el.getAttribute("data-sound"),
    internalLink: anchor
      ? anchor.origin === location.origin &&
        !anchor.hasAttribute("download") &&
        anchor.target !== "_blank"
      : false,
    on:
      input?.type === "checkbox" || input?.type === "radio"
        ? input.checked
        : (flag(el, "aria-checked") ?? flag(el, "aria-pressed") ?? flag(el, "aria-selected")),
    // A popover opens after the click handlers run, so the state read here is the one before.
    expanded: popover ? !popover.matches(":popover-open") : flag(el, "aria-expanded"),
    playsItem: el.matches("[data-play-item],.story-row"),
    closesDialog: el.hasAttribute("data-dialog-close"),
    disabled: el.matches(":disabled,[aria-disabled=true]"),
  };
}

export function onUiEvent(event: Event): void {
  if (event.type === "dispatch:sound") {
    const kind = (event as CustomEvent<unknown>).detail;
    if (kind === "success" || kind === "failure") playUiCue(cueForOutcome(kind));
    return;
  }
  const target = event.target;
  if (!(target instanceof Element) || !event.isTrusted) return;
  // A select is answered by its change, when the choice is made; opening it is silent.
  // A checkbox or radio answers its change too, which runs after the page's own handler for it.
  const answersChange =
    target.tagName === "SELECT" ||
    (target instanceof HTMLInputElement && (target.type === "checkbox" || target.type === "radio"));
  if ((event.type === "change") !== answersChange) return;
  const control = target.closest(CONTROL);
  if (!control || control.matches(OWNED)) return;
  const info = describeControl(control);
  const kind = kindFor(info);
  if (kind === "none") return;
  const start = performance.now();
  if (cuePlayedSince(start - 30) || !allow(start)) return;
  const cue = cueForKind(kind, info.on);
  // Announced so a test (and anything else that cares) can see which cue was heard.
  if (cue && playUiCue(cue))
    document.dispatchEvent(new CustomEvent("dispatch:cue", { detail: cue.name }));
}
