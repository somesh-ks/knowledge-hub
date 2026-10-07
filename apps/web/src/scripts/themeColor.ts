/**
 * Keeps the browser's own chrome (the address bar, the task switcher card) in the page's colour.
 * The layout ships one theme-color per system scheme, which is right while the theme follows the
 * system. Once the reader picks Light or Dark by hand, both entries must carry that one colour, or a
 * dark page sits under a light address bar.
 */

export interface ThemeColors {
  light: string;
  dark: string;
}

/** What each scheme's entry should hold for a theme choice. Anything but light or dark follows the system. */
export function themeColorsFor(theme: string | null | undefined, system: ThemeColors): ThemeColors {
  if (theme === "light") return { light: system.light, dark: system.light };
  if (theme === "dark") return { light: system.dark, dark: system.dark };
  return system;
}

function meta(scheme: "light" | "dark"): HTMLMetaElement | null {
  return document.querySelector<HTMLMetaElement>(
    `meta[name="theme-color"][media="(prefers-color-scheme: ${scheme})"]`,
  );
}

export function installThemeColor(): void {
  const light = meta("light")?.content;
  const dark = meta("dark")?.content;
  if (!light || !dark) return;
  const system: ThemeColors = { light, dark };

  const apply = (): void => {
    const next = themeColorsFor(document.documentElement.dataset.theme, system);
    const lightMeta = meta("light");
    const darkMeta = meta("dark");
    if (lightMeta && lightMeta.content !== next.light) lightMeta.content = next.light;
    if (darkMeta && darkMeta.content !== next.dark) darkMeta.content = next.dark;
  };

  apply();
  // The theme lives in one attribute on the root; the settings page and the player both write it.
  new MutationObserver(apply).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  // A navigation brings the next page's head, with the two system entries again.
  document.addEventListener("astro:after-swap", apply);
}
