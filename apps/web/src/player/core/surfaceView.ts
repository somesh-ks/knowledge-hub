/**
 * The surface controller's hands in the document. It finds the player's elements by data
 * attribute and never trusts a node it found earlier without checking it is still attached, so a
 * navigation or a remount cannot leave the controller writing to elements nobody can see.
 *
 * Every per-frame write is one registered, non-inherited custom property, `--p`, on the three
 * elements that move. The stylesheet turns it into travel, fade and the cover's flight, so no pixel
 * height is ever cached here and a resize needs no code. The flight's two ends are the one thing
 * measured, once per motion, as it leaves rest.
 */
import {
  type CoverMorph,
  computeMorph,
  MORPH_PROPERTIES,
  morphStyle,
  restingBox,
} from "./coverMorph";
import { createModalScope } from "./modalScope";
import type { SurfaceSnapshot, SurfaceView } from "./sheetController";

interface Parts {
  root: HTMLElement;
  stage: HTMLElement;
  page: HTMLElement;
  dock: HTMLElement;
  /** The flying cover. */
  art: HTMLElement;
  /** Where the cover rests on the bar, and where it rests on the page. */
  thumb: HTMLElement;
  slot: HTMLElement;
  opener: HTMLElement;
}

const PART_SELECTORS: Record<Exclude<keyof Parts, "root">, string> = {
  stage: "[data-player-stage]",
  page: "[data-player-page]",
  dock: "[data-player-dock]",
  art: "[data-player-art]",
  thumb: "[data-player-thumb]",
  slot: "[data-player-cover]",
  opener: "[data-player-open]",
};

/** Where layout puts `element` inside `root`. Offsets leave out every transform on the way. */
function layoutOffset(element: HTMLElement, root: HTMLElement): { left: number; top: number } {
  let left = 0;
  let top = 0;
  for (let node: Element | null = element; node instanceof HTMLElement && node !== root; ) {
    left += node.offsetLeft;
    top += node.offsetTop;
    node = node.offsetParent;
  }
  return { left, top };
}

/**
 * The cover's flight: from the bar's thumbnail where it rests to the page's cover where the open
 * page shows it. Only where the stylesheet gives the flying cover a box (below 64rem, motion
 * allowed); elsewhere the bar and the page keep their own covers, and nothing is read.
 */
function flight({ root, page, dock, art, thumb, slot }: Parts): CoverMorph | null {
  if (art.getClientRects().length === 0) return null;
  return computeMorph(
    restingBox(
      thumb.getBoundingClientRect(),
      dock.getBoundingClientRect(),
      layoutOffset(dock, root),
    ),
    restingBox(
      slot.getBoundingClientRect(),
      page.getBoundingClientRect(),
      layoutOffset(page, root),
    ),
  );
}

export function createSurfaceView(): SurfaceView {
  const scope = createModalScope(() => document);
  let cached: Parts | null = null;
  /** The shell's bottom navigation, if the page has one. It slides away as the page comes up. */
  let nav: HTMLElement | null = null;

  function parts(): Parts | null {
    if (cached && Object.values(cached).every((element) => element.isConnected)) return cached;
    cached = null;
    const root = document.querySelector<HTMLElement>("[data-player-surface]");
    if (!root) return null;
    const found: Partial<Parts> = { root };
    for (const [name, selector] of Object.entries(PART_SELECTORS)) {
      const element = root.querySelector<HTMLElement>(selector);
      if (!element) return null;
      found[name as keyof Parts] = element;
    }
    cached = found as Parts;
    return cached;
  }

  function currentNav(): HTMLElement | null {
    return nav?.isConnected ? nav : null;
  }

  return {
    isPresent: () => parts() !== null,
    measure() {
      const found = parts();
      if (!found) return { distance: 0, morph: null };
      nav = document.querySelector<HTMLElement>("[data-bottom-nav]");
      return {
        // The page travels from the bar's top edge to the stage's: the same length the
        // stylesheet computes, read from layout so neither side holds a breakpoint.
        distance: found.dock.offsetTop - found.stage.offsetTop,
        morph: flight(found),
      };
    },
    setMorph(morph) {
      const art = parts()?.art;
      if (!art) return;
      for (const name of MORPH_PROPERTIES) art.style.removeProperty(name);
      if (!morph) return;
      for (const [name, value] of Object.entries(morphStyle(morph))) {
        art.style.setProperty(name, value);
      }
    },
    render(p) {
      const found = parts();
      if (!found) return;
      const value = p.toFixed(4);
      found.page.style.setProperty("--p", value);
      found.dock.style.setProperty("--p", value);
      found.art.style.setProperty("--p", value);
      currentNav()?.style.setProperty("--player-p", value);
    },
    apply({ state, open, landed }: SurfaceSnapshot) {
      const found = parts();
      if (!found) return;
      found.root.dataset.state = state;
      found.root.dataset.open = String(open);
      found.root.toggleAttribute("data-landed", landed);
      // Inert only at rest: a page on its way down still has to take the tap that calls it back.
      found.page.inert = state === "collapsed";
      found.opener.setAttribute("aria-expanded", String(open));
    },
    rest(state) {
      const found = parts();
      if (!found) return;
      // At rest the stylesheet's own rules hold the value, so no inline style outlives a motion.
      for (const element of [found.page, found.dock, found.art]) {
        element.style.removeProperty("--p");
      }
      for (const name of MORPH_PROPERTIES) found.art.style.removeProperty(name);
      if (state === "expanded") {
        currentNav()?.style.setProperty("--player-p", "1");
        return;
      }
      currentNav()?.style.removeProperty("--player-p");
      nav = null;
      // The next open starts at the top.
      found.page.scrollTop = 0;
    },
    enterModal(onEscape) {
      const found = parts();
      if (found) scope.enter({ surface: found.root, page: found.page }, onEscape);
    },
    leaveModal() {
      const found = parts();
      scope.leave({
        surface: found?.root ?? null,
        page: found?.page ?? null,
        focusTo: found?.opener ?? null,
      });
      // The control that was pressed to close (the bar's chevron) hides with the page, so focus
      // falls to the body a moment later: it goes to the bar's open control, so the next Tab
      // starts from the bar. Watched for a short while, as the hiding follows the page's close.
      const opener = found?.opener;
      const pressed = document.activeElement;
      if (opener && pressed && pressed !== document.body && pressed !== opener) {
        let frames = 0;
        const watch = (): void => {
          const active = document.activeElement;
          if (!active || active === document.body) {
            opener.focus({ preventScroll: true });
            return;
          }
          frames += 1;
          if (active !== pressed || frames > 40) return;
          requestAnimationFrame(watch);
        };
        requestAnimationFrame(watch);
      }
    },
    capturePointer(pointerId) {
      try {
        parts()?.root.setPointerCapture(pointerId);
      } catch {
        // The pointer is already gone; its end event is on the way.
      }
    },
    releasePointer(pointerId) {
      const root = parts()?.root;
      if (root?.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId);
    },
    scrollTop: () => parts()?.page.scrollTop ?? 0,
    scrollTo(top) {
      const page = parts()?.page;
      if (page) page.scrollTop = top;
    },
  };
}
