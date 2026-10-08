import type { BrandColors } from "./brandColors";

/**
 * The web app manifest. PNG icons only: iOS ignores SVG and WebP icons. background_color matches the
 * body, the icon and the splash so there is no flash between them. Android reads theme_color;
 * iOS ignores most of this file and takes its values from the head tags and CSS.
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
  background_color: string;
  theme_color: string;
  icons: Array<{ src: string; sizes: string; type: "image/png"; purpose: "any" | "maskable" }>;
}

export function buildManifest(colors: BrandColors): WebManifest {
  return {
    id: "/",
    name: "Singularity",
    short_name: "Singularity",
    description: "A private tech and design engineering briefing, read or heard in minutes.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: colors.surfaceLight,
    theme_color: colors.surfaceLight,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
