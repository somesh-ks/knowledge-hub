import { defineSpec, esc, on, str } from "../lib/designSpec";

/** A source under its name: the site and how often it posts, as Suggested sources draw them. */
export default defineSpec({
  id: "source-line",
  title: "Source line",
  level: "molecule",
  category: "Lists",
  summary:
    "The quiet line under a source's name: its site, then how often it posts, split by a centred dot.",
  frame: "narrow",
  classes: ["source-meta", "source-host", "source-cadence"],
  guidance: [
    "The site and the cadence are two spans in one .source-meta. The dot between them is drawn by the class and only when the site has words.",
    "The site shows from 40rem; a phone shows the name alone, and a long site is cut with an ellipsis rather than wrapped.",
    "SourceRow.astro puts the readable address in this line instead (.source-url, topics.css), with the score at the row's end.",
  ],
  controls: [
    { kind: "toggle", id: "cadence", label: "Cadence", group: "Content", value: true },
    {
      kind: "text",
      id: "host",
      label: "Site",
      group: "Content",
      value: "studio-notes.example",
      max: 24,
    },
  ],
  render: (state) => {
    const cadence = on(state.cadence) ? `<span class="source-cadence">Daily</span>` : "";
    return `<span class="source-main"><span class="source-icon" aria-hidden="true"><span class="source-initial">S</span></span><span class="source-text"><span class="source-name">Studio Notes</span><span class="source-meta"><span class="source-host">${esc(str(state.host, "studio-notes.example"))}</span>${cadence}</span></span></span>`;
  },
});
