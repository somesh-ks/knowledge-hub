import { defineSpec, icon, on } from "../lib/designSpec";

const MARK = `<svg class="wordmark-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path fill-rule="evenodd" d="M12 1.25a10.75 10.75 0 1 0 0 21.5 10.75 10.75 0 0 0 0-21.5Zm0 2.5a8.25 8.25 0 1 1 0 16.5 8.25 8.25 0 0 1 0-16.5Z"></path><circle cx="12" cy="12" r="4.5"></circle></svg>`;

/** The top app bar (SiteHeader.astro): the wordmark in the middle, and Back on a page one level down. */
export default defineSpec({
  id: "app-bar",
  title: "App bar",
  level: "organism",
  category: "Navigation",
  summary:
    "The bar across the top of a phone page: the wordmark in the middle, Back at the edge on a page one level down.",
  frame: "stack",
  classes: ["app-bar", "app-bar-inner", "app-bar-back"],
  guidance: [
    "Shown below 64rem only. From 64rem the side navigation carries the wordmark and the bar is not drawn at all.",
    "It slides away on a scroll down and returns on a scroll up. A hairline appears under it once the page has scrolled.",
    "Back sits out of the flow at the leading edge, so the wordmark stays centred and a page without it does not shift.",
  ],
  controls: [{ kind: "toggle", id: "back", label: "Back", group: "Content", value: false }],
  // The guide draws the bar in its frame at every width: the inline style keeps it from sticking to
  // the window and from hiding at 64rem.
  render: (state) =>
    `<header class="app-bar" style="position: relative; display: block"><div class="app-bar-inner page">${
      on(state.back)
        ? `<a class="icon-btn app-bar-back" href="#app-bar" aria-label="Back" data-back>${icon("arrowBack")}</a>`
        : ""
    }<a class="wordmark" href="/" aria-label="Singularity, latest podcast">${MARK}<span>Singularity</span></a></div></header>`,
});
