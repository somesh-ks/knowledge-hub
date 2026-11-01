/**
 * Keeps the browser's own chrome (the address bar, the task switcher card) in the page's colour.
 * The layout ships one theme-color per system scheme, which is right while the theme follows the
 * system. Once the reader picks Light or Dark by hand, both entries must carry that one colour, or a
 * dark page sits under a light address bar. A style with its own surface (Halloween, D306) is read
 * from the page itself, so the bar follows it.
 */

export interface ThemeColors {
  light: string;
  dark: string;
}

/** What each scheme's entry should hold for a theme choice. Anything but light or dark follows the system. */
export function themeColorsFor(
  theme: string | null | undefined,
  system: ThemeColors,
  /** The page's own surface when a style is on: the layout ships the Default style's colours only. */
  styled?: string | null,
): ThemeColors {
  if (styled) return { light: styled, dark: styled };
  if (theme === "light") return { light: system.light, dark: system.light };
  if (theme === "dark") return { light: system.dark, dark: system.dark };
  return system;
}

function meta(scheme: "light" | "dark"): HTMLMetaElement | null {
  return document.querySelector<HTMLMetaElement>(
    `meta[name="theme-color"][media="(prefers-color-scheme: ${scheme})"]`,
  );
}

/** The page surface as the sRGB hex a theme-color meta takes, or null when the browser cannot convert it. */
function surfaceHex(): string | null {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--color-surface").trim();
  if (!raw) return null;
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const unset = "#010203";
  ctx.fillStyle = unset;
  ctx.fillStyle = raw;
  // A colour the canvas cannot parse leaves the fill as it was.
  if (ctx.fillStyle === unset) return null;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function installThemeColor(): void {
  const light = meta("light")?.content;
  const dark = meta("dark")?.content;
  if (!light || !dark) return;
  const system: ThemeColors = { light, dark };

  const apply = (): void => {
    const styled = document.documentElement.dataset.style ? surfaceHex() : null;
    const next = themeColorsFor(document.documentElement.dataset.theme, system, styled);
    const lightMeta = meta("light");
    const darkMeta = meta("dark");
    if (lightMeta && lightMeta.content !== next.light) lightMeta.content = next.light;
    if (darkMeta && darkMeta.content !== next.dark) darkMeta.content = next.dark;
  };

  apply();
  // The theme and the style live in attributes on the root; the settings page and the player write them.
  new MutationObserver(apply).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-style"],
  });
  // A styled page in the system theme changes colour when the system does.
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", apply);
  // A navigation brings the next page's head, with the two system entries again.
  document.addEventListener("astro:after-swap", apply);
}
