/**
 * One icon set, Lucide-style: 24px grid, 2px round strokes, currentColor. Decorative by default
 * (aria-hidden); the button that holds an icon carries the accessible name.
 */

export type IconName =
  | "play"
  | "pause"
  | "skipBack"
  | "skipForward"
  | "back15"
  | "forward15"
  | "chevronDown"
  | "chevronRight"
  | "chevronLeft"
  | "close"
  | "sliders"
  | "refresh"
  | "check"
  | "alert"
  | "wifiOff"
  | "info"
  | "share"
  | "clock";

const SOLID: ReadonlySet<IconName> = new Set(["play", "pause", "skipBack", "skipForward"]);

const PATHS: Record<IconName, string> = {
  play: '<polygon points="7 4 20 12 7 20 7 4"/>',
  pause:
    '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  skipBack: '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" x2="5" y1="19" y2="5"/>',
  skipForward: '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>',
  back15:
    '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><text x="12" y="15.2" text-anchor="middle" class="skip-label" fill="currentColor" stroke="none">15</text>',
  forward15:
    '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><text x="12" y="15.2" text-anchor="middle" class="skip-label" fill="currentColor" stroke="none">15</text>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  sliders:
    '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  refresh:
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  wifiOff:
    '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  share:
    '<path d="M12 2v13"/><path d="m16 6-4-4-4 4"/><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
};

export function icon(name: IconName, className = ""): string {
  const classes = ["icon", SOLID.has(name) ? "icon-solid" : "", className]
    .filter(Boolean)
    .join(" ");
  return `<svg class="${classes}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}

/** Two stacked icons that swap with a short scale, fade and blur, keyed on the button's data-playing. */
export function playPauseIcons(className = ""): string {
  return `<span class="swap">${icon("play", `${className} swap-paused`.trim())}${icon("pause", `${className} swap-playing`.trim())}</span>`;
}

/** The brand mark: the rail with its current node. Also the source for the app icon. */
export const MARK_SVG =
  '<svg class="wordmark-mark" viewBox="0 0 16 24" aria-hidden="true" focusable="false"><rect x="7" y="0" width="2" height="24" rx="1" fill="currentColor" opacity="0.28"/><rect x="7" y="0" width="2" height="12" rx="1" fill="currentColor"/><circle cx="8" cy="12" r="5" fill="currentColor"/></svg>';
