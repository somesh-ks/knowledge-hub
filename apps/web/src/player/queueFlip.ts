/**
 * Up next's reflow (owner, 2026-11-03: "when I add a suggested podcast into the queue, the transition
 * should be very smooth", and the same when it is removed). Every change to the list glides its rows
 * from where they stood to where they now are (a FLIP): a row queued from Suggested travels up into
 * the queue, the rows around it make room, a row taken off leaves as a fading copy while the rows
 * under it close the gap, and a new suggestion fades in. One curve for all of it, the spring that
 * settles without overshoot (tokens.css), as a dropped row already glides. Nothing moves with reduced
 * motion.
 *
 * The places are read the moment the queue changes, before the list redraws (the queue tells its
 * listeners synchronously; React draws after), or handed in by a drop, whose rows stand under the
 * finger rather than in the old order.
 */

/** A row of the queue or of Suggested, by its id; the Suggested label moves with them. */
const ROWS = ".player-queue-item[data-queue-id], .player-suggested-head";
const HEAD = "suggested-head";
const FLIP_ID = "queue-flip";

interface Place {
  top: number;
  left: number;
  width: number;
  node: HTMLElement;
}

/** Where each row stood, by key, in the window's coordinates, with the node itself. */
export type Places = Map<string, Place>;

function keyOf(row: HTMLElement): string {
  return row.dataset.queueId ?? HEAD;
}

function rowsIn(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(ROWS)];
}

/** Where every row stands now, mid-glide included: a glide that is overtaken starts from there. */
export function measure(root: ParentNode | null): Places {
  const places: Places = new Map();
  if (!root) return places;
  for (const row of rowsIn(root)) {
    const box = row.getBoundingClientRect();
    places.set(keyOf(row), { top: box.top, left: box.left, width: box.width, node: row });
  }
  return places;
}

function token(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * A duration token in milliseconds. The build writes "650ms" as ".65s", which read as a bare number
 * made every glide last 0.65 ms: the drop's glide too, before this file (2026-11-03).
 */
function ms(name: string): number {
  const raw = token(name, "0");
  const value = Number.parseFloat(raw) || 0;
  return raw.endsWith("ms") ? value : value * 1000;
}

/** Ends every glide under `root` at once, so a lift measures the rows where they really are. */
export function settleNow(root: ParentNode | null): void {
  if (!root) return;
  for (const row of rowsIn(root))
    for (const running of row.getAnimations()) if (running.id === FLIP_ID) running.finish();
}

/**
 * Glides the rows under `root` from `before` to where they are drawn now. A row that was not there
 * fades in; one that is gone leaves a fading copy in `ghosts` (an empty layer over the list).
 */
export function glide(root: HTMLElement | null, before: Places, ghosts?: HTMLElement | null): void {
  if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const duration = ms("--duration-spring-settle");
  const easing = token("--ease-spring-settle", "ease-out");
  const rows = rowsIn(root);
  // The glides under way stop first: their rows are measured where the list now puts them.
  for (const row of rows)
    for (const running of row.getAnimations()) if (running.id === FLIP_ID) running.cancel();
  const seen = new Set<string>();
  for (const row of rows) {
    const key = keyOf(row);
    seen.add(key);
    const was = before.get(key);
    if (!was) {
      // A suggestion that refills the list, never the whole list on its first draw.
      if (before.size === 0) continue;
      const enter = row.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: ms("--duration-enter"),
        easing: token("--ease-out", "ease-out"),
      });
      enter.id = FLIP_ID;
      continue;
    }
    const dy = was.top - row.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) continue;
    const move = row.animate([{ translate: `0 ${dy}px` }, { translate: "0 0" }], {
      duration,
      easing,
    });
    move.id = FLIP_ID;
    // A row only passes over the Suggested label, which moves the other way (player.css).
    if (row.matches(".player-queue-item")) {
      row.dataset.gliding = "";
      const done = (): void => {
        if (!row.getAnimations().some((running) => running.id === FLIP_ID && running !== move))
          delete row.dataset.gliding;
      };
      move.onfinish = done;
      move.oncancel = done;
    }
  }
  if (!ghosts) return;
  const layer = ghosts.getBoundingClientRect();
  for (const [key, was] of before) {
    if (seen.has(key) || was.node.isConnected) continue;
    // The row's own node, which React has let go of, stands where it stood and fades out.
    const ghost = was.node;
    // A copy to see, not a row: nothing finds it by its id or reaches it.
    for (const name of ["data-dragging", "data-queue-id", "aria-current"])
      ghost.removeAttribute(name);
    ghost.inert = true;
    Object.assign(ghost.style, {
      position: "absolute",
      top: `${was.top - layer.top}px`,
      left: `${was.left - layer.left}px`,
      width: `${was.width}px`,
      margin: "0",
      translate: "",
    });
    ghosts.append(ghost);
    const leave = ghost.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: ms("--duration-exit"),
      easing: token("--ease-out", "ease-out"),
      fill: "forwards",
    });
    leave.onfinish = () => ghost.remove();
    leave.oncancel = () => ghost.remove();
  }
}

/** The places read for the next draw, if a change is waiting for one. */
let pending: Places | null = null;

/**
 * Reads the rows' places for the next draw, unless they were read already for it. A drop hands in
 * its own rows' places, which stand under the finger and not in the list's order.
 */
export function capture(root: ParentNode | null, overrides?: Places): void {
  pending ??= measure(root);
  for (const [key, place] of overrides ?? []) pending.set(key, place);
}

/** Called once the list has redrawn: glides what changed since the last capture. */
export function play(root: HTMLElement | null, ghosts?: HTMLElement | null): void {
  const before = pending;
  pending = null;
  if (before) glide(root, before, ghosts);
}
