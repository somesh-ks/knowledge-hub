/**
 * The press ripple (owner, 2026-11-01: touch feedback that shows the touch area "as a ripple ...
 * aligned to Material design", and "should have some easing to keep it naturally calm"). A control
 * that carries `data-ripple` and holds a `.ripple-area` layer draws a wave from the point a finger lands
 * and fills the layer; on the lift the wave stays until it has grown a little, then fades. The
 * layer is the touch area and clips the wave. Time and curve are the stylesheet's (ripple.css), so
 * the clock is the one the rest of the travel uses.
 *
 * A control that moves the page is swapped for its twin on the page that arrives. The waves in
 * flight are drawn again there, at the point they had reached, so the press is one gesture across
 * the move and not a flash on the old page.
 *
 * Each press is its own: it knows its pointer, its control and its waves, so a second finger, or a
 * tap while an earlier wave is fading, never ends or restarts another. The pressed state is the
 * attribute `data-ripple-pressed`, which only the press that set it clears.
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
export const RIPPLE_CLASSES: string[] = ["ripple-area", "ripple-wave"];

/** Classes the Ripple replaced; none, as it is new. */
export const RIPPLE_RETIRED: string[] = [];

/** The attribute a control wears while a finger is on it: `:active` waits out the browser's press delay. */
export const RIPPLE_PRESSED = "data-ripple-pressed";

/** One finger's press: where it landed, when, and the waves it drew. */
interface Press {
  /** The pointer that made it: only its own lift or cancel ends it. */
  id: number;
  /** The control's href or id: the twin on the next page. */
  key: string;
  control: HTMLElement;
  /** Where the finger landed, in the layer's own coordinates. */
  x: number;
  y: number;
  /** The page's animation clock at the press and at the lift. */
  start: number;
  lift: number | null;
  waves: HTMLElement[];
}

interface Timing {
  grow: number;
  fade: number;
  ease: string;
  /** Share of the growth that has played before a lift starts the fade. */
  hold: number;
}

/** The presses still showing something: a finger down, or a wave still fading. */
const presses = new Set<Press>();

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

function layerOf(control: Element | null | undefined): HTMLElement | null {
  return control?.querySelector<HTMLElement>(":scope > .ripple-area") ?? null;
}

/** A press that has lifted and has no wave left has nothing more to show. */
function settle(p: Press): void {
  if (p.lift !== null && p.waves.length === 0) presses.delete(p);
}

/** Draws a wave for `p` on `layer`, as far along as `now` puts it. */
function draw(layer: HTMLElement, p: Press, now: number): void {
  // With reduced motion there is no wave: the control's pressed state says it alone.
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
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
  p.waves.push(wave);

  const grow = wave.animate([{ transform: "scale(0)" }, { transform: "scale(1)" }], {
    duration: t.grow,
    easing: t.ease,
    fill: "forwards",
  });
  grow.currentTime = now - p.start;
  fade(wave, p, t, now);
}

/** Starts the fade once the finger is up and the wave has grown a little; removes the wave after. */
function fade(wave: HTMLElement, p: Press, t: Timing, now: number): void {
  if (p.lift === null) return;
  const begins = Math.max(p.lift, p.start + t.grow * t.hold);
  const out = wave.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: t.fade,
    delay: begins - p.start,
    easing: t.ease,
    fill: "both",
  });
  out.currentTime = now - p.start;
  const done = (): void => {
    wave.remove();
    p.waves = p.waves.filter((w) => w !== wave);
    settle(p);
  };
  void out.finished.then(done, done);
}

/** The press ends: its control stops reading as pressed and its own waves start to fade. */
function lift(p: Press): void {
  if (p.lift !== null) return;
  p.lift = clock();
  p.control.removeAttribute(RIPPLE_PRESSED);
  for (const wave of p.waves) {
    const layer = wave.parentElement;
    if (layer) fade(wave, p, timing(layer), p.lift);
  }
  settle(p);
}

function end(event: PointerEvent): void {
  for (const p of presses) if (p.id === event.pointerId) lift(p);
}

export function installRipple(): void {
  document.addEventListener(
    "pointerdown",
    (event) => {
      // A finger, or a pen: a pointer has the control's hover and press layers already.
      if (event.button !== 0 || event.pointerType === "mouse") return;
      const control = (event.target as Element | null)?.closest<HTMLElement>("[data-ripple]");
      const layer = layerOf(control);
      if (!control || !layer || getComputedStyle(layer).display === "none") return;
      const box = layer.getBoundingClientRect();
      const p: Press = {
        id: event.pointerId,
        key: keyOf(control),
        control,
        x: event.clientX - box.left,
        y: event.clientY - box.top,
        start: clock(),
        lift: null,
        waves: [],
      };
      presses.add(p);
      control.setAttribute(RIPPLE_PRESSED, "");
      draw(layer, p, p.start);
    },
    { capture: true },
  );
  document.addEventListener("pointerup", end, { capture: true });
  document.addEventListener("pointercancel", end, { capture: true });

  // The page that arrives has the control again: each wave goes on there, from where it had got to.
  let carried: { press: Press; played: number; lifted: number | null }[] = [];
  document.addEventListener("astro:before-swap", () => {
    const now = clock();
    carried = [...presses].map((press) => ({
      press,
      played: now - press.start,
      lifted: press.lift === null ? null : press.lift - press.start,
    }));
  });
  document.addEventListener("astro:after-swap", () => {
    const now = clock();
    const next = carried;
    carried = [];
    presses.clear();
    for (const { press, played, lifted } of next) {
      const twin = [...document.querySelectorAll<HTMLElement>("[data-ripple]")].find(
        (control) => keyOf(control) === press.key,
      );
      const layer = layerOf(twin);
      if (!twin || !layer) continue;
      const p: Press = {
        ...press,
        control: twin,
        start: now - played,
        lift: lifted === null ? null : now - played + lifted,
        waves: [],
      };
      presses.add(p);
      if (p.lift === null) twin.setAttribute(RIPPLE_PRESSED, "");
      draw(layer, p, now);
      settle(p);
    }
  });
}
