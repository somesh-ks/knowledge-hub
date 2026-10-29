import { attr, defineSpec, esc, on, str } from "../lib/designSpec";

/** The switch on its row, as every settings page draws it. */
export default defineSpec({
  id: "switch",
  title: "Switch",
  level: "atom",
  category: "Inputs",
  summary: "A track and a thumb for a setting that is on or off and takes effect at once.",
  usage: { sheet: "settings.css", selector: ".settings-switch" },
  classes: ["settings-switch"],
  controls: [
    { kind: "toggle", id: "checked", label: "On", group: "State", value: true },
    { kind: "toggle", id: "disabled", label: "Disabled", group: "State", value: false },
  ],
  render: (state) =>
    `<input class="settings-switch" type="checkbox" role="switch" aria-label="${esc(str(state.label, "Sounds"))}"${attr("checked", on(state.checked))}${attr("disabled", state.disabled)} />`,
});
