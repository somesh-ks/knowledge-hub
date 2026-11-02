/**
 * The profile page's one script: the avatar picker. It offers the shapes the current mood has
 * (--av-shapes, so a new mood needs no change here), marks the one in use, and stores a pick in the
 * preferences. The avatar in the bar and on this page redraw from the same store (accountAvatar.ts).
 */
import { AVATAR_SHAPES, avatarClass, avatarMarkup } from "../design-system/avatar";
import { getPreferences } from "../player/core/preferences";
import { currentShape, offeredShapes } from "./accountAvatar";

const PICKER = "[data-avatar-picker]";

function draw(picker: HTMLElement): void {
  const current = currentShape();
  picker.replaceChildren(
    ...offeredShapes().map((id) => {
      const shape = AVATAR_SHAPES[id];
      const choice = document.createElement("button");
      choice.type = "button";
      choice.className = "profile-shape";
      choice.dataset.shape = id;
      choice.setAttribute("aria-label", shape?.name ?? id);
      choice.setAttribute("aria-pressed", String(id === current));
      // A span, not a second button: the picker's button is the control.
      const face = document.createElement("span");
      face.className = avatarClass("lg");
      if (shape?.tone) face.dataset.tone = shape.tone;
      face.innerHTML = avatarMarkup(id);
      choice.append(face);
      return choice;
    }),
  );
}

export function installProfilePage(): void {
  const picker = document.querySelector<HTMLElement>(PICKER);
  if (!picker) return;
  draw(picker);
  picker.addEventListener("click", (event) => {
    const choice = (event.target as Element).closest<HTMLElement>("[data-shape]");
    if (choice?.dataset.shape) getPreferences().set({ avatar: choice.dataset.shape });
  });
  // A pick, or a new mood (it has its own shapes), draws the row again.
  const stop = getPreferences().subscribe(() => draw(picker));
  const moodWatch = new MutationObserver(() => draw(picker));
  moodWatch.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-style"],
  });
  document.addEventListener(
    "astro:before-swap",
    () => {
      stop();
      moodWatch.disconnect();
    },
    { once: true },
  );
}
