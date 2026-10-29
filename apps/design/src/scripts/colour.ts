/**
 * Writes what each swatch resolves to in the current theme, and measures the contrast of the pairs.
 * The colours are oklch in the tokens; a canvas turns any CSS colour into the sRGB bytes a person
 * can compare, and the WCAG ratio is computed from those. It runs again when the theme changes.
 */
import "./themeChoice";

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
    if (rgba) el.textContent = hex(rgba);
  }
  for (const pair of document.querySelectorAll<HTMLElement>("[data-pair]")) {
    const fg = resolve(pair.dataset.fg ?? "");
    const bg = resolve(pair.dataset.bg ?? "");
    const out = pair.querySelector<HTMLElement>("[data-ratio]");
    if (!fg || !bg || !out) continue;
    const ratio = contrast(fg, bg);
    const min = Number(pair.dataset.min);
    out.textContent = `${ratio.toFixed(1)}:1`;
    out.dataset.pass = String(ratio >= min);
  }
}

// After the theme's colour transition has finished, so a mid-fade value is not read.
const later = (): void => {
  setTimeout(measure, 300);
};
measure();
document.addEventListener("design:theme", later);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", later);
