import { defineSpec, esc, str } from "../lib/designSpec";

/** The ringed dot and the app's name, as BrandMark.astro draws it. */
const MARK = `<svg class="wordmark-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path fill-rule="evenodd" d="M12 1.25a10.75 10.75 0 1 0 0 21.5 10.75 10.75 0 0 0 0-21.5Zm0 2.5a8.25 8.25 0 1 1 0 16.5 8.25 8.25 0 0 1 0-16.5Z"></path><circle cx="12" cy="12" r="4.5"></circle></svg>`;

/** The app's mark and name, the link home in the top bar and the side column. */
export default defineSpec({
  id: "wordmark",
  title: "Wordmark",
  level: "atom",
  category: "Navigation",
  summary: "The ringed dot in the accent and the app's name, a link to Latest.",
  classes: ["wordmark", "wordmark-mark"],
  guidance: [
    "The top bar centres it below 64rem; from 64rem the side column carries it at its top.",
    "A press scales the mark, never the name beside it.",
  ],
  controls: [
    { kind: "text", id: "name", label: "Name", group: "Content", value: "Singularity", max: 16 },
  ],
  render: (state) =>
    `<a class="wordmark" href="/" aria-label="Singularity, latest podcast">${MARK}<span>${esc(str(state.name, "Singularity"))}</span></a>`,
});
