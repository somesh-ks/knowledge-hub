import { attr, defineSpec, esc, icon, on, str } from "../lib/designSpec";

/** Rows as Settings draws them: a link row, a row with a switch at its end, a row that states a value. */
export default defineSpec({
  id: "rows",
  title: "Rows",
  level: "molecule",
  category: "Lists",
  summary: "A list of rows: a name at the start and a chevron, a control or a value at the end.",
  frame: "wide",
  usage: [
    { sheet: "primitives.css", selector: ".row-action" },
    { sheet: "settings.css", selector: ".settings-row" },
    { sheet: "settings.css", selector: ".settings-hint" },
  ],
  classes: [
    "rows",
    "row-action",
    "settings-row",
    "settings-text",
    "settings-label",
    "settings-hint",
  ],
  decisions: ["D187"],
  guidance: [
    "A row that is one link or button is a .row-action: the whole row answers a press, as a rounded tile clear of its neighbours.",
    "A row that holds a control is a .settings-row. Its label is as wide as its words and the control takes the end.",
    "data-quiet mutes a settings row's label when its control cannot act; the row stays where it is, dimmed and named.",
  ],
  controls: [
    {
      kind: "choice",
      id: "row",
      label: "Row",
      group: "Variant",
      value: "switch",
      options: [
        { value: "switch", label: "Switch" },
        { value: "link", label: "Link" },
        { value: "value", label: "Value" },
      ],
    },
    { kind: "toggle", id: "quiet", label: "Quiet", group: "State", value: false },
    { kind: "text", id: "label", label: "Label", group: "Content", value: "Autoplay", max: 24 },
  ],
  demo: [{ row: "switch" }, { row: "link" }, { row: "value" }, { row: "switch", quiet: true }],
  render: (state) => {
    const row = str(state.row, "switch");
    const label = esc(str(state.label, "Autoplay"));
    const quiet = attr("data-quiet", on(state.quiet));
    if (row === "switch")
      return `<div class="rows card-group"><div class="settings-row"${quiet}><span class="settings-label">${label}</span><input class="settings-switch" type="checkbox" role="switch" aria-label="${label}" checked /></div><div class="settings-row"><span class="settings-label">Interface sounds</span><input class="settings-switch" type="checkbox" role="switch" aria-label="Interface sounds" /></div></div>`;
    if (row === "value")
      return `<div class="rows card-group"><div class="settings-row"${quiet}><span class="settings-label">${label}</span><span class="settings-hint">On</span></div><div class="settings-row"><span class="settings-label">Last updated</span><span class="settings-hint">29 Oct 2026</span></div></div>`;
    return `<div class="rows card-group"><a class="row-action" href="#rows"><span class="settings-text"><span class="settings-label">${label}</span><span class="settings-hint">On</span></span>${icon("chevronRight")}</a><a class="row-action" href="#rows"><span class="settings-text"><span class="settings-label">Playback speed</span><span class="settings-hint">1.25x</span></span>${icon("chevronRight")}</a></div>`;
  },
});
