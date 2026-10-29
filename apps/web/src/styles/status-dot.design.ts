import { defineSpec, str } from "../lib/designSpec";

const TONES: Record<string, string> = {
  good: "Passing",
  warn: "Slow",
  bad: "Failing",
  none: "Checking",
};

/** A reading judged good, worth a look or wrong, as a Health row draws it before its value. */
export default defineSpec({
  id: "status-dot",
  title: "Status dot",
  level: "atom",
  category: "Feedback",
  summary: "An 8px dot before a reading, in the success, warning or danger tone.",
  frame: "wide",
  usage: { sheet: "primitives.css", selector: ".status-dot" },
  classes: ["status-dot"],
  guidance: [
    "The words beside it always say the same thing, so colour is never the only signal.",
    "A reading with no judgement (none, or no tone) draws no dot and takes no room.",
  ],
  controls: [
    {
      kind: "choice",
      id: "tone",
      label: "Tone",
      group: "Variant",
      value: "good",
      options: [
        { value: "good", label: "Good" },
        { value: "warn", label: "Warn" },
        { value: "bad", label: "Bad" },
        { value: "none", label: "None" },
      ],
    },
  ],
  render: (state) => {
    const tone = str(state.tone, "good");
    return `<div class="rows card-group"><div class="settings-row health-row"><span class="settings-text"><span class="settings-label">Build</span><span class="settings-hint">Deployed 2 hours ago</span></span><span class="health-value"><span class="status-dot" data-tone="${tone}"></span><span>${TONES[tone] ?? "Checking"}</span></span></div></div>`;
  },
});
