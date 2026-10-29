/**
 * The cards' hover: while a card is hovered or focused its drawing steps through the component's
 * states (the spec's demo, or its first control's options), and it settles back when the pointer
 * leaves. Nodes are edited in place so the part's own transitions play. With reduced motion a card
 * jumps to its first step and stays there, instead of cycling.
 */
import { defaultState, demoStates } from "../../../web/src/lib/designSpec";
import { designSpecById } from "../../../web/src/lib/designSpecs";
import { morph } from "../lib/morph";

const STEP_MS = 1100;
/** The room a drawing keeps from its tile's edge, in px. */
const TILE_MARGIN = 16;
/** Never smaller than this: below it the words are not words. */
const MIN_SCALE = 0.3;

/** Scales each drawing down, never up, until the whole part fits its tile. */
function fit(): void {
  for (const art of document.querySelectorAll<HTMLElement>(".guide-card-art")) {
    const tile = art.parentElement;
    if (!tile) continue;
    art.style.setProperty("--thumb-scale", "1");
    const width = art.offsetWidth;
    const height = art.offsetHeight;
    if (!width || !height) continue;
    const scale = Math.min(
      1,
      (tile.clientWidth - TILE_MARGIN * 2) / width,
      (tile.clientHeight - TILE_MARGIN) / height,
    );
    art.style.setProperty("--thumb-scale", String(Math.max(MIN_SCALE, scale).toFixed(3)));
  }
}
fit();
document.fonts?.ready.then(fit);
let resizing: ReturnType<typeof setTimeout> | undefined;
addEventListener("resize", () => {
  clearTimeout(resizing);
  resizing = setTimeout(fit, 120);
});
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

for (const card of document.querySelectorAll<HTMLElement>("[data-card]")) {
  const thumb = card.querySelector<HTMLElement>("[data-thumb]");
  const spec = thumb ? designSpecById(thumb.dataset.thumb ?? "") : undefined;
  if (!thumb || !spec) continue;
  const rest = defaultState(spec.controls);
  const states = demoStates(spec);
  if (states.length < 2) continue;
  let timer: ReturnType<typeof setInterval> | undefined;
  let step = 0;

  const show = (index: number): void => {
    step = index % states.length;
    morph(thumb, spec.render(states[step] ?? rest));
  };
  const start = (): void => {
    if (timer) return;
    show(0);
    if (!reduced.matches) timer = setInterval(() => show(step + 1), STEP_MS);
  };
  const stop = (): void => {
    clearInterval(timer);
    timer = undefined;
    morph(thumb, spec.render(rest));
  };

  card.addEventListener("pointerenter", start);
  card.addEventListener("pointerleave", stop);
  card.addEventListener("focusin", start);
  card.addEventListener("focusout", stop);
}
