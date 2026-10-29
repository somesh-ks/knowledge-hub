/**
 * Writes what each swatch resolves to in the current theme (OKLCH and hex), and measures the WCAG
 * contrast of its pair. The colors are oklch in the tokens; a canvas turns any CSS color into the
 * sRGB bytes, and the OKLCH and the ratio are computed from those. It runs again when the theme
 * changes.
 */
export {};

const canvas = document.createElement("canvas");
canvas.width = 1;
canvas.height = 1;
const context = canvas.getContext("2d", { willReadFrequently: true });

type Rgba = [number, number, number, number];

function resolve(name: string): Rgba | null {
  if (!context) return null;
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  probe.style.transition = "none";
  document.body.append(probe);
  const css = getComputedStyle(probe).color;
  probe.remove();
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = "#000";
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return [r ?? 0, g ?? 0, b ?? 0, (a ?? 255) / 255];
}

const hex = ([r, g, b, a]: Rgba): string => {
  const part = (value: number) => Math.round(value).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}${a < 1 ? part(a * 255) : ""}`;
};

/** sRGB bytes to OKLCH (Ottosson's matrices), written as CSS writes it. */
function oklch([r, g, b, a]: Rgba): string {
  const [lr, lg, lb] = [r, g, b].map(channel) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const u = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const v = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.hypot(u, v);
  const hue = chroma < 0.002 ? 0 : (Math.atan2(v, u) * 180) / Math.PI;
  const alpha = a < 1 ? ` / ${Math.round(a * 100)}%` : "";
  return `oklch(${lightness.toFixed(2)} ${chroma.toFixed(3)} ${Math.round((hue + 360) % 360)}${alpha})`;
}

const grade = (ratio: number): string =>
  ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA large" : "";

const channel = (value: number): number => {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgba): number =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a: Rgba, b: Rgba): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
};

function measure(): void {
  for (const el of document.querySelectorAll<HTMLElement>("[data-resolve]")) {
    const rgba = resolve(el.dataset.resolve ?? "");
    const hexEl = el.parentElement?.querySelector<HTMLElement>("[data-hex]");
    if (rgba) {
      el.textContent = oklch(rgba);
      if (hexEl) hexEl.textContent = hex(rgba);
    }
  }
  for (const swatch of document.querySelectorAll<HTMLElement>(".guide-swatch")) {
    const out = swatch.querySelector<HTMLElement>("[data-contrast]");
    if (!out) continue;
    const fg = resolve(swatch.dataset.fg ?? "");
    const bg = resolve(swatch.dataset.bg ?? "");
    // A translucent role (a scrim) has no contrast of its own: it depends on what is under it.
    if (!fg || !bg || fg[3] < 1 || bg[3] < 1) {
      out.textContent = "translucent";
      continue;
    }
    const ratio = contrast(fg, bg);
    out.textContent = `${ratio.toFixed(1)}:1 ${grade(ratio)}`.trim();
  }
  for (const pair of document.querySelectorAll<HTMLElement>("[data-pair]")) {
    const fg = resolve(pair.dataset.fg ?? "");
    const bg = resolve(pair.dataset.bg ?? "");
    const out = pair.querySelector<HTMLElement>("[data-ratio]");
    if (!fg || !bg || !out) continue;
    const ratio = contrast(fg, bg);
    const min = Number(pair.dataset.min);
    out.textContent = `${ratio.toFixed(1)}:1 ${grade(ratio)}`.trim();
    out.dataset.pass = String(ratio >= min);
  }
}
// After the theme's color transition has finished, so a mid-fade value is not read.
const later = (): void => {
  setTimeout(measure, 300);
};
measure();
document.addEventListener("design:theme", later);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", later);
