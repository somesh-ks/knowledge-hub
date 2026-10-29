import { defineSpec, esc, str } from "../lib/designSpec";

/** The link inside a line of small text (privacy.astro) and the crumb above a settings page (SettingsHead.astro). */
export default defineSpec({
  id: "text-link",
  title: "Text link",
  level: "atom",
  category: "Navigation",
  summary: "A link that stays inline in a line of small text and still has a 44px target.",
  frame: "narrow",
  usage: { sheet: "primitives.css", selector: ".text-link" },
  classes: ["text-link"],
  decisions: ["D189"],
  controls: [
    {
      kind: "choice",
      id: "where",
      label: "Where",
      group: "Variant",
      value: "hint",
      options: [
        { value: "hint", label: "In a hint" },
        { value: "crumb", label: "As a crumb" },
      ],
    },
    { kind: "text", id: "label", label: "Label", group: "Content", value: "Privacy", max: 24 },
  ],
  render: (state) => {
    const label = esc(str(state.label, "Privacy"));
    if (str(state.where) === "crumb")
      return `<nav class="settings-crumb" aria-label="Breadcrumb"><a class="text-link" href="/settings">${label}</a><span aria-hidden="true"> /</span></nav>`;
    return `<p class="settings-hint">What you type is sent to the services that write the briefings. Read <a class="text-link" href="/settings/privacy">${label}</a> for the whole list.</p>`;
  },
});
