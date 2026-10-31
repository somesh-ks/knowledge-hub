/**
 * The Wheel: a column of values that turns under a fixed band, as a phone's time picker does. It is
 * the list inside a bottom sheet (selectSheet.ts draws the sheet around it) for a short run of values
 * a person is likelier to spin than to read: the hours of a day. The one place its classes are
 * written; the style guide lists WHEEL. The rules are in styles/wheel.css.
 *
 * It is a scroll-snap list. Each row's distance from the band, in rows, is set on it as `--wheel-d`
 * as the list scrolls, and the stylesheet turns that distance into a tilt and a fade, so the rows
 * curve away from the band like a drum. When the row under the band changes, `wheeldetent` fires on
 * the list, at most once a frame: the hook a haptic or a sound listens to (none is drawn here; the
 * cue pipeline maps it). The
 * wheel holds no value of its own: whoever mounts it reads `at()` when the person confirms.
 */
import type { Guidance } from "./guidance";

export const WHEEL: Guidance = {
  summary:
    "A column of values that turns under a fixed band and snaps to a row: a person spins to a value and the band holds it.",
  useWhen: [
    "A person sets a value from a short ordered run that they are likelier to spin to than to read: the hour a podcast is made.",
    "It opens in a bottom sheet from a Select (data-wheel) on a phone.",
  ],
  dontUseWhen: [
    {
      when: "The values are names with no order, or more than a few dozen.",
      instead: "Select",
    },
    {
      when: "The person must compare every value at a glance.",
      instead: "Select",
    },
  ],
};

/** Every class the Wheel draws, for the registry and its test. */
export const WHEEL_CLASSES: string[] = ["wheel-frame", "wheel-list", "wheel-option"];

/** Classes the Wheel replaced; none, as it is new. */
export const WHEEL_RETIRED: string[] = [];

export const wheelFrameClass = (): string => "wheel-frame";
export const wheelListClass = (): string => "wheel-list";
export const wheelOptionClass = (): string => "wheel-option";

/** A row of the wheel: `index` is its place in the select it stands for. */
export interface WheelRow {
  index: number;
  text: string;
  disabled: boolean;
}

/**
 * The hook a haptic listens to: fired on the list once per animation frame in which the row under
 * the band changed. A fast fling can cross several rows in a frame; the cue pipeline rate-limits.
 */
export const WHEEL_DETENT = "wheeldetent";

export interface Wheel {
  /** The row under the band, or the one the wheel is turning to. */
  at(): number;
  /** Turns to a row. `smooth` glides; otherwise the wheel is there at once. */
  to(place: number, smooth?: boolean): void;
}

/** The frame and list for a set of rows; the caller puts it in the sheet, then mounts it. */
export function wheelHtml(
  rows: WheelRow[],
  id: string,
  label: string,
  encode: (text: string) => string,
  /** Markup for the end of the frame, under the list (the sheet's Save). */
  after = "",
): string {
  const options = rows
    .map(
      (row, place) =>
        `<div class="${wheelOptionClass()}" role="option" id="${id}-${place}" data-index="${row.index}"` +
        `${row.disabled ? ' aria-disabled="true"' : ""}>${encode(row.text)}</div>`,
    )
    .join("");
  return (
    `<div class="${wheelFrameClass()}">` +
    `<div class="${wheelListClass()}" role="listbox" tabindex="0" aria-label="${encode(label)}">${options}</div>` +
    `${after}</div>`
  );
}

const still = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Brings a drawn wheel to life once it is on screen (its row height is read from the page). `first`
 * is the place to start on.
 */
export function mountWheel(list: HTMLElement, first: number): Wheel {
  const options = Array.from(list.querySelectorAll<HTMLElement>(`.${wheelOptionClass()}`));
  const last = options.length - 1;
  const height = (): number => options[0]?.offsetHeight || 1;
  const clamp = (place: number): number => Math.min(last, Math.max(0, place));
  const placeNow = (): number => clamp(Math.round(list.scrollTop / height()));
  // Where a tap or a key is turning the wheel to, until it gets there or a finger takes it over: a
  // Save pressed mid-glide means the row that was tapped, not the one the glide has reached.
  let heading: number | null = null;

  let frame = 0;
  let passing = -1;
  // The first paint places the wheel; it is not a row passing the band, so it fires no detent.
  let placed = false;

  const paint = (): void => {
    frame = 0;
    const at = list.scrollTop / height();
    options.forEach((option, place) => {
      option.style.setProperty("--wheel-d", (place - at).toFixed(3));
    });
    const now = placeNow();
    if (now !== passing) {
      passing = now;
      list.setAttribute("aria-activedescendant", options[now]?.id ?? "");
      if (placed) {
        list.dispatchEvent(
          new CustomEvent(WHEEL_DETENT, { bubbles: true, detail: { place: now } }),
        );
      }
    }
  };

  const rest = (): void => {
    heading = null;
    const now = placeNow();
    options.forEach((option, place) => {
      option.setAttribute("aria-selected", place === now ? "true" : "false");
    });
  };

  const to = (place: number, smooth = false): void => {
    heading = clamp(place);
    list.scrollTo({
      top: clamp(place) * height(),
      behavior: smooth && !still() ? "smooth" : "auto",
    });
  };

  // A wheel at rest marks the row it stopped on: `scrollend` where there is one, a pause in the scroll
  // where there is not (Safari before 26).
  let pause = 0;
  const reportsEnd = "onscrollend" in window;
  list.addEventListener(
    "scroll",
    () => {
      if (!frame) frame = requestAnimationFrame(paint);
      if (!reportsEnd) {
        clearTimeout(pause);
        pause = window.setTimeout(rest, 120);
      }
    },
    { passive: true },
  );
  if (reportsEnd) list.addEventListener("scrollend", rest);

  // A tap on a row turns the wheel to it.
  list.addEventListener("click", (event) => {
    const option = (event.target as Element).closest<HTMLElement>(`.${wheelOptionClass()}`);
    const place = option ? options.indexOf(option) : -1;
    if (place >= 0) to(place, true);
  });

  // The keys move one row (or a page of them, or to an end).
  list.addEventListener("keydown", (event) => {
    const step = Math.max(1, Math.floor(list.clientHeight / height()) - 1);
    // From where the wheel is heading, so keys pressed in a run each add a row.
    const now = heading ?? placeNow();
    const next =
      event.key === "ArrowDown"
        ? now + 1
        : event.key === "ArrowUp"
          ? now - 1
          : event.key === "PageDown"
            ? now + step
            : event.key === "PageUp"
              ? now - step
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? last
                  : null;
    if (next === null) return;
    event.preventDefault();
    to(next, true);
  });

  to(first);
  paint();
  placed = true;
  options.forEach((option, place) => {
    option.setAttribute("aria-selected", place === clamp(first) ? "true" : "false");
  });

  // A finger on the wheel is its own again.
  list.addEventListener(
    "touchstart",
    () => {
      heading = null;
    },
    { passive: true },
  );
  list.addEventListener("pointerdown", () => {
    heading = null;
  });
  // So is a mouse wheel or trackpad turn, which has no touch or press to say so.
  list.addEventListener(
    "wheel",
    () => {
      heading = null;
    },
    { passive: true },
  );

  return { at: () => heading ?? placeNow(), to };
}
