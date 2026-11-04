/**
 * The profile page's one script: the avatar picker, a bottom sheet opened by the edit button on the
 * avatar. It offers the shapes the current mood has (--av-shapes, so a new mood needs no change
 * here), marks the one in use, and stores a pick in the preferences. The avatar in the bar and on
 * this page redraw from the same store (accountAvatar.ts).
 */
import { AVATAR_SHAPES, avatarClass, avatarMarkup } from "../design-system/avatar";
import { getPreferences } from "../player/core/preferences";
import { currentShape, offeredShapes } from "./accountAvatar";

// The sheet itself is the menu's (pull to dismiss, Close and focus back are heroMenu.ts).
const PICKER = "[data-avatar-picker]";
const EDIT = "[data-avatar-edit]";
const PANEL = "[data-avatar-panel]";

/** Draws the picker. The buttons are built once per set of offered shapes, so a pick (or a volume
 * write) only moves aria-pressed and keyboard focus stays on the button that was pressed. */
function draw(picker: HTMLElement): void {
  const current = currentShape();
  const ids = offeredShapes();
  const same =
    picker.children.length === ids.length &&
    ids.every((id, at) => (picker.children[at] as HTMLElement).dataset.shape === id);
  if (same) {
    for (const choice of picker.children) {
      choice.setAttribute(
        "aria-pressed",
        String((choice as HTMLElement).dataset.shape === current),
      );
    }
    return;
  }
  picker.replaceChildren(
    ...ids.map((id) => {
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

function mount(picker: HTMLElement): () => void {
  draw(picker);
  const edit = document.querySelector<HTMLElement>(EDIT);
  const panel = document.querySelector<HTMLElement>(PANEL);
  // A pick is a single choice, like a select's: it sets the avatar and the sheet closes.
  const onClick = (event: Event): void => {
    const choice = (event.target as Element).closest<HTMLElement>("[data-shape]");
    if (!choice?.dataset.shape) return;
    getPreferences().set({ avatar: choice.dataset.shape });
    panel?.hidePopover();
  };
  picker.addEventListener("click", onClick);
  // The edit button says whether its sheet is open; an open sheet starts on the shape in use.
  const onToggle = (event: Event): void => {
    const open = (event as ToggleEvent).newState === "open";
    edit?.setAttribute("aria-expanded", String(open));
    if (open) picker.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
  };
  panel?.addEventListener("toggle", onToggle);
  // A new mood has its own shapes: the row is drawn again.
  const stop = getPreferences().subscribe(() => draw(picker));
  const moodWatch = new MutationObserver(() => draw(picker));
  moodWatch.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-mood"],
  });
  return () => {
    picker.removeEventListener("click", onClick);
    panel?.removeEventListener("toggle", onToggle);
    stop();
    moodWatch.disconnect();
  };
}

let installed = false;

/**
 * Call once from the page's script. A bundled module script runs once per session, and the profile
 * can arrive by a client-side navigation, so the picker follows the router like the Settings pages:
 * mount on astro:page-load, unmount before the page is swapped away.
 */
export function installProfilePage(): void {
  if (installed) return;
  installed = true;
  // The sheet is the menu's popover: its pull to dismiss, Close and focus back come from here.
  void import("./heroMenu").then((module) => module.installHeroMenu());
  let mounted: { picker: HTMLElement; stop: () => void } | null = null;

  const unmount = (): void => {
    mounted?.stop();
    mounted = null;
  };

  const sync = (): void => {
    const picker = document.querySelector<HTMLElement>(PICKER);
    if (mounted && mounted.picker === picker) return;
    unmount();
    if (picker) mounted = { picker, stop: mount(picker) };
  };

  document.addEventListener("astro:page-load", sync);
  document.addEventListener("astro:before-swap", unmount);
  // On a full load the event waits for every resource. The markup is already here, so start now.
  sync();
}
