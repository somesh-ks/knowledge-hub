import { defineSpec, esc, icon, on, str } from "../lib/designSpec";
import type { IconName } from "../lib/icons";

/** The glyph each tone wears; the tone also sets the tint (banner.css). */
const GLYPHS: Record<string, IconName> = {
  info: "info",
  warning: "wifiOff",
  danger: "alert",
  success: "checkCircle",
};

/** The banner, drawn as Banner.astro does: a tinted block, a glyph, a title, a line and at most one link. */
export default defineSpec({
  id: "banner",
  title: "Banner",
  level: "molecule",
  category: "Feedback",
  summary:
    "A flat, tinted block that tells the reader something about the page: a notice, a warning, a failure or good news.",
  frame: "narrow",
  usage: { sheet: "banner.css", selector: ".banner" },
  classes: ["banner", "banner-text", "banner-title", "banner-body"],
  guidance: [
    "The tone sets the tint and the glyph's colour only. The words stay at full ink so their contrast never depends on the tone.",
    "At most one way on, as a text button. A danger banner speaks as an alert; the others speak as a status.",
  ],
  controls: [
    {
      kind: "choice",
      id: "tone",
      label: "Tone",
      group: "Variant",
      value: "info",
      options: [
        { value: "info", label: "Info" },
        { value: "warning", label: "Warning" },
        { value: "danger", label: "Danger" },
        { value: "success", label: "Success" },
      ],
    },
    { kind: "toggle", id: "body", label: "Body line", group: "Content", value: true },
    { kind: "toggle", id: "action", label: "Action", group: "Content", value: false },
    {
      kind: "text",
      id: "title",
      label: "Title",
      group: "Content",
      value: "A new version is ready",
      max: 24,
    },
  ],
  render: (state) => {
    const tone = str(state.tone, "info");
    const body = on(state.body) ? `<p class="banner-body">Reload to get it.</p>` : "";
    const action = on(state.action) ? `<a class="btn" href="#">Reload</a>` : "";
    return `<div class="banner" data-tone="${tone}" role="${tone === "danger" ? "alert" : "status"}">${icon(GLYPHS[tone] ?? "info")}<div class="banner-text"><p class="banner-title">${esc(str(state.title, "A new version is ready"))}</p>${body}</div>${action}</div>`;
  },
  demo: [{ tone: "info" }, { tone: "warning" }, { tone: "danger" }, { tone: "success" }],
});
