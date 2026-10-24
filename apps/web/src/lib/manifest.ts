/**
 * The web app manifest. PNG icons only: iOS ignores SVG and WebP icons.
 *
 * No theme_color and no background_color, on purpose. An installed Android app reads both once, at
 * install, and keeps them: Chrome paints the system navigation bar and the status bar in
 * theme_color (WebAppNavigationBarThemeColor) and the launch splash in background_color, whatever
 * theme the page shows later, and it stopped reading per-scheme colours from the manifest in
 * Chrome 128. A light one gave a white bar that hid the light navigation buttons in dark mode
 * (2026-10-16). Without them Android draws its own bars and splash in the system's light or dark
 * theme. The page's theme-color meta still colours the browser's own chrome.
 */
export interface WebManifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: "standalone";
  orientation: "any";
  shortcuts: Array<{
    name: string;
    short_name: string;
    url: string;
    icons: Array<{ src: string; sizes: string; type: "image/png" }>;
  }>;
  launch_handler: { client_mode: string[] };
  icons: Array<{ src: string; sizes: string; type: "image/png"; purpose: "any" | "maskable" }>;
}

export function buildManifest(): WebManifest {
  return {
    id: "/",
    name: "Singularity",
    short_name: "Singularity",
    description: "A private tech and design engineering briefing, read or heard in minutes.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    // Long-press on the Android icon. The 192px icon is reused: a shortcut gets no icon of its own.
    shortcuts: [
      { name: "Latest briefing", short_name: "Latest", url: "/" },
      { name: "Library", short_name: "Library", url: "/library" },
      { name: "Catch up", short_name: "Catch up", url: "/create" },
    ].map((shortcut) => ({
      ...shortcut,
      icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" as const }],
    })),
    // A link or shortcut opened while the app is running goes to its window instead of a second one.
    launch_handler: { client_mode: ["focus-existing", "auto"] },
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
