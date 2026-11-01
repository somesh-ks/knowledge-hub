import { restyleHex } from "@singularity/cover/style";

/**
 * The ambient light follows the style and a reader's hue (D311). The page carries the month's own
 * tints for both themes (`data-ambient`: light a, b, c, then dark a, b, c) and the month's hue
 * centre; this moves their hue and chroma by the style's rule, the same formula the covers use, and
 * leaves their lightness, which the page tuned to each theme. Default leaves them as they are.
 */

const SLOTS = ["a", "b", "c"] as const;

function apply(host: HTMLElement): void {
  const tints = (host.dataset.ambient ?? "").split(",");
  const centre = Number(host.dataset.ambientCentre ?? 0);
  const root = document.documentElement;
  const shift = Number.parseFloat(getComputedStyle(root).getPropertyValue("--hue-shift")) || 0;
  tints.forEach((hex, index) => {
    const dark = index >= SLOTS.length;
    const slot = SLOTS[index % SLOTS.length];
    host.style.setProperty(
      `--ambient-${slot}-${dark ? "d" : "l"}`,
      restyleHex(root.dataset.style, hex, centre, dark ? "dark" : "light", shift),
    );
  });
}

let watching: MutationObserver | undefined;

/** Recolours the light now and whenever the style or the hue changes. */
export function watchAmbientStyle(host: HTMLElement): void {
  watching?.disconnect();
  apply(host);
  watching = new MutationObserver(() => apply(host));
  watching.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-style", "style"],
  });
}
