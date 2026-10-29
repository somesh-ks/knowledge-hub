import { defineSpec, esc, on } from "../lib/designSpec";

const SHORT = ["Weekly", "14 stories", "9 min"];
const LONG = ["Weekly", "14 stories", "9 min", "From 6 sources", "Made at 7:02 on Tuesday"];

/** One quiet line of facts, its parts separated by a centred dot. */
export default defineSpec({
  id: "meta-line",
  title: "Meta line",
  level: "atom",
  category: "Lists",
  summary: "One quiet line of facts about a page or a story, its parts separated by a centred dot.",
  frame: "narrow",
  usage: [
    { sheet: "primitives.css", selector: ".meta" },
    { sheet: "reader.css", selector: ".meta-wrap" },
  ],
  classes: ["meta", "meta-wrap"],
  guidance: [
    "Each part is its own element. The dot is drawn between them by the class, so write the words and nothing else.",
    "The dot is silent to a screen reader: the parts are separate words already.",
  ],
  controls: [
    { kind: "toggle", id: "long", label: "Long line", group: "Content", value: true },
    { kind: "toggle", id: "wrap", label: "Clean wrap", group: "State", value: true },
  ],
  demo: [{ wrap: false }, { wrap: true }],
  render: (state) => {
    const parts = (on(state.long) ? LONG : SHORT)
      .map((part) => `<span>${esc(part)}</span>`)
      .join("");
    return `<p class="meta${on(state.wrap) ? " meta-wrap" : ""}">${parts}</p>`;
  },
});
