import { defineSpec, icon, str } from "../lib/designSpec";

const MARK = `<svg class="wordmark-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path fill-rule="evenodd" d="M12 1.25a10.75 10.75 0 1 0 0 21.5 10.75 10.75 0 0 0 0-21.5Zm0 2.5a8.25 8.25 0 1 1 0 16.5 8.25 8.25 0 0 1 0-16.5Z"></path><circle cx="12" cy="12" r="4.5"></circle></svg>`;

const DESTINATIONS = [
  { id: "latest", href: "/", label: "Latest", rest: "lightning", current: "lightningFill" },
  { id: "library", href: "/library", label: "Library", rest: "library", current: "libraryFill" },
  {
    id: "settings",
    href: "/settings",
    label: "Settings",
    rest: "settings",
    current: "settingsFill",
  },
] as const;

/** The primary navigation (AppNav.astro): a bottom bar below 64rem, a side column from 64rem. */
export default defineSpec({
  id: "app-nav",
  title: "App navigation",
  level: "organism",
  category: "Navigation",
  summary:
    "The primary navigation: Latest, Library and Settings in a bar at the foot of a phone, in a column beside the page from 64rem.",
  frame: "stack",
  classes: [
    "app-nav",
    "app-nav-brand",
    "app-nav-create",
    "app-nav-list",
    "app-nav-item",
    "app-nav-indicator",
    "app-nav-icon-rest",
    "app-nav-icon-current",
    "app-nav-updated",
  ],
  guidance: [
    "One navigation in two shapes. Below 64rem it is a tonal bar with a pill behind the current icon; from 64rem it is a column whose current row is the pill. The guide shows the shape the window gives it.",
    "The current destination takes the filled glyph, the full ink and the accent container. Its words keep the same weight as the others.",
    "Catch up is the one action, not a destination: a tonal button at the top of the column. Below 64rem it is a floating button instead (CreateFab), so the bar does not draw it.",
  ],
  controls: [
    {
      kind: "choice",
      id: "current",
      label: "Current",
      group: "State",
      value: "latest",
      options: [
        { value: "latest", label: "Latest" },
        { value: "library", label: "Library" },
        { value: "settings", label: "Settings" },
        { value: "create", label: "Catch up" },
        { value: "none", label: "None" },
      ],
    },
  ],
  demo: [{ current: "latest" }, { current: "library" }, { current: "settings" }],
  // The guide's own navigation is already fixed to the window, so this one is held in a box: a
  // transformed parent is the containing block of a fixed child.
  render: (state) => {
    const current = str(state.current, "latest");
    const items = DESTINATIONS.map(
      (destination) =>
        `<li><a class="app-nav-item" href="${destination.href}"${current === destination.id ? ' aria-current="page"' : ""}><span class="app-nav-indicator">${icon(destination.rest, "icon-lg app-nav-icon-rest")}${icon(destination.current, "icon-lg app-nav-icon-current")}</span><span>${destination.label}</span></a></li>`,
    ).join("");
    return `<div style="position: relative; transform: translate(0); block-size: 24rem; overflow: hidden"><nav class="app-nav" aria-label="Primary" data-bottom-nav><a class="app-nav-brand wordmark" href="/" aria-label="Singularity, latest podcast">${MARK}<span>Singularity</span></a><a class="app-nav-create btn-action-tonal" href="/create"${current === "create" ? ' aria-current="page"' : ""}>${icon("plus", "icon-lg")}<span>Catch up</span></a><ul class="app-nav-list" role="list">${items}</ul><p class="app-nav-updated">Updated 29 October 2026</p></nav></div>`;
  },
});
