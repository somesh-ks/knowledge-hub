/**
 * The press ripple (owner, 2026-11-01: touch feedback that shows the touch area "as a ripple ...
 * aligned to Material design", and "should have some easing to keep it naturally calm"). A control
 * that carries `data-ripple` and holds a `.ripple` layer draws a wave from the point a finger lands
 * and fills the layer; on the lift the wave stays until it has grown a little, then fades. The
 * layer is the touch area and clips the wave. Time and curve are the stylesheet's (ripple.css), so
 * the clock is the one the rest of the travel uses.
 *
 * A control that moves the page is swapped for its twin on the page that arrives. The wave in
 * flight is drawn again there, at the point it had reached, so the press is one gesture across
 * the move and not a flash on the old page.
 */
import type { Guidance } from "./guidance";

export const RIPPLE: Guidance = {
  summary: "A wave from the touch point that fills a control's touch area, then fades.",
  useWhen: ["A large touch target on a phone must show where it was pressed: a bottom bar tab."],
  dontUseWhen: [
    {
      when: "A small control needs a press state.",
      instead: "Icon button",
    },
    {
      when: "A pointer, not a finger, presses it.",
    },
  ],
};

/** Every class the Ripple draws, for the registry and its test. */
export const RIPPLE_CLASSES: string[] = ["ripple", "ripple-wave"];

/** Classes the Ripple replaced; none, as it is new. */
export const RIPPLE_RETIRED: string[] = [];

interface Press {
  /** The control's href or id: the twin on the next page. */
  key: string;
  /** Where the finger landed, in the layer's own coordinates. */
  x: number;
  y: number;
  /** The page's animation clock at the press and at the lift. */
  start: number;
  lift: number | null;
}

interface Timing {
  grow: number;
  fade: number;
  ease: string;
  /** Share of the growth that has played before a lift starts the fade. */
  hold: number;
}

let press: Press | null = null;

/** The animation clock: it advances by frames, so a stall while a page is swapped does not count. */
function clock(): number {
  return Number(document.timeline.currentTime ?? performance.now());
}

function milliseconds(value: string): number {
  const number = Number.parseFloat(value);
  return value.trim().endsWith("ms") ? number : number * 1000;
}

function timing(layer: HTMLElement): Timing {
  const style = getComputedStyle(layer);
  return {
    grow: milliseconds(style.getPropertyValue("--ripple-grow")),
    fade: milliseconds(style.getPropertyValue("--ripple-fade")),
    ease: style.getPropertyValue("--ripple-ease").trim() || "ease-out",
    hold: Number.parseFloat(style.getPropertyValue("--ripple-hold")) || 0,
  };
}

function keyOf(control: Element): string {
  return control.getAttribute("href") ?? control.id;
}

/** Draws the wave for `p` on `layer`, as far along as `now` puts it. */
function draw(layer: HTMLElement, p: Press, now: number): void {
  const t = timing(layer);
  const box = layer.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return;
  const radius = Math.hypot(Math.max(p.x, box.width - p.x), Math.max(p.y, box.height - p.y));
  const wave = document.createElement("span");
  wave.className = "ripple-wave";
  wave.style.width = wave.style.height = `${radius * 2}px`;
  wave.style.left = `${p.x - radius}px`;
  wave.style.top = `${p.y - radius}px`;
  layer.append(wave);

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const elapsed = now - p.start;
  if (!reduced) {
    const grow = wave.animate([{ transform: "scale(0)" }, { transform: "scale(1)" }], {
      duration: t.grow,
      easing: t.ease,
      fill: "forwards",
    });
    grow.currentTime = elapsed;
  }
  schedule(wave, p, t, now);
}

/** Starts the fade once the finger is up and the wave has grown a little; removes the wave after. */
function schedule(wave: HTMLElement, p: Press, t: Timing, now: number): void {
  if (p.lift === null) return;
  const begins = Math.max(p.lift, p.start + t.grow * t.hold);
  const fade = wave.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: t.fade,
    delay: begins - p.start,
    easing: t.ease,
    fill: "both",
  });
  fade.currentTime = now - p.start;
  void fade.finished.then(
    () => wave.remove(),
    () => wave.remove(),
  );
}

/** The control reads as pressed from the first touch: `:active` waits out the browser's press delay. */
function setPressed(control: Element | undefined, on: boolean): void {
  for (const other of document.querySelectorAll("[data-pressed]")) {
    if (other !== control || !on) other.removeAttribute("data-pressed");
  }
  if (on) control?.setAttribute("data-pressed", "");
}

function lift(): void {
  setPressed(undefined, false);
  if (!press || press.lift !== null) return;
  press.lift = clock();
  for (const wave of document.querySelectorAll<HTMLElement>(".ripple-wave")) {
    const layer = wave.parentElement;
    if (layer) schedule(wave, press, timing(layer), press.lift);
  }
}

export function installRipple(): void {
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0) return;
      const control = (event.target as Element | null)?.closest<HTMLElement>("[data-ripple]");
      const layer = control?.querySelector<HTMLElement>(":scope > .ripple");
      if (!control || !layer || getComputedStyle(layer).display === "none") return;
      const box = layer.getBoundingClientRect();
      press = {
        key: keyOf(control),
        x: event.clientX - box.left,
        y: event.clientY - box.top,
        start: clock(),
        lift: null,
      };
      setPressed(control, true);
      draw(layer, press, press.start);
    },
    { capture: true },
  );
  document.addEventListener("pointerup", lift, { capture: true });
  document.addEventListener("pointercancel", lift, { capture: true });

  // The page that arrives has the control again: the wave goes on there, from where it had got to.
  let carried: { played: number; lifted: number | null } | null = null;
  document.addEventListener("astro:before-swap", () => {
    carried = press
      ? {
          played: clock() - press.start,
          lifted: press.lift === null ? null : press.lift - press.start,
        }
      : null;
  });
  document.addEventListener("astro:after-swap", () => {
    if (!press || !carried) return;
    const now = clock();
    press.start = now - carried.played;
    press.lift = carried.lifted === null ? null : press.start + carried.lifted;
    const twin = [...document.querySelectorAll<HTMLElement>("[data-ripple]")].find(
      (control) => keyOf(control) === press?.key,
    );
    const layer = twin?.querySelector<HTMLElement>(":scope > .ripple");
    if (layer) {
      if (press.lift === null) setPressed(twin, true);
      draw(layer, press, now);
    }
  });
}
