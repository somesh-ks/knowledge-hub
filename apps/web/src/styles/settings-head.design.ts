import { defineSpec, esc, on, str } from "../lib/designSpec";

/** The top of a settings page: an optional "Settings /" crumb, the page's name and one quiet line. */
export default defineSpec({
  id: "settings-header",
  title: "Settings header",
  level: "molecule",
  category: "Navigation",
  summary:
    "A settings page's name at the display size, with the crumb that leads back up and one line on what the page is for.",
  frame: "wide",
  usage: [
    { sheet: "settings.css", selector: ".settings-crumb" },
    { sheet: "settings.css", selector: ".settings-head" },
  ],
  classes: ["settings-head", "settings-crumb", "settings-note"],
  guidance: [
    "A page reached from Settings has the crumb; Settings itself and the pages outside it do not, unless Settings links to them (Costs).",
    "The note is one quiet line in the label size. It is the same line a page uses for any note under its content.",
  ],
  controls: [
    { kind: "toggle", id: "crumb", label: "Crumb", group: "Content", value: true },
    { kind: "toggle", id: "note", label: "Note", group: "Content", value: true },
    {
      kind: "text",
      id: "title",
      label: "Title",
      group: "Content",
      value: "Interface sounds",
      max: 24,
    },
  ],
  demo: [{ crumb: true }, { crumb: false }, { note: false }],
  render: (state) => {
    const crumb = on(state.crumb)
      ? `<nav class="settings-crumb" aria-label="Breadcrumb"><a class="text-link" href="/settings">Settings</a><span aria-hidden="true"> /</span></nav>`
      : "";
    const note = on(state.note)
      ? `<p class="settings-note">The small sounds the app makes as you use it.</p>`
      : "";
    return `<header class="settings-head">${crumb}<h1 class="page-title">${esc(str(state.title, "Interface sounds"))}</h1>${note}</header>`;
  },
});
