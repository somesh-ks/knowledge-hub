/**
 * The delegated interface sound: one listener for the whole app decides the cue from the control's
 * role (or its `data-sound` attribute), so new UI sounds right without anyone remembering to wire
 * it. Loaded on the first gesture by `scripts/uiSound.ts`; the engine itself is the player's.
 *
 * One cue per action: a control that already has its own cue (a sheet opening, a transport button)
 * is listed in OWNED, and any cue some other path chose during this click wins over the tick.
 * Events arrive one task after the press (see uiSound.ts), so the page's own handlers have run and
 * the control reads as it is now. Dialogs and popovers that close by Escape or a press outside have
 * no control to press, so their own open and close events are heard here too. Respecting the Sounds
 * setting, reduced motion and the autoplay rules is the engine's job, so a blocked or disabled
 * engine makes this a silent no-op.
 */
import { WHEEL_DETENT } from "../../design-system/wheel";
import { cuePlayedSince, getHaptics, playUiCue } from "./soundController";
import type { Cue } from "./soundMap";
import {
  type ControlInfo,
  createRateLimit,
  cueForKind,
  cueForOutcome,
  kindFor,
  type SoundKind,
} from "./uiCues";

/** The controls: anything that can be activated, nearest first. */
const CONTROL =
  "[data-sound],a[href],button,input,select,summary,.picker-option,[role=button],[role=tab],[role=switch],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=radio],[role=checkbox],[role=link]";

/**
 * Controls whose action already plays its own cue (the sheet, the player's open page, play and pause,
 * which narration silences on purpose and a tick must not undo).
 */
const OWNED =
  '[data-open-sheet],[data-open="generate"],[data-player-open],.player-collapse,[data-primary],[data-play-digest]';

/** A MultiSelect's hidden checkbox is changed by script, from a press or a key, so it is no stranger. */
const SCRIPTED_CHOICE = "[data-multiselect]";

/** A script's click right after a key (Enter in a field pressing its button) is that key's action. */
const KEY_CLICK_MS = 150;

/** A cue too soon after another is a double: a tap and its dialog, a toggle and its popover. */
const ECHO_MS = 120;

const allow = createRateLimit(90);
const readyAt = performance.now();
let lastKeyAt = Number.NEGATIVE_INFINITY;

function flag(el: Element, name: string): boolean | null {
  const value = el.getAttribute(name);
  return value === null || value === "mixed" ? null : value === "true";
}

/** Reads the control as it is now, after the page's own handlers have answered the press. */
export function describeControl(el: Element): ControlInfo {
  const input = el instanceof HTMLInputElement ? el : null;
  const popoverId = el.getAttribute("popovertarget");
  const popover = popoverId ? document.getElementById(popoverId) : null;
  const details = el.tagName === "SUMMARY" ? el.parentElement : null;
  return {
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute("role"),
    inputType: input?.type ?? null,
    dataSound: el.getAttribute("data-sound"),
    on:
      input?.type === "checkbox" || input?.type === "radio"
        ? input.checked
        : (flag(el, "aria-checked") ?? flag(el, "aria-pressed") ?? flag(el, "aria-selected")),
    expanded: popover
      ? popover.matches(":popover-open")
      : details instanceof HTMLDetailsElement
        ? details.open
        : flag(el, "aria-expanded"),
    playsItem: el.matches("[data-play-item],.story-row"),
    closesDialog: el.hasAttribute("data-dialog-close"),
    disabled: el.matches(":disabled,[aria-disabled=true]"),
  };
}

/** A press the person made, or the script's own for it: a MultiSelect choice, a key's click. */
function isPersonal(event: Event, target: Element): boolean {
  if (event.isTrusted) return true;
  if (event.type === "change") return target.closest(SCRIPTED_CHOICE) !== null;
  return event.type === "click" && event.timeStamp - lastKeyAt < KEY_CLICK_MS;
}

export function onUiEvent(event: Event): void {
  if (event.type === "singularity:sound") {
    const kind = (event as CustomEvent<unknown>).detail;
    if (kind === "success" || kind === "failure") playUiCue(cueForOutcome(kind));
    return;
  }
  const target = event.target;
  if (!(target instanceof Element) || !isPersonal(event, target)) return;
  // A select is answered by its change, when the choice is made; opening it is silent.
  // A checkbox or radio answers its change too, which runs after the page's own handler for it.
  const answersChange =
    target.tagName === "SELECT" ||
    (target instanceof HTMLInputElement && (target.type === "checkbox" || target.type === "radio"));
  if ((event.type === "change") !== answersChange) return;
  const control = target.closest(CONTROL);
  if (!control || control.matches(OWNED)) return;
  const info = describeControl(control);
  let kind: SoundKind = kindFor(info);
  // The press that loaded this module opened its dialog before anything here could watch it.
  if (
    kind === "tap" &&
    event.timeStamp < readyAt &&
    document.querySelector("dialog[open]") &&
    !control.closest("dialog")
  ) {
    kind = "open";
  }
  if (kind === "none") return;
  if (cuePlayedSince(event.timeStamp - 30) || !allow(performance.now())) return;
  say(cueForKind(kind, info.on));
}

/** Plays the cue and announces it, so a test (and anything else that cares) sees which was heard. */
function say(cue: Cue | null): void {
  if (cue && playUiCue(cue))
    document.dispatchEvent(new CustomEvent("singularity:cue", { detail: cue.name }));
}

/** An open or close the press already sounded (or that follows one) is not sounded again. */
function sayState(opening: boolean): void {
  // A close right after an open (or an open right after a close) is the person's, not an echo.
  if (cuePlayedSince(performance.now() - ECHO_MS, opening ? "sheetClose" : "sheetOpen")) return;
  say(cueForKind(opening ? "open" : "close"));
}

if (typeof document !== "undefined") {
  addEventListener(
    "keydown",
    (event) => {
      if (event.isTrusted) lastKeyAt = event.timeStamp;
    },
    { capture: true, passive: true },
  );
  // The wheel (the hour picker) turning past a row is felt and has no sound (D273, D269): the
  // wheel fires at most once a frame and the dispatcher's own gap keeps a fling to a tick.
  document.addEventListener(WHEEL_DETENT, () => getHaptics().fire("detent"), { passive: true });
  // A native dialog opens and closes by an attribute, whoever did it: a button, Escape, the scrim.
  new MutationObserver((records) => {
    for (const { target, oldValue } of records) {
      if (!(target instanceof HTMLDialogElement)) continue;
      const open = target.hasAttribute("open");
      if (open === (oldValue === null)) sayState(open);
    }
  }).observe(document, {
    attributes: true,
    attributeFilter: ["open"],
    attributeOldValue: true,
    subtree: true,
  });
  // A popover closes by Escape or a press outside too. A manual one (the toast) is not a menu.
  document.addEventListener(
    "toggle",
    (event) => {
      const popover = event.target;
      if (!(popover instanceof HTMLElement) || !popover.matches("[popover]:not([popover=manual])"))
        return;
      sayState((event as Event & { newState?: string }).newState === "open");
    },
    true,
  );
}
